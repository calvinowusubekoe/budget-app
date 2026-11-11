import mongoose from 'mongoose';
import Decimal from 'decimal.js';
import { ApiError } from '../../utils/ApiError.js';
import { D, fitsCurrency, minorUnits, normalize, str, toDecimal128 } from '../../utils/money.js';
import { addDays, daysBetween, parse } from '../../utils/periods.js';
import { toYmd } from '../../validators/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { Debt, DebtPayment } from './debts.models.js';
import { assertWithinLimit } from '../subscriptions/entitlements.js';

const fieldError = (field, message) => ApiError.validation([{ location: 'body', field, message }]);

function assertFits(value, currency, field) {
  if (!fitsCurrency(value, currency)) throw fieldError(field, `${currency} amounts have at most ${minorUnits(currency)} decimal places.`);
}

async function ledger(debt) {
  const rows = await DebtPayment.aggregate([
    { $match: { debtId: new mongoose.Types.ObjectId(String(debt._id)), status: 'recorded' } },
    { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 }, last: { $max: '$date' } } },
  ]);
  const get = (t) => rows.find((r) => r._id === t);
  const paid = str(get('payment')?.total) ?? '0';
  const charges = str(get('charge')?.total) ?? '0';
  const owedTotal = new D(str(debt.principal)).plus(charges);
  return {
    paid,
    charges,
    owedTotal: owedTotal.toString(),
    balance: owedTotal.minus(paid).toString(),
    paymentCount: get('payment')?.count ?? 0,
    lastPaymentDate: toYmd(get('payment')?.last),
  };
}

export async function summarize(debt, today) {
  const cur = debt.currency;
  const l = await ledger(debt);
  const balance = new D(l.balance);
  const settled = balance.lessThanOrEqualTo(0);
  const due = toYmd(debt.dueDate);
  let projectedPayoff = null;
  const elapsed = daysBetween(toYmd(debt.startDate), today);
  // Average pace since the debt started, once there are at least two weeks to go on.
  if (!settled && elapsed >= 14 && new D(l.paid).greaterThan(0)) {
    const perDay = new D(l.paid).div(elapsed);
    const days = balance.div(perDay).toDecimalPlaces(0, Decimal.ROUND_UP).toNumber();
    projectedPayoff = days < 365 * 100 ? addDays(today, days) : null;
  }
  return {
    paid: normalize(l.paid, cur),
    charges: normalize(l.charges, cur),
    owedTotal: normalize(l.owedTotal, cur),
    balance: normalize(l.balance, cur),
    paidPercent: new D(l.paid).div(l.owedTotal).times(100).toFixed(1),
    paymentCount: l.paymentCount,
    lastPaymentDate: l.lastPaymentDate,
    overdue: Boolean(due && due < today && !settled),
    projectedPayoff,
  };
}

export async function presentDebt(debt, today) {
  return {
    id: String(debt._id),
    name: debt.name,
    direction: debt.direction,
    counterparty: debt.counterparty,
    principal: normalize(str(debt.principal), debt.currency),
    currency: debt.currency,
    interestRate: str(debt.interestRate),
    startDate: toYmd(debt.startDate),
    dueDate: toYmd(debt.dueDate),
    minimumPayment: debt.minimumPayment ? normalize(str(debt.minimumPayment), debt.currency) : null,
    paymentFrequency: debt.paymentFrequency,
    notes: debt.notes,
    status: debt.status,
    paidOffAt: debt.paidOffAt,
    summary: await summarize(debt, today),
    createdAt: debt.createdAt,
  };
}

async function findDebt(workspaceId, id) {
  const d = await Debt.findOne({ _id: id, workspaceId });
  if (!d) throw ApiError.notFound('Debt not found.');
  return d;
}

export async function listDebts(workspace, today, { includeArchived = false } = {}) {
  const q = { workspaceId: workspace._id };
  if (!includeArchived) q.status = { $ne: 'archived' };
  const debts = await Debt.find(q).sort({ status: 1, dueDate: 1, createdAt: 1 });
  return Promise.all(debts.map((d) => presentDebt(d, today)));
}

export async function getDebt(workspace, id, today) {
  return presentDebt(await findDebt(workspace._id, id), today);
}

export async function createDebt(workspace, input, actor, today, ctx) {
  await assertWithinLimit(workspace, 'debts');
  assertFits(input.principal, input.currency, 'principal');
  if (input.minimumPayment) assertFits(input.minimumPayment, input.currency, 'minimumPayment');
  if (input.dueDate && input.dueDate < input.startDate) throw fieldError('dueDate', 'The due date must be after the start date.');
  const debt = await Debt.create({
    workspaceId: workspace._id,
    name: input.name,
    direction: input.direction,
    counterparty: input.counterparty ?? '',
    principal: toDecimal128(normalize(input.principal, input.currency)),
    currency: input.currency,
    interestRate: input.interestRate ? toDecimal128(input.interestRate) : null,
    startDate: parse(input.startDate),
    dueDate: input.dueDate ? parse(input.dueDate) : null,
    minimumPayment: input.minimumPayment ? toDecimal128(normalize(input.minimumPayment, input.currency)) : null,
    paymentFrequency: input.paymentFrequency ?? 'monthly',
    notes: input.notes ?? '',
    createdBy: actor._id,
  });
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'debt.created', entityType: 'Debt', entityId: debt._id, metadata: { name: debt.name, direction: debt.direction, principal: str(debt.principal), currency: debt.currency }, ctx });
  return presentDebt(debt, today);
}

export async function updateDebt(workspace, id, changes, actor, today, ctx) {
  const debt = await findDebt(workspace._id, id);
  const hasEntries = await DebtPayment.exists({ debtId: debt._id });
  const before = { name: debt.name, principal: str(debt.principal), dueDate: toYmd(debt.dueDate), status: debt.status };
  if (changes.currency && changes.currency !== debt.currency) {
    if (hasEntries) throw ApiError.conflict('This debt already has payments, so its currency can’t change.', 'CURRENCY_LOCKED');
    debt.currency = changes.currency;
  }
  if (changes.principal) {
    // The original amount is the anchor of the ledger; corrections after payments go through charges.
    if (hasEntries) throw ApiError.conflict('Payments are already recorded against this amount. Record a charge to add to the debt instead.', 'PRINCIPAL_LOCKED');
    assertFits(changes.principal, debt.currency, 'principal');
    debt.principal = toDecimal128(normalize(changes.principal, debt.currency));
  }
  if (changes.minimumPayment !== undefined) {
    if (changes.minimumPayment) assertFits(changes.minimumPayment, debt.currency, 'minimumPayment');
    debt.minimumPayment = changes.minimumPayment ? toDecimal128(normalize(changes.minimumPayment, debt.currency)) : null;
  }
  if (changes.interestRate !== undefined) debt.interestRate = changes.interestRate ? toDecimal128(changes.interestRate) : null;
  if (changes.dueDate !== undefined) debt.dueDate = changes.dueDate ? parse(changes.dueDate) : null;
  if (changes.startDate) debt.startDate = parse(changes.startDate);
  for (const key of ['name', 'counterparty', 'paymentFrequency', 'notes']) if (changes[key] !== undefined) debt[key] = changes[key];
  if (changes.status === 'archived') debt.status = 'archived';
  if (changes.status === 'active' && debt.status === 'archived') await syncStatus(debt, today, actor, ctx, { force: true });
  await debt.save();
  const after = { name: debt.name, principal: str(debt.principal), dueDate: toYmd(debt.dueDate), status: debt.status };
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: changes.status === 'archived' ? 'debt.archived' : 'debt.updated', entityType: 'Debt', entityId: debt._id, metadata: { before, after }, ctx });
  return presentDebt(debt, today);
}

/** Moves a debt between active and paid_off as its balance changes. */
async function syncStatus(debt, today, actor, ctx, { force = false } = {}) {
  if (debt.status === 'archived' && !force) return;
  const { balance } = await ledger(debt);
  const settled = new D(balance).lessThanOrEqualTo(0);
  const next = settled ? 'paid_off' : 'active';
  if (next !== debt.status) {
    debt.status = next;
    debt.paidOffAt = settled ? new Date() : null;
    await debt.save();
    await recordAudit({ workspaceId: debt.workspaceId, actorId: actor._id, action: settled ? 'debt.paid_off' : 'debt.reopened', entityType: 'Debt', entityId: debt._id, ctx });
  }
}

export function presentPayment(p, currency) {
  return { id: String(p._id), type: p.type, amount: normalize(str(p.amount), currency), date: toYmd(p.date), notes: p.notes, status: p.status, reversedAt: p.reversedAt, reversalReason: p.reversalReason, createdAt: p.createdAt };
}

export async function listPayments(workspace, debtId) {
  const debt = await findDebt(workspace._id, debtId);
  const rows = await DebtPayment.find({ debtId: debt._id }).sort({ date: -1, createdAt: -1 }).lean();
  return rows.map((p) => presentPayment(p, debt.currency));
}

export async function addPayment(workspace, debtId, input, actor, today, ctx) {
  const debt = await findDebt(workspace._id, debtId);
  if (debt.status === 'archived') throw ApiError.badRequest('This debt is archived. Restore it to record payments.');
  assertFits(input.amount, debt.currency, 'amount');
  if (input.date > today) throw fieldError('date', 'Payments can’t be dated in the future.');
  if (input.date < toYmd(debt.startDate)) throw fieldError('date', 'This is before the debt started.');
  if (input.type === 'payment') {
    const { balance } = await ledger(debt);
    if (new D(input.amount).greaterThan(balance)) {
      throw fieldError('amount', `That’s more than the ${normalize(balance, debt.currency)} ${debt.currency} still outstanding.`);
    }
  }
  const payment = await DebtPayment.create({
    workspaceId: workspace._id,
    debtId: debt._id,
    type: input.type,
    amount: toDecimal128(normalize(input.amount, debt.currency)),
    date: parse(input.date),
    notes: input.notes ?? '',
    createdBy: actor._id,
  });
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: `debt.${input.type}_recorded`, entityType: 'Debt', entityId: debt._id, metadata: { paymentId: String(payment._id), amount: str(payment.amount), date: input.date }, ctx });
  await syncStatus(debt, today, actor, ctx);
  return { payment: presentPayment(payment, debt.currency), debt: await presentDebt(debt, today) };
}

export async function reversePayment(workspace, debtId, paymentId, reason, actor, today, ctx) {
  const debt = await findDebt(workspace._id, debtId);
  const p = await DebtPayment.findOne({ _id: paymentId, debtId: debt._id, status: 'recorded' });
  if (!p) throw ApiError.notFound('Entry not found, or already reversed.');
  if (p.type === 'charge') {
    const { balance } = await ledger(debt);
    if (new D(balance).minus(str(p.amount)).lessThan(0)) {
      throw ApiError.conflict('Reversing this charge would mean more was paid than owed. Reverse the extra payment first.', 'WOULD_GO_NEGATIVE');
    }
  }
  p.status = 'reversed';
  p.reversedAt = new Date();
  p.reversedBy = actor._id;
  p.reversalReason = reason;
  await p.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'debt.entry_reversed', entityType: 'Debt', entityId: debt._id, metadata: { paymentId: String(p._id), type: p.type, amount: str(p.amount), reason }, ctx });
  await syncStatus(debt, today, actor, ctx);
  return { payment: presentPayment(p, debt.currency), debt: await presentDebt(debt, today) };
}

/** Outstanding totals per direction and currency. Never mixed across currencies. */
export async function debtOverview(workspaceId, today) {
  const debts = await Debt.find({ workspaceId, status: 'active' });
  const sums = new Map();
  for (const d of debts) {
    const s = await summarize(d, today);
    const key = `${d.direction}:${d.currency}`;
    const row = sums.get(key) ?? { direction: d.direction, currency: d.currency, balance: new D(0), count: 0, overdue: 0 };
    row.balance = row.balance.plus(s.balance);
    row.count += 1;
    if (s.overdue) row.overdue += 1;
    sums.set(key, row);
  }
  return [...sums.values()].map((r) => ({ ...r, balance: normalize(r.balance.toString(), r.currency) }));
}
