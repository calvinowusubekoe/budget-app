import mongoose from 'mongoose';
import { D, normalize, str } from '../../utils/money.js';
import { addDays, daysBetween, ymd } from '../../utils/periods.js';
import { toUtcDate } from '../../validators/money.js';
import { Transaction } from '../transactions/transaction.model.js';
import { Category } from '../categories/category.model.js';
import { SavingsEntry, SavingsGoal } from '../savings/savings.models.js';
import { presentGoal } from '../savings/savings.service.js';
import { SusuContribution, SusuWithdrawal } from '../susu/susu.models.js';
import { susuSummary } from '../susu/personal.service.js';
import { SusuGroup, SusuGroupMember, SusuGroupContribution, SusuPayout } from '../susu/group.models.js';
import { myGroupStanding } from '../susu/groupRecords.service.js';
import { Payment } from '../payments/payment.models.js';

/**
 * Deterministic analytics. Every figure is an exact decimal sum computed
 * here; the client and the AI assistant only display or quote them.
 *
 * Income and expense figures use tracked income/expense transactions only.
 * Transfers, savings allocations, Susu records and BudgetFlow subscription
 * payments are reported separately and never mixed into those totals.
 */

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const zero = (cur) => normalize('0', cur);
const pct = (part, whole) => (new D(whole).isZero() ? null : new D(part).div(whole).times(100).toFixed(1));
const change = (now, before) => (new D(before).isZero() ? null : new D(now).minus(before).div(before).times(100).toFixed(1));

/* ---------------- periods ---------------- */

const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

export function bucketOf(granularity, y, m) {
  if (granularity === 'year') return { key: `${y}`, label: `${y}`, start: `${y}-01-01`, end: `${y}-12-31` };
  if (granularity === 'quarter') {
    const q = Math.ceil(m / 3);
    const sm = (q - 1) * 3 + 1;
    return { key: `${y}-Q${q}`, label: `Q${q} ${y}`, start: `${y}-${pad(sm)}-01`, end: `${y}-${pad(sm + 2)}-${pad(lastDay(y, sm + 2))}` };
  }
  return { key: `${y}-${pad(m)}`, label: new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }), start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
}

/** Every bucket touching [from, to], in order, so empty periods still appear. */
export function bucketsBetween(granularity, from, to) {
  const out = [];
  const seen = new Set();
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endKey = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  while (y * 12 + m <= endKey) {
    const b = bucketOf(granularity, y, m);
    if (!seen.has(b.key)) {
      seen.add(b.key);
      // Clip the first and last buckets to the requested range.
      out.push({ ...b, start: b.start < from ? from : b.start, end: b.end > to ? to : b.end });
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The same-length period immediately before [from, to]. */
export function previousRange(from, to) {
  const days = daysBetween(from, to) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

const range = (from, to) => ({ $gte: toUtcDate(from), $lte: toUtcDate(to) });
const monthParts = { y: { $year: '$date' }, m: { $month: '$date' } };

/** Sums a decimal field by month, then rolls months into buckets in decimal. */
async function monthlySums(Model, match, extraGroup = {}, field = '$amount') {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: { ...monthParts, ...extraGroup }, total: { $sum: field }, count: { $sum: 1 } } }]);
  return rows.map((r) => ({ ...r._id, total: str(r.total), count: r.count }));
}

function roll(granularity, buckets, rows, keyOf = () => 'all') {
  const index = new Map(buckets.map((b) => [b.key, b]));
  const out = new Map();
  for (const r of rows) {
    const b = bucketOf(granularity, r.y, r.m);
    if (!index.has(b.key)) continue;
    const k = `${b.key}|${keyOf(r)}`;
    const cur = out.get(k) ?? { total: new D(0), count: 0 };
    cur.total = cur.total.plus(r.total);
    cur.count += r.count;
    out.set(k, cur);
  }
  return out;
}

/* ---------------- income vs spending ---------------- */

function txMatch(workspace, from, to, extra = {}) {
  return { workspaceId: oid(workspace._id), deletedAt: null, 'reporting.currency': workspace.baseCurrency, date: range(from, to), ...extra };
}

export async function incomeExpenseSeries(workspace, { from, to, granularity = 'month' }) {
  const cur = workspace.baseCurrency;
  const buckets = bucketsBetween(granularity, from, to);
  const rows = await monthlySums(Transaction, txMatch(workspace, from, to, { type: { $in: ['income', 'expense'] } }), { type: '$type' }, '$reporting.amount');
  const sums = roll(granularity, buckets, rows, (r) => r.type);
  const get = (b, t) => sums.get(`${b.key}|${t}`)?.total ?? new D(0);

  let cumulative = new D(0);
  const series = buckets.map((b) => {
    const income = get(b, 'income');
    const expense = get(b, 'expense');
    const net = income.minus(expense);
    cumulative = cumulative.plus(net);
    return {
      key: b.key,
      label: b.label,
      start: b.start,
      end: b.end,
      income: normalize(income.toString(), cur),
      expense: normalize(expense.toString(), cur),
      net: normalize(net.toString(), cur),
      cumulativeNet: normalize(cumulative.toString(), cur),
      savingsRate: income.isZero() ? null : net.div(income).times(100).toFixed(1),
    };
  });
  const total = series.reduce((a, s) => ({ income: a.income.plus(s.income), expense: a.expense.plus(s.expense) }), { income: new D(0), expense: new D(0) });
  const net = total.income.minus(total.expense);

  const prev = previousRange(from, to);
  const prevRows = await Transaction.aggregate([{ $match: txMatch(workspace, prev.from, prev.to, { type: { $in: ['income', 'expense'] } }) }, { $group: { _id: '$type', total: { $sum: '$reporting.amount' } } }]);
  const prevOf = (t) => str(prevRows.find((r) => r._id === t)?.total) ?? '0';
  const prevIncome = normalize(prevOf('income'), cur);
  const prevExpense = normalize(prevOf('expense'), cur);

  return {
    currency: cur,
    from,
    to,
    granularity,
    series,
    totals: {
      income: normalize(total.income.toString(), cur),
      expense: normalize(total.expense.toString(), cur),
      net: normalize(net.toString(), cur),
      savingsRate: total.income.isZero() ? null : net.div(total.income).times(100).toFixed(1),
    },
    previous: {
      from: prev.from,
      to: prev.to,
      income: prevIncome,
      expense: prevExpense,
      net: normalize(new D(prevIncome).minus(prevExpense).toString(), cur),
      incomeChange: change(total.income, prevIncome),
      expenseChange: change(total.expense, prevExpense),
    },
  };
}

/* ---------------- spending ---------------- */

const median = (values) => {
  const s = [...values].sort((a, b) => a.comparedTo(b));
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : s[mid - 1].plus(s[mid]).div(2);
};

/**
 * Spending by category against the previous equal-length period, plus
 * unusual patterns found by fixed rules (no model involved):
 *  - a category at least 1.5× its average over the three previous periods,
 *    and at least 5% of this period's spending;
 *  - a single expense more than 3× the median of its category over the
 *    previous 180 days (needs 5+ earlier expenses in that category).
 */
export async function spendingAnalysis(workspace, { from, to }) {
  const cur = workspace.baseCurrency;
  const days = daysBetween(from, to) + 1;
  const byCategory = async (f, t) =>
    Transaction.aggregate([{ $match: txMatch(workspace, f, t, { type: 'expense' }) }, { $group: { _id: '$categoryId', total: { $sum: '$reporting.amount' }, count: { $sum: 1 } } }]);

  const prevRanges = [1, 2, 3].map((n) => ({ from: addDays(from, -days * n), to: addDays(from, -days * (n - 1) - 1) }));
  const [current, ...previous] = await Promise.all([byCategory(from, to), ...prevRanges.map((r) => byCategory(r.from, r.to))]);

  const ids = new Set([...current, ...previous.flat()].map((r) => String(r._id)));
  const cats = await Category.find({ workspaceId: workspace._id, _id: { $in: [...ids].filter((i) => i !== 'null').map(oid) } }).select('name icon').lean();
  const names = new Map(cats.map((c) => [String(c._id), c]));

  const totalNow = current.reduce((a, r) => a.plus(str(r.total)), new D(0));
  const prevMap = (rows) => new Map(rows.map((r) => [String(r._id), new D(str(r.total))]));
  const [p1, p2, p3] = previous.map(prevMap);
  const totalPrev = [...p1.values()].reduce((a, v) => a.plus(v), new D(0));

  const categories = current
    .map((r) => {
      const id = String(r._id);
      const amount = new D(str(r.total));
      const before = p1.get(id) ?? new D(0);
      const history = [p1, p2, p3].map((m) => m.get(id) ?? new D(0));
      const avg = history.reduce((a, v) => a.plus(v), new D(0)).div(3);
      return {
        categoryId: id,
        name: names.get(id)?.name ?? 'Uncategorised',
        icon: names.get(id)?.icon ?? 'tag',
        amount: normalize(amount.toString(), cur),
        count: r.count,
        share: pct(amount, totalNow) ?? '0.0',
        previous: normalize(before.toString(), cur),
        change: change(amount, before),
        threePeriodAverage: normalize(avg.toString(), cur),
        _amount: amount,
        _avg: avg,
      };
    })
    .sort((a, b) => b._amount.comparedTo(a._amount));

  const unusual = [];
  for (const c of categories) {
    if (c._avg.greaterThan(0) && c._amount.gte(c._avg.times(1.5)) && totalNow.greaterThan(0) && c._amount.div(totalNow).gte(0.05)) {
      unusual.push({ kind: 'category_spike', categoryId: c.categoryId, category: c.name, amount: c.amount, average: c.threePeriodAverage, ratio: c._amount.div(c._avg).toFixed(1) });
    }
  }

  // Large single expenses in this period.
  const histStart = addDays(from, -180);
  const big = await Transaction.find(txMatch(workspace, from, to, { type: 'expense' })).sort({ 'reporting.amount': -1 }).limit(10).select('date description categoryId reporting.amount').lean();
  for (const tx of big) {
    const earlier = await Transaction.find(txMatch(workspace, histStart, addDays(from, -1), { type: 'expense', categoryId: tx.categoryId })).select('reporting.amount').limit(500).lean();
    if (earlier.length < 5) continue;
    const med = median(earlier.map((e) => new D(str(e.reporting.amount))));
    const amt = new D(str(tx.reporting.amount));
    if (med && med.greaterThan(0) && amt.greaterThan(med.times(3))) {
      unusual.push({ kind: 'large_expense', transactionId: String(tx._id), date: ymd(tx.date), category: names.get(String(tx.categoryId))?.name ?? 'Uncategorised', amount: normalize(amt.toString(), cur), typical: normalize(med.toString(), cur), ratio: amt.div(med).toFixed(1) });
    }
  }

  return {
    currency: cur,
    from,
    to,
    total: normalize(totalNow.toString(), cur),
    previousTotal: normalize(totalPrev.toString(), cur),
    change: change(totalNow, totalPrev),
    previous: prevRanges[0],
    categories: categories.map(({ _amount, _avg, ...c }) => c),
    unusual,
    rules: 'Unusual means a category at least 1.5× its average over the three previous periods (and 5%+ of spending), or one expense over 3× the typical amount for its category in the previous 180 days.',
  };
}

/* ---------------- savings and Susu ---------------- */

export async function savingsAnalysis(workspace, user, { from, to, granularity = 'month' }, today) {
  const buckets = bucketsBetween(granularity, from, to);
  const goals = await SavingsGoal.find({ workspaceId: workspace._id, status: 'active' });
  const goalCurrency = new Map(goals.map((g) => [String(g._id), g.currency]));

  // Savings entries carry no currency of their own; it's the goal's.
  const sRows = await SavingsEntry.aggregate([
    { $match: { workspaceId: oid(workspace._id), status: 'recorded', date: range(from, to) } },
    { $group: { _id: { ...monthParts, goalId: '$goalId', type: '$type' }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  const allGoals = await SavingsGoal.find({ _id: { $in: sRows.map((r) => r._id.goalId) } }).select('currency').lean();
  for (const g of allGoals) goalCurrency.set(String(g._id), g.currency);
  const savingsRows = sRows.map((r) => ({ y: r._id.y, m: r._id.m, type: r._id.type, currency: goalCurrency.get(String(r._id.goalId)), total: str(r.total), count: r.count }));

  const seriesFor = (rows, inType, outType) => {
    const currencies = [...new Set(rows.map((r) => r.currency))].sort();
    return currencies.map((c) => {
      const mine = rows.filter((r) => r.currency === c);
      const sums = roll(granularity, buckets, mine, (r) => r.type);
      const g = (b, t) => sums.get(`${b.key}|${t}`)?.total ?? new D(0);
      return {
        currency: c,
        points: buckets.map((b) => ({ key: b.key, label: b.label, in: normalize(g(b, inType).toString(), c), out: normalize(g(b, outType).toString(), c), net: normalize(g(b, inType).minus(g(b, outType)).toString(), c) })),
      };
    });
  };

  const susuMatch = { workspaceId: oid(workspace._id), status: 'recorded', date: range(from, to) };
  const [contrib, withdraw] = await Promise.all([monthlySums(SusuContribution, susuMatch, { currency: '$currency' }), monthlySums(SusuWithdrawal, susuMatch, { currency: '$currency' })]);
  const susuRows = [...contrib.map((r) => ({ ...r, type: 'in' })), ...withdraw.map((r) => ({ ...r, type: 'out' }))];

  return {
    from,
    to,
    granularity,
    goals: await Promise.all(goals.map((g) => presentGoal(g, today))),
    savingsFlow: seriesFor(savingsRows, 'contribution', 'withdrawal'),
    personalSusu: { ...(await susuSummary(workspace, today)), flow: seriesFor(susuRows, 'in', 'out') },
    groupSusu: await groupPerformance(user, today),
  };
}

/** The signed-in member's standing in each active group. Groups aren't part of any workspace. */
export async function groupPerformance(user, today) {
  const memberships = await SusuGroupMember.find({ userId: user._id, status: 'active' });
  if (!memberships.length) return [];
  const groups = await SusuGroup.find({ _id: { $in: memberships.map((m) => m.groupId) }, status: 'active' });
  const byGroup = new Map(memberships.map((m) => [String(m.groupId), m]));
  const standing = await myGroupStanding(groups, byGroup, today);
  return groups.map((g) => {
    const s = standing.find((x) => x.groupId === String(g._id));
    return { groupId: String(g._id), name: g.name, currency: g.currency, outstanding: s?.outstanding ?? zero(g.currency), missedCycles: s?.missedCycles ?? 0, nextCycle: s?.nextCycle ?? null };
  });
}

/* ---------------- the separated view ---------------- */

const byCurrencyTotals = async (Model, match, field = '$amount', currencyField = '$currency') => {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: currencyField, total: { $sum: field }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
  return rows.map((r) => ({ currency: r._id, amount: normalize(str(r.total), r._id), count: r.count }));
};

/**
 * Six kinds of money movement, kept apart. Only the first is income and
 * spending; nothing from the others is added to it.
 */
export async function separatedTotals(workspace, user, { from, to }, { includeSubscriptions }) {
  const cur = workspace.baseCurrency;
  const w = oid(workspace._id);
  const dates = range(from, to);
  const [tracked] = await Transaction.aggregate([
    { $match: txMatch(workspace, from, to, { type: { $in: ['income', 'expense'] } }) },
    { $group: { _id: null, income: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$reporting.amount', 0] } }, expense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$reporting.amount', 0] } }, count: { $sum: 1 } } },
  ]);
  const transfers = await byCurrencyTotals(Transaction, { workspaceId: w, deletedAt: null, type: 'transfer', date: dates });

  const savingsRows = await SavingsEntry.aggregate([{ $match: { workspaceId: w, status: 'recorded', date: dates } }, { $group: { _id: { goalId: '$goalId', type: '$type' }, total: { $sum: '$amount' }, count: { $sum: 1 } } }]);
  const goals = new Map((await SavingsGoal.find({ _id: { $in: savingsRows.map((r) => r._id.goalId) } }).select('currency').lean()).map((g) => [String(g._id), g.currency]));
  const savings = new Map();
  for (const r of savingsRows) {
    const c = goals.get(String(r._id.goalId));
    const row = savings.get(c) ?? { currency: c, contributed: new D(0), withdrawn: new D(0), count: 0 };
    row[r._id.type === 'contribution' ? 'contributed' : 'withdrawn'] = row[r._id.type === 'contribution' ? 'contributed' : 'withdrawn'].plus(str(r.total));
    row.count += r.count;
    savings.set(c, row);
  }

  const susuMatch = { workspaceId: w, status: 'recorded', date: dates };
  const [susuIn, susuOut] = await Promise.all([byCurrencyTotals(SusuContribution, susuMatch), byCurrencyTotals(SusuWithdrawal, susuMatch)]);

  const myMemberships = await SusuGroupMember.find({ userId: user._id }).select('_id').lean();
  const memberIds = myMemberships.map((m) => m._id);
  const live = { $in: ['recorded', 'confirmed'] };
  const [groupIn, groupOut] = memberIds.length
    ? await Promise.all([
        byCurrencyTotals(SusuGroupContribution, { memberId: { $in: memberIds }, status: live, date: dates }),
        byCurrencyTotals(SusuPayout, { recipientMemberId: { $in: memberIds }, status: live, payoutDate: dates }, '$actualAmount'),
      ])
    : [[], []];

  let subscriptions = null;
  if (includeSubscriptions) {
    subscriptions = await byCurrencyTotals(Payment, { workspaceId: w, status: { $in: ['succeeded', 'partially_refunded'] }, paidAt: dates });
  }

  return {
    from,
    to,
    trackedIncomeExpense: {
      currency: cur,
      income: normalize(str(tracked?.income) ?? '0', cur),
      expense: normalize(str(tracked?.expense) ?? '0', cur),
      count: tracked?.count ?? 0,
    },
    transfers,
    savingsAllocations: [...savings.values()].map((r) => ({ currency: r.currency, contributed: normalize(r.contributed.toString(), r.currency), withdrawn: normalize(r.withdrawn.toString(), r.currency), count: r.count })),
    personalSusu: { contributions: susuIn, withdrawals: susuOut },
    groupSusu: { yourContributions: groupIn, payoutsToYou: groupOut },
    subscriptionPayments: subscriptions,
  };
}

