import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { D, fitsCurrency, minorUnits, normalize, str, toDecimal128 } from '../../utils/money.js';
import { daysBetween, parse } from '../../utils/periods.js';
import { toYmd } from '../../validators/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { Account } from '../accounts/account.model.js';
import { Category } from '../categories/category.model.js';
import { ensureDefaultCategories } from '../categories/categories.service.js';
import { Transaction } from '../transactions/transaction.model.js';
import { createTransaction, deleteTransaction } from '../transactions/transactions.service.js';
import { Bill, Customer, Invoice, nextNumber, Supplier } from './business.models.js';
import { computeLines } from './lines.js';
import { assertWithinLimit } from '../subscriptions/entitlements.js';

/*
 * Invoices (money owed to the business) and bills (money the business owes)
 * share one lifecycle: draft, then issued, then paid in one or more payments,
 * or void. A payment is recorded as an income (invoice) or expense (bill)
 * transaction in a tracking account. Kontaa doesn't send or receive the money.
 */

export const KINDS = {
  invoice: { Model: Invoice, Party: Customer, partyField: 'customerId', partyLabel: 'customer', txType: 'income', txField: 'invoiceId', category: 'business_revenue', prefix: 'INV-', label: 'Invoice' },
  bill: { Model: Bill, Party: Supplier, partyField: 'supplierId', partyLabel: 'supplier', txType: 'expense', txField: 'billId', category: 'business_expenses', prefix: 'BILL-', label: 'Bill' },
};

const fieldError = (field, message) => ApiError.validation([{ location: 'body', field, message }]);

function livePayments(doc) {
  return doc.payments.filter((p) => !p.removedAt);
}

export function balances(doc) {
  const cur = doc.currency;
  const paid = livePayments(doc).reduce((acc, p) => acc.plus(str(p.amount)), new D(0));
  const total = new D(str(doc.total));
  return { paid: normalize(paid.toString(), cur), balance: normalize(D.max(total.minus(paid), 0).toString(), cur), fullyPaid: paid.greaterThanOrEqualTo(total) };
}

/** Status people see: draft, void, paid, partially paid, overdue or open. */
export function displayStatus(doc, today) {
  if (doc.status !== 'issued') return doc.status;
  const { paid, fullyPaid } = balances(doc);
  if (fullyPaid) return 'paid';
  if (toYmd(doc.dueDate) < today) return 'overdue';
  return new D(paid).greaterThan(0) ? 'partially_paid' : 'open';
}

export async function presentDoc(kind, doc, today, party) {
  const k = KINDS[kind];
  const p = party ?? (await k.Party.findById(doc[k.partyField]).select('name email').lean());
  const cur = doc.currency;
  const b = balances(doc);
  const accounts = await Account.find({ _id: { $in: doc.payments.map((x) => x.accountId) } }).select('name').lean();
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));
  // Payment receipts are attachments on each payment's linked transaction.
  const linked = await Transaction.find({ _id: { $in: doc.payments.map((x) => x.transactionId) } }).select('attachmentCount').lean();
  const receipts = new Map(linked.map((t) => [String(t._id), t.attachmentCount ?? 0]));
  return {
    id: String(doc._id),
    kind,
    number: doc.number,
    reference: doc.reference ?? undefined,
    party: p ? { id: String(p._id), name: p.name, email: p.email } : null,
    issueDate: toYmd(doc.issueDate),
    dueDate: toYmd(doc.dueDate),
    currency: cur,
    lines: doc.lines.map((l) => ({ description: l.description, quantity: str(l.quantity), unitPrice: normalize(str(l.unitPrice), cur), taxRate: str(l.taxRate), amount: normalize(str(l.amount), cur), tax: normalize(str(l.tax), cur) })),
    subtotal: normalize(str(doc.subtotal), cur),
    taxTotal: normalize(str(doc.taxTotal), cur),
    total: normalize(str(doc.total), cur),
    paid: b.paid,
    balance: b.balance,
    status: doc.status,
    displayStatus: displayStatus(doc, today),
    daysOverdue: doc.status === 'issued' && !b.fullyPaid ? Math.max(daysBetween(toYmd(doc.dueDate), today), 0) : 0,
    payments: doc.payments.map((x) => ({
      id: String(x._id),
      amount: normalize(str(x.amount), cur),
      date: toYmd(x.date),
      account: { id: String(x.accountId), name: accountName.get(String(x.accountId)) ?? 'Account' },
      transactionId: String(x.transactionId),
      receiptCount: receipts.get(String(x.transactionId)) ?? 0,
      removed: Boolean(x.removedAt),
      removeReason: x.removeReason,
    })),
    notes: doc.notes,
    terms: doc.terms,
    voidReason: doc.voidReason,
    issuedAt: doc.issuedAt,
    createdAt: doc.createdAt,
  };
}

async function findDoc(kind, workspaceId, id) {
  const doc = await KINDS[kind].Model.findOne({ _id: id, workspaceId });
  if (!doc) throw ApiError.notFound(`${KINDS[kind].label} not found.`);
  return doc;
}

export async function listDocs(kind, workspace, today, filters = {}) {
  const k = KINDS[kind];
  const q = { workspaceId: workspace._id };
  if (filters.partyId) q[k.partyField] = new mongoose.Types.ObjectId(filters.partyId);
  if (filters.status === 'draft' || filters.status === 'void') q.status = filters.status;
  else if (filters.status) q.status = 'issued';
  const docs = await k.Model.find(q).sort({ issueDate: -1, number: -1 }).limit(500);
  const parties = await k.Party.find({ _id: { $in: docs.map((d) => d[k.partyField]) } }).select('name email').lean();
  const byId = new Map(parties.map((p) => [String(p._id), p]));
  let out = await Promise.all(docs.map((d) => presentDoc(kind, d, today, byId.get(String(d[k.partyField])))));
  if (filters.status && !['draft', 'void'].includes(filters.status)) {
    // open/overdue/paid/partially_paid are derived, so filter after computing them.
    const wanted = filters.status === 'unpaid' ? ['open', 'overdue', 'partially_paid'] : [filters.status];
    out = out.filter((d) => wanted.includes(d.displayStatus));
  }
  return out;
}

export async function getDoc(kind, workspace, id, today) {
  return presentDoc(kind, await findDoc(kind, workspace._id, id), today);
}

async function assertParty(kind, workspaceId, partyId) {
  const k = KINDS[kind];
  const party = await k.Party.findOne({ _id: partyId, workspaceId, status: 'active' });
  if (!party) throw fieldError('partyId', `Choose an active ${k.partyLabel} from this workspace.`);
  return party;
}

function applyContent(doc, input, currency) {
  const computed = computeLines(input.lines, currency);
  doc.lines = computed.lines.map((l) => ({ ...l, quantity: toDecimal128(l.quantity), unitPrice: toDecimal128(l.unitPrice), taxRate: toDecimal128(l.taxRate), amount: toDecimal128(l.amount), tax: toDecimal128(l.tax) }));
  doc.subtotal = toDecimal128(computed.subtotal);
  doc.taxTotal = toDecimal128(computed.taxTotal);
  doc.total = toDecimal128(computed.total);
  if (new D(computed.total).lessThanOrEqualTo(0)) throw fieldError('lines', 'The total must be more than zero.');
}

export async function createDoc(kind, workspace, input, actor, today, ctx) {
  await assertWithinLimit(workspace, kind === 'invoice' ? 'invoicesPerMonth' : 'billsPerMonth');
  const k = KINDS[kind];
  await assertParty(kind, workspace._id, input.partyId);
  if (input.dueDate < input.issueDate) throw fieldError('dueDate', 'The due date can’t be before the issue date.');
  const doc = new k.Model({
    workspaceId: workspace._id,
    number: await nextNumber(workspace._id, kind, k.prefix),
    [k.partyField]: input.partyId,
    issueDate: parse(input.issueDate),
    dueDate: parse(input.dueDate),
    currency: input.currency ?? workspace.baseCurrency,
    notes: input.notes ?? '',
    terms: input.terms ?? '',
    ...(kind === 'bill' ? { reference: input.reference ?? '' } : {}),
    status: input.issue ? 'issued' : 'draft',
    issuedAt: input.issue ? new Date() : null,
    createdBy: actor._id,
  });
  applyContent(doc, input, doc.currency);
  await doc.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: `${kind}.created`, entityType: k.label, entityId: doc._id, metadata: { number: doc.number, total: str(doc.total), currency: doc.currency, status: doc.status }, ctx });
  return presentDoc(kind, doc, today);
}

/** Content can change until money is recorded against it. */
export async function updateDoc(kind, workspace, id, changes, actor, today, ctx) {
  const k = KINDS[kind];
  const doc = await findDoc(kind, workspace._id, id);
  if (doc.status === 'void') throw ApiError.badRequest(`This ${kind} is void and can’t change.`);
  if (livePayments(doc).length) throw ApiError.conflict(`Payments are recorded on this ${kind}, so its contents are locked. Remove the payments first if it really needs changing.`, 'HAS_PAYMENTS');
  const before = { total: str(doc.total), dueDate: toYmd(doc.dueDate), lines: doc.lines.length };
  if (changes.partyId) {
    await assertParty(kind, workspace._id, changes.partyId);
    doc[k.partyField] = changes.partyId;
  }
  if (changes.currency && changes.currency !== doc.currency) {
    if (doc.status !== 'draft') throw ApiError.conflict('The currency can only change while it’s a draft.', 'CURRENCY_LOCKED');
    doc.currency = changes.currency;
  }
  if (changes.issueDate) doc.issueDate = parse(changes.issueDate);
  if (changes.dueDate) doc.dueDate = parse(changes.dueDate);
  if (toYmd(doc.dueDate) < toYmd(doc.issueDate)) throw fieldError('dueDate', 'The due date can’t be before the issue date.');
  for (const f of ['notes', 'terms', ...(kind === 'bill' ? ['reference'] : [])]) if (changes[f] !== undefined) doc[f] = changes[f];
  if (changes.lines) applyContent(doc, changes, doc.currency);
  else if (changes.currency) applyContent(doc, { lines: doc.lines.map((l) => ({ description: l.description, quantity: str(l.quantity), unitPrice: str(l.unitPrice), taxRate: str(l.taxRate) })) }, doc.currency);
  await doc.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: `${kind}.updated`, entityType: k.label, entityId: doc._id, metadata: { number: doc.number, before, after: { total: str(doc.total), dueDate: toYmd(doc.dueDate), lines: doc.lines.length } }, ctx });
  return presentDoc(kind, doc, today);
}

export async function issueDoc(kind, workspace, id, actor, today, ctx) {
  const doc = await findDoc(kind, workspace._id, id);
  if (doc.status !== 'draft') throw ApiError.badRequest(`Only a draft can be issued.`);
  doc.status = 'issued';
  doc.issuedAt = new Date();
  await doc.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: `${kind}.issued`, entityType: KINDS[kind].label, entityId: doc._id, metadata: { number: doc.number, total: str(doc.total) }, ctx });
  return presentDoc(kind, doc, today);
}

export async function voidDoc(kind, workspace, id, reason, actor, today, ctx) {
  const doc = await findDoc(kind, workspace._id, id);
  if (doc.status === 'void') throw ApiError.badRequest('Already void.');
  if (livePayments(doc).length) throw ApiError.conflict(`Payments are recorded on this ${kind}. Remove them before voiding it.`, 'HAS_PAYMENTS');
  if (!reason || reason.trim().length < 3) throw fieldError('reason', `Say why the ${kind} is being voided.`);
  doc.status = 'void';
  doc.voidedAt = new Date();
  doc.voidReason = reason.trim();
  await doc.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: `${kind}.voided`, entityType: KINDS[kind].label, entityId: doc._id, metadata: { number: doc.number, reason: doc.voidReason }, ctx });
  return presentDoc(kind, doc, today);
}

/**
 * Records money received (invoice) or paid (bill) as a real transaction in
 * the chosen tracking account, linked to the document.
 */
export async function addPayment(kind, workspace, id, input, actor, today, ctx) {
  const k = KINDS[kind];
  const doc = await findDoc(kind, workspace._id, id);
  if (doc.status !== 'issued') throw ApiError.badRequest(doc.status === 'draft' ? `Issue the ${kind} before recording payments.` : `This ${kind} is void.`);
  if (!fitsCurrency(input.amount, doc.currency)) throw fieldError('amount', `${doc.currency} amounts have at most ${minorUnits(doc.currency)} decimal places.`);
  const { balance } = balances(doc);
  if (new D(input.amount).greaterThan(balance)) throw fieldError('amount', `That’s more than the ${balance} ${doc.currency} still owed.`);
  if (input.date > today) throw fieldError('date', 'Payments can’t be dated in the future.');

  const account = await Account.findOne({ _id: input.accountId, workspaceId: workspace._id, status: 'active' });
  if (!account) throw fieldError('accountId', 'Choose an active account in this workspace.');
  if (account.currency !== doc.currency) throw fieldError('accountId', `Choose an account in ${doc.currency}, the ${kind}’s currency.`);

  await ensureDefaultCategories(workspace._id);
  const category = input.categoryId
    ? await Category.findOne({ _id: input.categoryId, workspaceId: workspace._id, kind: k.txType })
    : await Category.findOne({ workspaceId: workspace._id, systemKey: k.category });
  if (!category) throw fieldError('categoryId', `Choose an ${k.txType} category.`);
  const party = await k.Party.findById(doc[k.partyField]).select('name');

  const { transaction } = await createTransaction(
    workspace,
    {
      type: k.txType,
      accountId: String(account._id),
      categoryId: String(category._id),
      amount: normalize(input.amount, doc.currency),
      date: input.date,
      description: `${k.label} ${doc.number}${party ? `, ${party.name}` : ''}`,
      payee: party?.name ?? '',
      notes: input.notes ?? '',
      exchangeRate: input.exchangeRate,
    },
    actor,
    ctx,
    `${kind}-pay-${doc._id}-${input.idempotencyKey ?? crypto.randomUUID()}`,
  );
  await Transaction.updateOne({ _id: transaction.id }, { [k.txField]: doc._id });

  // Re-read to avoid racing another payment, then append.
  const fresh = await k.Model.findById(doc._id);
  if (fresh.payments.some((p) => String(p.transactionId) === transaction.id)) return presentDoc(kind, fresh, today);
  fresh.payments.push({ amount: toDecimal128(normalize(input.amount, doc.currency)), date: parse(input.date), accountId: account._id, transactionId: transaction.id, recordedBy: actor._id });
  await fresh.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: `${kind}.payment_recorded`, entityType: k.label, entityId: doc._id, metadata: { number: doc.number, amount: input.amount, account: account.name, transactionId: transaction.id }, ctx });
  return presentDoc(kind, fresh, today);
}

/** Removes a payment: its transaction is soft-deleted, and the entry stays on the document's history. */
export async function removePayment(kind, workspace, id, paymentId, reason, actor, today, ctx) {
  const doc = await findDoc(kind, workspace._id, id);
  const payment = doc.payments.id(paymentId);
  if (!payment || payment.removedAt) throw ApiError.notFound('Payment not found.');
  if (!reason || reason.trim().length < 3) throw fieldError('reason', 'Say why the payment is being removed.');
  await deleteTransaction(workspace, payment.transactionId, `Payment removed from ${doc.number}: ${reason.trim()}`, actor, ctx, { viaDocument: true });
  payment.removedAt = new Date();
  payment.removedBy = actor._id;
  payment.removeReason = reason.trim();
  await doc.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: `${kind}.payment_removed`, entityType: KINDS[kind].label, entityId: doc._id, metadata: { number: doc.number, amount: str(payment.amount), reason: reason.trim() }, ctx });
  return presentDoc(kind, doc, today);
}

export function previewLines(lines, currency) {
  return computeLines(lines, currency);
}
