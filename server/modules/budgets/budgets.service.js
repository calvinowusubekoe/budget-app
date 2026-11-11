import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { D, fitsCurrency, minorUnits, normalize, str, toDecimal128 } from '../../utils/money.js';
import { periodOf, previousPeriod, parse, daysBetween, todayIn } from '../../utils/periods.js';
import { logger } from '../../utils/logger.js';
import { recordAudit } from '../audit/audit.service.js';
import { Category } from '../categories/category.model.js';
import { Transaction } from '../transactions/transaction.model.js';
import { notify, workspaceManagers } from '../notifications/notifications.service.js';
import { Budget } from './budget.model.js';
import { assertWithinLimit } from '../subscriptions/entitlements.js';

const FIRST_EFFECTIVE = '1970-01-01';
const fieldError = (field, message) => ApiError.validation([{ location: 'body', field, message }]);

/** The limit that applied to the period starting on `periodStart`. */
function amountFor(budget, periodStart) {
  const start = parse(periodStart);
  const sorted = [...budget.amounts].sort((a, b) => a.effectiveFrom - b.effectiveFrom);
  let current = sorted[0];
  for (const a of sorted) if (a.effectiveFrom <= start) current = a;
  return str(current.amount);
}

/** Exact sum of expenses in the window, in the budget's currency. */
async function spentBetween(budget, start, end) {
  const match = {
    workspaceId: new mongoose.Types.ObjectId(String(budget.workspaceId)),
    deletedAt: null,
    type: 'expense',
    'reporting.currency': budget.currency,
    date: { $gte: parse(start), $lte: parse(end) },
  };
  if (budget.scope === 'categories') match.categoryId = { $in: budget.categoryIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
  const [row] = await Transaction.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$reporting.amount' }, count: { $sum: 1 } } }]);
  return { spent: normalize(str(row?.total) ?? '0', budget.currency), count: row?.count ?? 0 };
}

function measure(budget, period, amount, spent) {
  const remaining = new D(amount).minus(spent);
  const utilisation = new D(amount).isZero() ? new D(0) : new D(spent).div(amount).times(100);
  const state = utilisation.greaterThan(100) ? 'over' : utilisation.greaterThanOrEqualTo(budget.alertAt) ? 'warning' : 'under';
  return {
    start: period.start,
    end: period.end,
    key: period.key,
    amount: normalize(amount, budget.currency),
    spent,
    remaining: normalize(remaining.toString(), budget.currency),
    utilisation: utilisation.toFixed(1),
    state,
  };
}

export async function progressFor(budget, date) {
  const period = periodOf(budget.period, date);
  const amount = amountFor(budget, period.start);
  const { spent, count } = await spentBetween(budget, period.start, period.end);
  return { ...measure(budget, period, amount, spent), transactionCount: count, daysLeft: Math.max(daysBetween(date, period.end), 0) };
}

export async function presentBudget(budget, today) {
  const cats = budget.scope === 'categories' ? await Category.find({ _id: { $in: budget.categoryIds } }).select('name icon').lean() : [];
  return {
    id: String(budget._id),
    name: budget.name,
    period: budget.period,
    scope: budget.scope,
    categories: cats.map((c) => ({ id: String(c._id), name: c.name, icon: c.icon })),
    currency: budget.currency,
    alertAt: budget.alertAt,
    status: budget.status,
    notes: budget.notes,
    amountHistory: budget.amounts.map((a) => ({ amount: normalize(str(a.amount), budget.currency), effectiveFrom: a.effectiveFrom.toISOString().slice(0, 10) })),
    current: await progressFor(budget, today),
    createdAt: budget.createdAt,
  };
}

export async function listBudgets(workspace, today, { includeArchived = false } = {}) {
  const q = { workspaceId: workspace._id };
  if (!includeArchived) q.status = { $ne: 'archived' };
  const budgets = await Budget.find(q).sort({ status: 1, createdAt: 1 });
  return Promise.all(budgets.map((b) => presentBudget(b, today)));
}

async function findBudget(workspaceId, id) {
  const b = await Budget.findOne({ _id: id, workspaceId });
  if (!b) throw ApiError.notFound('Budget not found.');
  return b;
}

export async function getBudget(workspace, id, today) {
  return presentBudget(await findBudget(workspace._id, id), today);
}

/** Spending against the limit for this and the previous `count - 1` periods. */
export async function budgetHistory(workspace, id, today, count = 6) {
  const budget = await findBudget(workspace._id, id);
  const rows = [];
  let period = periodOf(budget.period, today);
  for (let i = 0; i < count; i += 1) {
    const amount = amountFor(budget, period.start);
    const { spent } = await spentBetween(budget, period.start, period.end);
    rows.push(measure(budget, period, amount, spent));
    period = previousPeriod(budget.period, period.start);
  }
  return rows;
}

async function checkCategories(workspaceId, scope, categoryIds) {
  if (scope === 'all') return [];
  if (!categoryIds?.length) throw fieldError('categoryIds', 'Choose at least one spending category.');
  const found = await Category.find({ _id: { $in: categoryIds }, workspaceId, kind: 'expense' }).select('_id').lean();
  if (found.length !== new Set(categoryIds.map(String)).size) throw fieldError('categoryIds', 'Choose spending categories from this workspace.');
  return found.map((c) => c._id);
}

function checkAmount(amount, currency) {
  if (!fitsCurrency(amount, currency)) throw fieldError('amount', `${currency} amounts have at most ${minorUnits(currency)} decimal places.`);
}

export async function createBudget(workspace, input, actor, today, ctx) {
  await assertWithinLimit(workspace, 'budgets');
  checkAmount(input.amount, workspace.baseCurrency);
  const categoryIds = await checkCategories(workspace._id, input.scope, input.categoryIds);
  const budget = await Budget.create({
    workspaceId: workspace._id,
    name: input.name,
    period: input.period,
    scope: input.scope,
    categoryIds,
    currency: workspace.baseCurrency,
    amounts: [{ amount: toDecimal128(normalize(input.amount, workspace.baseCurrency)), effectiveFrom: parse(FIRST_EFFECTIVE) }],
    alertAt: input.alertAt ?? 80,
    notes: input.notes ?? '',
    createdBy: actor._id,
  });
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'budget.created', entityType: 'Budget', entityId: budget._id, metadata: { name: budget.name, period: budget.period, amount: normalize(input.amount, budget.currency) }, ctx });
  return presentBudget(budget, today);
}

export async function updateBudget(workspace, id, changes, actor, today, ctx) {
  const budget = await findBudget(workspace._id, id);
  const before = { name: budget.name, status: budget.status, alertAt: budget.alertAt, amount: amountFor(budget, periodOf(budget.period, today).start) };

  if (changes.scope || changes.categoryIds) {
    const scope = changes.scope ?? budget.scope;
    budget.categoryIds = await checkCategories(workspace._id, scope, changes.categoryIds ?? budget.categoryIds);
    budget.scope = scope;
  }
  if (changes.amount) {
    checkAmount(changes.amount, budget.currency);
    // A new limit applies from the current period on; earlier periods keep theirs.
    const from = parse(periodOf(budget.period, today).start);
    const value = toDecimal128(normalize(changes.amount, budget.currency));
    const same = budget.amounts.find((a) => a.effectiveFrom.getTime() === from.getTime());
    if (same) same.amount = value;
    else budget.amounts.push({ amount: value, effectiveFrom: from });
  }
  for (const key of ['name', 'alertAt', 'notes', 'status']) if (changes[key] !== undefined) budget[key] = changes[key];
  budget.markModified('amounts');
  await budget.save();

  const after = { name: budget.name, status: budget.status, alertAt: budget.alertAt, amount: amountFor(budget, periodOf(budget.period, today).start) };
  const action = changes.status === 'paused' ? 'budget.paused' : changes.status === 'archived' ? 'budget.archived' : changes.status === 'active' && before.status !== 'active' ? 'budget.resumed' : 'budget.updated';
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action, entityType: 'Budget', entityId: budget._id, metadata: { before, after }, ctx });
  return presentBudget(budget, today);
}

/**
 * After an expense changes, alert owners/admins the first time a budget's
 * current period crosses its warning level or its limit. Past periods are
 * not alerted on; that would be noise rather than a useful warning.
 */
export async function checkBudgetAlerts(workspace, { date, categoryId }, timeZone) {
  try {
    const today = todayIn(timeZone);
    const budgets = await Budget.find({
      workspaceId: workspace._id,
      status: 'active',
      $or: [{ scope: 'all' }, { categoryIds: categoryId }],
    });
    for (const b of budgets) {
      const period = periodOf(b.period, today);
      if (date < period.start || date > period.end) continue;
      const p = await progressFor(b, today);
      if (p.state === 'under') continue;
      const users = await workspaceManagers(workspace._id);
      const over = p.state === 'over';
      await notify(users, {
        workspaceId: workspace._id,
        type: over ? 'budget_exceeded' : 'budget_warning',
        title: over ? `${b.name} is over budget` : `${b.name} is at ${p.utilisation}%`,
        body: `${p.spent} of ${p.amount} ${b.currency} spent this ${b.period === 'weekly' ? 'week' : b.period === 'monthly' ? 'month' : 'year'}.`,
        link: `/budgets?focus=${b._id}`,
        data: { budgetId: String(b._id), periodKey: p.key, utilisation: p.utilisation },
        dedupeKey: `budget:${b._id}:${p.key}:${over ? 'over' : 'warn'}`,
      });
    }
  } catch (err) {
    // Alerts must never make a transaction save fail.
    logger.error('budget alert check failed', err);
  }
}
