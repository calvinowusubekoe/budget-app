import mongoose from 'mongoose';
import { D, normalize, str } from '../../utils/money.js';
import { addDays, daysBetween } from '../../utils/periods.js';
import { toYmd } from '../../validators/money.js';
import { summarize } from '../transactions/transactions.service.js';
import { Transaction } from '../transactions/transaction.model.js';
import { Bill, Customer, Invoice, Supplier } from './business.models.js';
import { balances } from './documents.service.js';

/*
 * Business reports, cash basis: income and expenses are what was recorded as
 * received and paid. Unpaid invoices and bills are shown separately as
 * receivables and payables. Practical bookkeeping, not certified accounts.
 */

export const BASIS_NOTE = 'Cash basis: figures come from income and expenses recorded in Kontaa. Not a certified financial statement or tax return.';

const pct = (part, whole) => (new D(whole).isZero() ? null : new D(part).div(whole).times(100).toFixed(1));

/** Profit and loss for a period, with the same-length period before it for comparison. */
export async function profitAndLoss(workspace, { from, to }) {
  const length = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(length - 1));
  const [cur, prev] = await Promise.all([summarize(workspace, { from, to }), summarize(workspace, { from: prevFrom, to: prevTo })]);
  const c = workspace.baseCurrency;
  const change = (a, b) => ({ amount: normalize(new D(a).minus(b).toString(), c), percent: pct(new D(a).minus(b).toString(), b) });
  return {
    currency: c,
    basis: 'cash',
    note: BASIS_NOTE,
    period: { from, to },
    previousPeriod: { from: prevFrom, to: prevTo },
    income: { total: cur.income, byCategory: cur.incomeByCategory },
    expenses: { total: cur.expense, byCategory: cur.expenseByCategory },
    netProfit: cur.net,
    margin: pct(cur.net, cur.income),
    previous: { income: prev.income, expenses: prev.expense, netProfit: prev.net },
    change: { income: change(cur.income, prev.income), expenses: change(cur.expense, prev.expense), netProfit: change(cur.net, prev.net) },
  };
}

/** Money in and out per calendar month, in the reporting currency. Transfers are excluded. */
export async function cashFlow(workspace, { from, to }) {
  const c = workspace.baseCurrency;
  const rows = await Transaction.aggregate([
    {
      $match: {
        workspaceId: new mongoose.Types.ObjectId(String(workspace._id)),
        deletedAt: null,
        type: { $in: ['income', 'expense'] },
        'reporting.currency': c,
        date: { $gte: new Date(`${from}T00:00:00Z`), $lte: new Date(`${to}T00:00:00Z`) },
      },
    },
    { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$date' } }, t: '$type' }, total: { $sum: '$reporting.amount' } } },
  ]);
  const months = [];
  for (let d = from.slice(0, 7); d <= to.slice(0, 7); ) {
    months.push(d);
    const [y, m] = d.split('-').map(Number);
    d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  const get = (m, t) => str(rows.find((r) => r._id.m === m && r._id.t === t)?.total) ?? '0';
  let running = new D(0);
  const series = months.map((m) => {
    const inflow = new D(get(m, 'income'));
    const outflow = new D(get(m, 'expense'));
    const net = inflow.minus(outflow);
    running = running.plus(net);
    return { month: m, inflow: normalize(inflow.toString(), c), outflow: normalize(outflow.toString(), c), net: normalize(net.toString(), c), cumulative: normalize(running.toString(), c) };
  });
  const sum = (f) => normalize(series.reduce((acc, s) => acc.plus(s[f]), new D(0)).toString(), c);
  return { currency: c, note: BASIS_NOTE, period: { from, to }, months: series, totals: { inflow: sum('inflow'), outflow: sum('outflow'), net: sum('net') } };
}

const BUCKETS = [
  { key: 'current', label: 'Not yet due', test: (d) => d <= 0 },
  { key: 'd1_30', label: '1–30 days overdue', test: (d) => d >= 1 && d <= 30 },
  { key: 'd31_60', label: '31–60 days', test: (d) => d >= 31 && d <= 60 },
  { key: 'd61_90', label: '61–90 days', test: (d) => d >= 61 && d <= 90 },
  { key: 'd90_plus', label: 'Over 90 days', test: (d) => d > 90 },
];

/** Receivables (invoices) or payables (bills) still owed, grouped by how overdue they are, per currency. */
export async function aging(kind, workspace, today) {
  const Model = kind === 'receivables' ? Invoice : Bill;
  const Party = kind === 'receivables' ? Customer : Supplier;
  const partyField = kind === 'receivables' ? 'customerId' : 'supplierId';
  const docs = await Model.find({ workspaceId: workspace._id, status: 'issued' });
  const parties = new Map((await Party.find({ _id: { $in: docs.map((d) => d[partyField]) } }).select('name').lean()).map((p) => [String(p._id), p.name]));
  const byCurrency = new Map();
  const items = [];
  for (const d of docs) {
    const { balance } = balances(d);
    if (new D(balance).isZero()) continue;
    const days = daysBetween(toYmd(d.dueDate), today);
    const bucket = BUCKETS.find((b) => b.test(days)).key;
    const row = byCurrency.get(d.currency) ?? { currency: d.currency, total: new D(0), count: 0, ...Object.fromEntries(BUCKETS.map((b) => [b.key, new D(0)])) };
    row.total = row.total.plus(balance);
    row[bucket] = row[bucket].plus(balance);
    row.count += 1;
    byCurrency.set(d.currency, row);
    items.push({ id: String(d._id), number: d.number, party: parties.get(String(d[partyField])) ?? '', dueDate: toYmd(d.dueDate), daysOverdue: Math.max(days, 0), bucket, currency: d.currency, balance });
  }
  return {
    kind,
    asOf: today,
    buckets: BUCKETS.map((b) => ({ key: b.key, label: b.label })),
    totals: [...byCurrency.values()].map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof D ? normalize(v.toString(), r.currency) : v]))),
    items: items.sort((a, b) => b.daysOverdue - a.daysOverdue),
  };
}

/** One call for the business overview. */
export async function businessOverview(workspace, { from, to }, today) {
  const [pl, receivables, payables] = await Promise.all([profitAndLoss(workspace, { from, to }), aging('receivables', workspace, today), aging('payables', workspace, today)]);
  return { profitAndLoss: pl, receivables: receivables.totals, payables: payables.totals, overdueInvoices: receivables.items.filter((i) => i.daysOverdue > 0).length, overdueBills: payables.items.filter((i) => i.daysOverdue > 0).length };
}
