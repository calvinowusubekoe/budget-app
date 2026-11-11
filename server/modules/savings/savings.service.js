import mongoose from 'mongoose';
import Decimal from 'decimal.js';
import { ApiError } from '../../utils/ApiError.js';
import { D, fitsCurrency, minorUnits, normalize, str, toDecimal128 } from '../../utils/money.js';
import { addDays, daysBetween, parse, PERIOD_DAYS } from '../../utils/periods.js';
import { toYmd } from '../../validators/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { SavingsEntry, SavingsGoal } from './savings.models.js';
import { assertWithinLimit } from '../subscriptions/entitlements.js';

/** Minimum days of entries before a pace-based estimate is shown. */
export const MIN_HISTORY_DAYS = 14;

const fieldError = (field, message) => ApiError.validation([{ location: 'body', field, message }]);
const oid = (v) => new mongoose.Types.ObjectId(String(v));

function assertFits(value, currency, field) {
  if (!fitsCurrency(value, currency)) throw fieldError(field, `${currency} amounts have at most ${minorUnits(currency)} decimal places.`);
}

async function totals(goal) {
  const rows = await SavingsEntry.aggregate([
    { $match: { goalId: oid(goal._id), status: 'recorded' } },
    { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 }, first: { $min: '$date' } } },
  ]);
  const get = (t) => rows.find((r) => r._id === t);
  const contributed = str(get('contribution')?.total) ?? '0';
  const withdrawn = str(get('withdrawal')?.total) ?? '0';
  const firsts = rows.map((r) => r.first).filter(Boolean);
  return {
    contributed,
    withdrawn,
    current: new D(contributed).minus(withdrawn).toString(),
    entryCount: rows.reduce((n, r) => n + r.count, 0),
    firstDate: firsts.length ? toYmd(new Date(Math.min(...firsts.map((d) => d.getTime())))) : null,
  };
}

/**
 * Progress plus two estimates, both clearly labelled as estimates in the UI:
 *  projectedDate: when the target is reached at the average pace so far
 *  requiredPerPeriod: what each remaining period needs to hit the target date
 */
export async function summarize(goal, today) {
  const cur = goal.currency;
  const t = await totals(goal);
  const target = str(goal.targetAmount);
  const remainingD = D.max(new D(target).minus(t.current), 0);
  const reached = remainingD.isZero();
  const progress = new D(t.current).div(target).times(100);

  let projectedDate = null;
  // A pace needs some history; one deposit today says nothing about the next months.
  const history = t.firstDate ? daysBetween(t.firstDate, today) : 0;
  if (!reached && history >= MIN_HISTORY_DAYS && new D(t.current).greaterThan(0)) {
    const elapsed = history;
    const perDay = new D(t.current).div(elapsed);
    const days = remainingD.div(perDay).toDecimalPlaces(0, Decimal.ROUND_UP).toNumber();
    projectedDate = days < 365 * 100 ? addDays(today, days) : null;
  }

  let requiredPerPeriod = null;
  const targetYmd = toYmd(goal.targetDate);
  if (!reached && targetYmd && goal.contributionFrequency !== 'none') {
    const daysLeft = daysBetween(today, targetYmd);
    if (daysLeft > 0) {
      const periodsLeft = Math.max(Math.ceil(daysLeft / PERIOD_DAYS[goal.contributionFrequency]), 1);
      // Round up so following the plan actually reaches the target.
      requiredPerPeriod = remainingD.div(periodsLeft).toFixed(minorUnits(cur), Decimal.ROUND_UP);
    }
  }

  return {
    contributed: normalize(t.contributed, cur),
    withdrawn: normalize(t.withdrawn, cur),
    current: normalize(t.current, cur),
    remaining: normalize(remainingD.toString(), cur),
    progress: D.min(progress, 999.9).toFixed(1),
    reached,
    entryCount: t.entryCount,
    projectedDate,
    requiredPerPeriod,
    onTrack: targetYmd ? (reached || (projectedDate !== null && projectedDate <= targetYmd)) : null,
    overdue: Boolean(targetYmd && !reached && targetYmd < today),
  };
}

export async function presentGoal(goal, today) {
  return {
    id: String(goal._id),
    name: goal.name,
    description: goal.description,
    targetAmount: normalize(str(goal.targetAmount), goal.currency),
    currency: goal.currency,
    targetDate: toYmd(goal.targetDate),
    contributionFrequency: goal.contributionFrequency,
    notes: goal.notes,
    status: goal.status,
    summary: await summarize(goal, today),
    createdAt: goal.createdAt,
  };
}

async function findGoal(workspaceId, id) {
  const goal = await SavingsGoal.findOne({ _id: id, workspaceId });
  if (!goal) throw ApiError.notFound('Savings goal not found.');
  return goal;
}

export async function listGoals(workspace, today, { includeArchived = false } = {}) {
  const q = { workspaceId: workspace._id };
  if (!includeArchived) q.status = 'active';
  const goals = await SavingsGoal.find(q).sort({ status: 1, createdAt: 1 });
  return Promise.all(goals.map((g) => presentGoal(g, today)));
}

export async function getGoal(workspace, id, today) {
  return presentGoal(await findGoal(workspace._id, id), today);
}

export async function createGoal(workspace, input, actor, today, ctx) {
  await assertWithinLimit(workspace, 'savingsGoals');
  assertFits(input.targetAmount, input.currency, 'targetAmount');
  if (input.targetDate && input.targetDate <= today) throw fieldError('targetDate', 'Choose a date in the future.');
  const goal = await SavingsGoal.create({
    workspaceId: workspace._id,
    name: input.name,
    description: input.description ?? '',
    targetAmount: toDecimal128(normalize(input.targetAmount, input.currency)),
    currency: input.currency,
    targetDate: input.targetDate ? parse(input.targetDate) : null,
    contributionFrequency: input.contributionFrequency ?? 'monthly',
    notes: input.notes ?? '',
    createdBy: actor._id,
  });
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'savings_goal.created', entityType: 'SavingsGoal', entityId: goal._id, metadata: { name: goal.name, target: str(goal.targetAmount), currency: goal.currency }, ctx });
  return presentGoal(goal, today);
}

export async function updateGoal(workspace, id, changes, actor, today, ctx) {
  const goal = await findGoal(workspace._id, id);
  const before = { name: goal.name, targetAmount: str(goal.targetAmount), targetDate: toYmd(goal.targetDate), status: goal.status };
  if (changes.currency && changes.currency !== goal.currency) {
    if (await SavingsEntry.exists({ goalId: goal._id })) throw ApiError.conflict('This goal already has entries, so its currency can’t change.', 'CURRENCY_LOCKED');
    goal.currency = changes.currency;
  }
  if (changes.targetAmount) {
    assertFits(changes.targetAmount, goal.currency, 'targetAmount');
    goal.targetAmount = toDecimal128(normalize(changes.targetAmount, goal.currency));
  }
  if (changes.targetDate !== undefined) goal.targetDate = changes.targetDate ? parse(changes.targetDate) : null;
  for (const key of ['name', 'description', 'contributionFrequency', 'notes', 'status']) if (changes[key] !== undefined) goal[key] = changes[key];
  await goal.save();
  const after = { name: goal.name, targetAmount: str(goal.targetAmount), targetDate: toYmd(goal.targetDate), status: goal.status };
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: changes.status === 'archived' ? 'savings_goal.archived' : 'savings_goal.updated', entityType: 'SavingsGoal', entityId: goal._id, metadata: { before, after }, ctx });
  return presentGoal(goal, today);
}

export function presentEntry(e, currency) {
  return {
    id: String(e._id),
    type: e.type,
    amount: normalize(str(e.amount), currency),
    date: toYmd(e.date),
    notes: e.notes,
    status: e.status,
    reversedAt: e.reversedAt,
    reversalReason: e.reversalReason,
    createdAt: e.createdAt,
  };
}

export async function listEntries(workspace, goalId) {
  const goal = await findGoal(workspace._id, goalId);
  const rows = await SavingsEntry.find({ goalId: goal._id }).sort({ date: -1, createdAt: -1 }).lean();
  return rows.map((e) => presentEntry(e, goal.currency));
}

export async function addEntry(workspace, goalId, input, actor, today, ctx) {
  const goal = await findGoal(workspace._id, goalId);
  if (goal.status !== 'active') throw ApiError.badRequest('This goal is archived. Restore it to record entries.');
  assertFits(input.amount, goal.currency, 'amount');
  if (input.date > today) throw fieldError('date', 'Entries can’t be dated in the future.');
  if (input.type === 'withdrawal') {
    const { current } = await totals(goal);
    if (new D(input.amount).greaterThan(current)) {
      throw fieldError('amount', `That’s more than the ${normalize(current, goal.currency)} ${goal.currency} recorded in this goal.`);
    }
  }
  const entry = await SavingsEntry.create({
    workspaceId: workspace._id,
    goalId: goal._id,
    type: input.type,
    amount: toDecimal128(normalize(input.amount, goal.currency)),
    date: parse(input.date),
    notes: input.notes ?? '',
    createdBy: actor._id,
  });
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: `savings_goal.${input.type}_recorded`, entityType: 'SavingsGoal', entityId: goal._id, metadata: { entryId: String(entry._id), amount: str(entry.amount), date: input.date }, ctx });
  return { entry: presentEntry(entry, goal.currency), goal: await presentGoal(goal, today) };
}

export async function reverseEntry(workspace, goalId, entryId, reason, actor, today, ctx) {
  const goal = await findGoal(workspace._id, goalId);
  const entry = await SavingsEntry.findOne({ _id: entryId, goalId: goal._id, status: 'recorded' });
  if (!entry) throw ApiError.notFound('Entry not found, or already reversed.');
  if (entry.type === 'contribution') {
    const { current } = await totals(goal);
    if (new D(current).minus(str(entry.amount)).lessThan(0)) {
      throw ApiError.conflict('Reversing this would leave the goal below zero. Reverse the later withdrawal first.', 'WOULD_GO_NEGATIVE');
    }
  }
  entry.status = 'reversed';
  entry.reversedAt = new Date();
  entry.reversedBy = actor._id;
  entry.reversalReason = reason;
  await entry.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'savings_goal.entry_reversed', entityType: 'SavingsGoal', entityId: goal._id, metadata: { entryId: String(entry._id), type: entry.type, amount: str(entry.amount), reason }, ctx });
  return { entry: presentEntry(entry, goal.currency), goal: await presentGoal(goal, today) };
}

/** Net saved per calendar month for the last `months` months, oldest first. */
export async function monthlyTrend(workspace, goalId, today, months = 12) {
  const goal = await findGoal(workspace._id, goalId);
  const [y, m] = today.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - months, 1));
  const rows = await SavingsEntry.aggregate([
    { $match: { goalId: goal._id, status: 'recorded', date: { $gte: start } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
        net: { $sum: { $cond: [{ $eq: ['$type', 'contribution'] }, '$amount', { $multiply: ['$amount', -1] }] } },
      },
    },
  ]);
  const byMonth = new Map(rows.map((r) => [r._id, str(r.net)]));
  const out = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    out.push({ month: key, net: normalize(byMonth.get(key) ?? '0', goal.currency) });
  }
  return out;
}

/** Workspace-wide savings totals per currency, for the dashboard. */
export async function savingsOverview(workspaceId, today) {
  const goals = await SavingsGoal.find({ workspaceId, status: 'active' });
  const sums = new Map();
  for (const g of goals) {
    const s = await summarize(g, today);
    const row = sums.get(g.currency) ?? { currency: g.currency, saved: new D(0), target: new D(0), goals: 0 };
    row.saved = row.saved.plus(s.current);
    row.target = row.target.plus(str(g.targetAmount));
    row.goals += 1;
    sums.set(g.currency, row);
  }
  return [...sums.values()].map((r) => ({ currency: r.currency, goals: r.goals, saved: normalize(r.saved.toString(), r.currency), target: normalize(r.target.toString(), r.currency) }));
}
