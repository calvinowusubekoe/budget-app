import { ApiError } from '../../utils/ApiError.js';
import { normalize, str, toDecimal128 } from '../../utils/money.js';
import { daysBetween, occurrence, parse, todayIn } from '../../utils/periods.js';
import { toYmd } from '../../validators/money.js';
import { logger } from '../../utils/logger.js';
import { recordAudit } from '../audit/audit.service.js';
import { Workspace } from '../workspaces/workspace.model.js';
import { WorkspaceMember } from '../workspaces/workspaceMember.model.js';
import { can } from '../workspaces/permissions.js';
import { Account } from '../accounts/account.model.js';
import { Category } from '../categories/category.model.js';
import { Transaction } from '../transactions/transaction.model.js';
import { createTransaction, resolveRecord } from '../transactions/transactions.service.js';
import { notify, resolveNotifications, workspaceManagers } from '../notifications/notifications.service.js';
import { RecurringTransaction } from './recurring.model.js';
import { assertWithinLimit } from '../subscriptions/entitlements.js';

/** Upper bound per run, so a long-paused schedule can't flood the ledger in one go. */
export const MAX_PER_RUN = 24;
const SYSTEM_CTX = { ip: '', userAgent: 'BudgetFlow scheduler' };
const clientRef = (id, date) => `rec-${id}-${date}`;

const dateOf = (s, n) => occurrence(toYmd(s.anchorDate), s.frequency, s.interval, n);

function upcoming(s, count = 3) {
  if (s.status !== 'active') return [];
  const out = [];
  for (let n = s.occurrencesDone; out.length < count; n += 1) {
    const d = dateOf(s, n);
    if (s.endDate && d > toYmd(s.endDate)) break;
    out.push(d);
  }
  return out;
}

export async function presentSchedule(s) {
  const t = s.template;
  const [acc, to, cat] = await Promise.all([
    Account.findById(t.accountId).select('name currency').lean(),
    t.toAccountId ? Account.findById(t.toAccountId).select('name currency').lean() : null,
    t.categoryId ? Category.findById(t.categoryId).select('name icon').lean() : null,
  ]);
  const currency = acc?.currency ?? 'GHS';
  return {
    id: String(s._id),
    type: t.type,
    description: t.description,
    payee: t.payee,
    notes: t.notes,
    amount: normalize(str(t.amount), currency),
    currency,
    toAmount: t.toAmount ? normalize(str(t.toAmount), to?.currency ?? currency) : null,
    account: acc ? { id: String(acc._id), name: acc.name, currency: acc.currency } : null,
    toAccount: to ? { id: String(to._id), name: to.name, currency: to.currency } : null,
    category: cat ? { id: String(cat._id), name: cat.name, icon: cat.icon } : null,
    frequency: s.frequency,
    interval: s.interval,
    anchorDate: toYmd(s.anchorDate),
    endDate: toYmd(s.endDate),
    mode: s.mode,
    status: s.status,
    nextDate: s.status === 'active' ? toYmd(s.nextRunDate) : null,
    upcoming: upcoming(s),
    pending: (s.pending ?? []).map(toYmd).sort(),
    created: await Transaction.countDocuments({ recurringId: s._id, deletedAt: null }),
    lastRunAt: s.lastRunAt,
    lastError: s.lastError,
  };
}

async function findSchedule(workspaceId, id) {
  const s = await RecurringTransaction.findOne({ _id: id, workspaceId });
  if (!s) throw ApiError.notFound('Recurring schedule not found.');
  return s;
}

export async function listSchedules(workspace, { includeEnded = false } = {}) {
  const q = { workspaceId: workspace._id };
  if (!includeEnded) q.status = { $ne: 'ended' };
  const rows = await RecurringTransaction.find(q).sort({ status: 1, nextRunDate: 1 });
  return Promise.all(rows.map(presentSchedule));
}

/**
 * Creates a schedule. With `fromTransactionId` the existing transaction is
 * occurrence 0 and the schedule continues from it; otherwise the first
 * occurrence is `startDate`.
 */
export async function createSchedule(workspace, input, actor, ctx) {
  await assertWithinLimit(workspace, 'recurring');
  const today = todayIn(actor.timezone);
  let template;
  let anchor;
  let done = 0;
  let source = null;

  if (input.fromTransactionId) {
    source = await Transaction.findOne({ _id: input.fromTransactionId, workspaceId: workspace._id, deletedAt: null });
    if (!source) throw ApiError.notFound('Transaction not found.');
    if (source.recurringId) throw ApiError.conflict('This transaction already belongs to a recurring schedule.', 'ALREADY_RECURRING');
    template = {
      type: source.type,
      accountId: source.accountId,
      categoryId: source.categoryId,
      toAccountId: source.toAccountId,
      amount: source.amount,
      toAmount: source.toAmount,
      description: source.description,
      payee: source.payee,
      notes: source.notes,
    };
    anchor = toYmd(source.date);
    done = 1;
  } else {
    if (daysBetween(input.startDate, today) > 366) throw ApiError.validation([{ location: 'body', field: 'startDate', message: 'Start within the last year.' }]);
    const resolved = await resolveRecord(workspace, input);
    template = {
      type: resolved.type,
      accountId: resolved.accountId,
      categoryId: resolved.categoryId,
      toAccountId: resolved.toAccountId,
      amount: toDecimal128(resolved.amount),
      toAmount: toDecimal128(resolved.toAmount),
      description: input.description,
      payee: input.payee ?? '',
      notes: input.notes ?? '',
    };
    anchor = input.startDate;
  }
  if (input.endDate && input.endDate < anchor) throw ApiError.validation([{ location: 'body', field: 'endDate', message: 'The end date must be after the start.' }]);

  const schedule = new RecurringTransaction({
    workspaceId: workspace._id,
    template,
    frequency: input.frequency,
    interval: input.interval ?? 1,
    anchorDate: parse(anchor),
    endDate: input.endDate ? parse(input.endDate) : null,
    mode: input.mode ?? 'auto',
    occurrencesDone: done,
    timezone: actor.timezone,
    createdBy: actor._id,
  });
  schedule.nextRunDate = parse(dateOf(schedule, done));
  await schedule.save();

  if (source) {
    source.recurringId = schedule._id;
    source.recurrence = { isRecurring: true, frequency: schedule.frequency };
    await source.save();
  }
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'recurring.created', entityType: 'RecurringTransaction', entityId: schedule._id, metadata: { frequency: schedule.frequency, interval: schedule.interval, mode: schedule.mode, description: template.description }, ctx });
  // Start dates in the past are caught up immediately.
  await runSchedule(schedule);
  return presentSchedule(await RecurringTransaction.findById(schedule._id));
}

export async function updateSchedule(workspace, id, changes, actor, ctx) {
  const s = await findSchedule(workspace._id, id);
  if (s.status === 'ended') throw ApiError.badRequest('This schedule has ended. Create a new one instead.');
  const t = s.template;
  const templateKeys = ['accountId', 'categoryId', 'toAccountId', 'amount', 'toAmount', 'description', 'payee', 'notes'];
  if (templateKeys.some((k) => changes[k] !== undefined)) {
    const merged = {
      type: t.type,
      accountId: changes.accountId ?? String(t.accountId),
      categoryId: changes.categoryId ?? (t.categoryId ? String(t.categoryId) : undefined),
      toAccountId: changes.toAccountId ?? (t.toAccountId ? String(t.toAccountId) : undefined),
      amount: changes.amount ?? str(t.amount),
      toAmount: changes.toAmount ?? (t.toAmount ? str(t.toAmount) : undefined),
    };
    const resolved = await resolveRecord(workspace, merged);
    Object.assign(t, {
      accountId: resolved.accountId,
      categoryId: resolved.categoryId,
      toAccountId: resolved.toAccountId,
      amount: toDecimal128(resolved.amount),
      toAmount: toDecimal128(resolved.toAmount),
    });
    for (const k of ['description', 'payee', 'notes']) if (changes[k] !== undefined) t[k] = changes[k];
  }
  if (changes.mode) s.mode = changes.mode;
  if (changes.endDate !== undefined) s.endDate = changes.endDate ? parse(changes.endDate) : null;
  if (changes.status === 'paused') s.status = 'paused';
  if (changes.status === 'active') {
    s.status = 'active';
    s.lastError = null;
  }
  if (changes.status === 'ended') {
    s.status = 'ended';
    s.nextRunDate = null;
  }
  s.markModified('template');
  await s.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: `recurring.${changes.status === 'ended' ? 'ended' : changes.status === 'paused' ? 'paused' : 'updated'}`, entityType: 'RecurringTransaction', entityId: s._id, metadata: { changes: Object.keys(changes) }, ctx });
  if (s.status === 'active') await runSchedule(s);
  return presentSchedule(await RecurringTransaction.findById(s._id));
}

/** Skips the next occurrence without creating it. */
export async function skipNext(workspace, id, actor, ctx) {
  const s = await findSchedule(workspace._id, id);
  if (s.status !== 'active') throw ApiError.badRequest('Only active schedules can skip.');
  const skipped = toYmd(s.nextRunDate);
  await advance(s);
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'recurring.skipped', entityType: 'RecurringTransaction', entityId: s._id, metadata: { date: skipped }, ctx });
  return presentSchedule(await RecurringTransaction.findById(s._id));
}

async function createOccurrence(s, workspace, date, actor, ctx) {
  const t = s.template;
  const input = {
    type: t.type,
    accountId: String(t.accountId),
    categoryId: t.categoryId ? String(t.categoryId) : undefined,
    toAccountId: t.toAccountId ? String(t.toAccountId) : undefined,
    amount: str(t.amount),
    toAmount: t.toAmount ? str(t.toAmount) : undefined,
    date,
    description: t.description,
    payee: t.payee,
    notes: t.notes,
    recurrence: { isRecurring: true, frequency: s.frequency },
  };
  // The fixed key makes this safe to repeat: a second run returns the same record.
  const { transaction } = await createTransaction(workspace, input, actor, ctx, clientRef(s._id, date));
  await Transaction.updateOne({ _id: transaction.id, recurringId: null }, { recurringId: s._id });
  return transaction;
}

/** Confirms a pending occurrence in remind mode. Safe to call twice. */
export async function confirmOccurrence(workspace, id, date, actor, ctx) {
  const s = await findSchedule(workspace._id, id);
  if (!(s.pending ?? []).some((d) => toYmd(d) === date)) throw ApiError.badRequest('There’s no pending occurrence on that date.');
  const tx = await createOccurrence(s, workspace, date, actor, ctx);
  await RecurringTransaction.updateOne({ _id: s._id }, { $pull: { pending: parse(date) } });
  await resolveNotifications({ dedupeKey: `rec:${s._id}:${date}` });
  return tx;
}

export async function dismissOccurrence(workspace, id, date, actor, ctx) {
  const s = await findSchedule(workspace._id, id);
  await RecurringTransaction.updateOne({ _id: s._id }, { $pull: { pending: parse(date) } });
  await resolveNotifications({ dedupeKey: `rec:${s._id}:${date}` });
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'recurring.dismissed', entityType: 'RecurringTransaction', entityId: s._id, metadata: { date }, ctx });
}

/**
 * Moves the schedule to its next occurrence. Conditional on the count it
 * read, so two workers racing on the same schedule advance it only once.
 */
async function advance(s) {
  const n = s.occurrencesDone + 1;
  const next = dateOf(s, n);
  const ended = s.endDate && next > toYmd(s.endDate);
  const res = await RecurringTransaction.findOneAndUpdate(
    { _id: s._id, occurrencesDone: s.occurrencesDone },
    { $set: { occurrencesDone: n, nextRunDate: ended ? null : parse(next), status: ended ? 'ended' : s.status, lastRunAt: new Date(), lastError: null } },
    { returnDocument: 'after' },
  );
  if (res) Object.assign(s, { occurrencesDone: res.occurrencesDone, nextRunDate: res.nextRunDate, status: res.status });
  return Boolean(res);
}

async function fail(s, workspace, date, message) {
  await RecurringTransaction.updateOne({ _id: s._id }, { lastError: message, lastRunAt: new Date() });
  await notify(await workspaceManagers(workspace._id), {
    workspaceId: workspace._id,
    type: 'recurring_failed',
    title: `Couldn’t record “${s.template.description}”`,
    body: `${message} Record it yourself, or fix the schedule and resume.`,
    link: '/transactions/recurring',
    data: { recurringId: String(s._id), date },
    dedupeKey: `rec-fail:${s._id}:${date}`,
  });
}

/** Handles every occurrence of one schedule that is due on or before today. */
export async function runSchedule(s, now = new Date()) {
  const workspace = await Workspace.findById(s.workspaceId);
  if (!workspace || workspace.status !== 'active') return 0;
  const today = todayIn(s.timezone, now);
  let handled = 0;

  while (s.status === 'active' && s.nextRunDate && toYmd(s.nextRunDate) <= today && handled < MAX_PER_RUN) {
    const date = toYmd(s.nextRunDate);
    // The creator must still be allowed to write in this workspace.
    const member = await WorkspaceMember.findOne({ workspaceId: workspace._id, userId: s.createdBy, status: 'active' });
    if (!member || !can(member.role, 'records.write')) {
      await fail(s, workspace, date, 'The person who set up this schedule no longer has access to add records.');
      break;
    }
    const actor = { _id: s.createdBy };

    if (s.mode === 'remind') {
      await RecurringTransaction.updateOne({ _id: s._id }, { $addToSet: { pending: parse(date) } });
      await notify(await workspaceManagers(workspace._id), {
        workspaceId: workspace._id,
        type: 'recurring_due',
        title: `${s.template.description} is due`,
        body: `Confirm it to add it to your records for ${date}.`,
        link: '/transactions/recurring',
        data: { recurringId: String(s._id), date },
        dedupeKey: `rec:${s._id}:${date}`,
      });
    } else {
      try {
        await createOccurrence(s, workspace, date, actor, SYSTEM_CTX);
      } catch (err) {
        if (err instanceof ApiError) {
          // e.g. RATE_REQUIRED or an archived account: stop and tell a human, never guess.
          await fail(s, workspace, date, err.message);
          break;
        }
        throw err;
      }
    }
    if (!(await advance(s))) break; // another worker got here first
    handled += 1;
  }
  return handled;
}

/** Entry point for the scheduler: runs every schedule that might be due. */
export async function runDueSchedules(now = new Date()) {
  // Look a day ahead because each schedule's "today" depends on its own time zone.
  const horizon = new Date(now.getTime() + 36 * 60 * 60 * 1000);
  const due = await RecurringTransaction.find({ status: 'active', nextRunDate: { $lte: horizon } });
  let total = 0;
  for (const s of due) {
    try {
      total += await runSchedule(s, now);
    } catch (err) {
      logger.error(`recurring schedule ${s._id} failed`, err);
    }
  }
  return total;
}
