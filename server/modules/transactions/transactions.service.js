import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { convert, D, fitsCurrency, minorUnits, normalize, str, toDecimal128 } from '../../utils/money.js';
import { toUtcDate, toYmd } from '../../validators/money.js';
import { recordAudit, listAudit } from '../audit/audit.service.js';
import { Account } from '../accounts/account.model.js';
import { Category } from '../categories/category.model.js';
import { ensureDefaultCategories } from '../categories/categories.service.js';
import { buildReportingSnapshot } from '../exchange-rates/rates.service.js';
import { providerLabel } from '../exchange-rates/providers.js';
import { Transaction } from './transaction.model.js';
import { checkBudgetAlerts } from '../budgets/budgets.service.js';

const fieldError = (field, message) => ApiError.validation([{ location: 'body', field, message }]);

function assertFits(value, currency, field) {
  if (!fitsCurrency(value, currency)) {
    const n = minorUnits(currency);
    throw fieldError(field, `${currency} amounts have ${n === 0 ? 'no decimal places' : `at most ${n} decimal place${n === 1 ? '' : 's'}`}.`);
  }
}

/**
 * Checks every reference against the workspace and the type rules, and
 * returns the normalised fields to store. Shared by create and update so
 * both enforce exactly the same rules.
 */
export async function resolveRecord(workspace, input, { allowArchivedIds = [] } = {}) {
  const isUsable = (acc) => acc && (acc.status === 'active' || allowArchivedIds.includes(acc._id.toString()));

  const account = await Account.findOne({ _id: input.accountId, workspaceId: workspace._id });
  if (!isUsable(account)) throw fieldError('accountId', 'Choose an active account in this workspace.');
  assertFits(input.amount, account.currency, 'amount');

  const out = {
    type: input.type,
    accountId: account._id,
    amount: normalize(input.amount, account.currency),
    currency: account.currency,
    categoryId: null,
    toAccountId: null,
    toAmount: null,
    toCurrency: null,
  };

  if (input.type === 'transfer') {
    if (input.categoryId) throw fieldError('categoryId', 'Transfers don’t have a category; they aren’t income or spending.');
    if (!input.toAccountId) throw fieldError('toAccountId', 'Choose the account the money moved to.');
    if (String(input.toAccountId) === String(input.accountId)) throw fieldError('toAccountId', 'Choose a different account to transfer to.');
    const to = await Account.findOne({ _id: input.toAccountId, workspaceId: workspace._id });
    if (!isUsable(to)) throw fieldError('toAccountId', 'Choose an active account in this workspace.');
    let toAmount = input.toAmount;
    if (to.currency === account.currency) {
      if (toAmount && normalize(toAmount, to.currency) !== out.amount) {
        throw fieldError('toAmount', 'Both accounts use the same currency, so the amount received must match the amount sent.');
      }
      toAmount = out.amount;
    } else if (!toAmount) {
      throw fieldError('toAmount', `Enter how much ${to.currency} arrived in ${to.name}.`);
    }
    assertFits(toAmount, to.currency, 'toAmount');
    Object.assign(out, { toAccountId: to._id, toAmount: normalize(toAmount, to.currency), toCurrency: to.currency });
  } else {
    if (input.toAccountId || input.toAmount) throw fieldError('toAccountId', 'Only transfers move money to a second account.');
    if (!input.categoryId) throw fieldError('categoryId', `Choose a${input.type === 'income' ? 'n income' : 'n expense'} category.`);
    await ensureDefaultCategories(workspace._id);
    const category = await Category.findOne({ _id: input.categoryId, workspaceId: workspace._id });
    if (!category || (category.archived && !allowArchivedIds.includes(category._id.toString()))) {
      throw fieldError('categoryId', 'Choose a category from this workspace.');
    }
    if (category.kind !== input.type) {
      throw fieldError('categoryId', `“${category.name}” is an ${category.kind} category. Pick an ${input.type} category.`);
    }
    out.categoryId = category._id;
  }
  return out;
}

function recurrenceOf(input) {
  if (!input?.isRecurring) return { isRecurring: false, frequency: null };
  if (!input.frequency) throw fieldError('recurrence.frequency', 'Choose how often this repeats.');
  return { isRecurring: true, frequency: input.frequency };
}

const decimalFields = (doc) => ({
  ...doc,
  amount: toDecimal128(doc.amount),
  toAmount: toDecimal128(doc.toAmount),
  reporting: { ...doc.reporting, rate: toDecimal128(doc.reporting.rate), amount: toDecimal128(doc.reporting.amount), rateDate: doc.reporting.rateDate ? toUtcDate(doc.reporting.rateDate) : null },
});

/* ---------------- presentation ---------------- */

async function lookups(workspaceId, txs) {
  const accountIds = new Set();
  const categoryIds = new Set();
  for (const t of txs) {
    accountIds.add(String(t.accountId));
    if (t.toAccountId) accountIds.add(String(t.toAccountId));
    if (t.categoryId) categoryIds.add(String(t.categoryId));
  }
  const [accounts, categories] = await Promise.all([
    Account.find({ workspaceId, _id: { $in: [...accountIds] } }).select('name currency type status').lean(),
    Category.find({ workspaceId, _id: { $in: [...categoryIds] } }).select('name icon kind').lean(),
  ]);
  return {
    account: new Map(accounts.map((a) => [String(a._id), { id: String(a._id), name: a.name, currency: a.currency, type: a.type, status: a.status }])),
    category: new Map(categories.map((c) => [String(c._id), { id: String(c._id), name: c.name, icon: c.icon, kind: c.kind }])),
  };
}

export function presentTransaction(t, maps) {
  return {
    id: String(t._id),
    type: t.type,
    account: maps.account.get(String(t.accountId)) ?? { id: String(t.accountId), name: 'Unknown account' },
    toAccount: t.toAccountId ? (maps.account.get(String(t.toAccountId)) ?? { id: String(t.toAccountId), name: 'Unknown account' }) : null,
    category: t.categoryId ? (maps.category.get(String(t.categoryId)) ?? null) : null,
    amount: str(t.amount),
    currency: t.currency,
    toAmount: str(t.toAmount),
    toCurrency: t.toCurrency,
    date: toYmd(t.date),
    description: t.description,
    payee: t.payee,
    notes: t.notes,
    reporting: {
      currency: t.reporting.currency,
      rate: str(t.reporting.rate),
      amount: str(t.reporting.amount),
      source: t.reporting.source,
      estimated: t.reporting.estimated,
      rateDate: toYmd(t.reporting.rateDate),
      provider: t.reporting.provider,
      providerLabel: t.reporting.provider ? providerLabel(t.reporting.provider) : null,
    },
    recurrence: { isRecurring: Boolean(t.recurrence?.isRecurring), frequency: t.recurrence?.frequency ?? null },
    recurringId: t.recurringId ? String(t.recurringId) : null,
    invoiceId: t.invoiceId ? String(t.invoiceId) : null,
    billId: t.billId ? String(t.billId) : null,
    status: t.status,
    reconciledAt: t.reconciledAt,
    attachmentCount: t.attachmentCount ?? 0,
    version: t.__v,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

async function presentOne(workspaceId, t) {
  return presentTransaction(t, await lookups(workspaceId, [t]));
}

/** Fields compared for audit diffs. Values are display strings. */
function auditView(t) {
  return {
    type: t.type,
    accountId: String(t.accountId),
    toAccountId: t.toAccountId ? String(t.toAccountId) : null,
    categoryId: t.categoryId ? String(t.categoryId) : null,
    amount: str(t.amount),
    currency: t.currency,
    toAmount: str(t.toAmount),
    date: toYmd(t.date),
    description: t.description,
    payee: t.payee,
    notes: t.notes,
    reportingRate: str(t.reporting.rate),
    reportingAmount: str(t.reporting.amount),
    rateSource: t.reporting.source,
    recurring: t.recurrence?.isRecurring ? t.recurrence.frequency : null,
  };
}

function diff(before, after) {
  return Object.fromEntries(Object.keys(after).filter((k) => before[k] !== after[k]).map((k) => [k, { from: before[k], to: after[k] }]));
}

/* ---------------- commands ---------------- */

export async function createTransaction(workspace, input, actor, ctx, clientRef) {
  if (clientRef) {
    const existing = await Transaction.findOne({ workspaceId: workspace._id, clientRef });
    if (existing) return { transaction: await presentOne(workspace._id, existing), replayed: true };
  }

  const resolved = await resolveRecord(workspace, input);
  const reporting = await buildReportingSnapshot({
    workspaceId: workspace._id,
    amount: resolved.amount,
    currency: resolved.currency,
    reportingCurrency: workspace.baseCurrency,
    ymd: input.date,
    enteredRate: input.exchangeRate,
  });

  let tx;
  try {
    tx = await Transaction.create(
      decimalFields({
        workspaceId: workspace._id,
        ...resolved,
        date: toUtcDate(input.date),
        description: input.description,
        payee: input.payee ?? '',
        notes: input.notes ?? '',
        reporting,
        recurrence: recurrenceOf(input.recurrence),
        clientRef: clientRef || undefined,
        createdBy: actor._id,
      }),
    );
  } catch (err) {
    // Two identical retries raced; the other one won.
    if (err?.code === 11000 && clientRef) {
      const existing = await Transaction.findOne({ workspaceId: workspace._id, clientRef });
      return { transaction: await presentOne(workspace._id, existing), replayed: true };
    }
    throw err;
  }

  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: 'transaction.created',
    entityType: 'Transaction',
    entityId: tx._id,
    metadata: auditView(tx),
    ctx,
  });
  if (tx.type === 'expense') await checkBudgetAlerts(workspace, { date: toYmd(tx.date), categoryId: tx.categoryId }, actor.timezone);
  return { transaction: await presentOne(workspace._id, tx), replayed: false };
}

async function findLive(workspaceId, id) {
  const tx = await Transaction.findOne({ _id: id, workspaceId, deletedAt: null });
  if (!tx) throw ApiError.notFound('Transaction not found.');
  return tx;
}

function assertEditable(tx, { viaDocument = false } = {}) {
  if (!viaDocument && (tx.invoiceId || tx.billId)) {
    throw new ApiError(409, 'LINKED_TO_DOCUMENT', `This transaction records a payment on ${tx.invoiceId ? 'an invoice' : 'a bill'}. Change or remove the payment there so the two stay in step.`);
  }
  if (tx.status === 'reconciled') {
    throw new ApiError(409, 'RECORD_LOCKED', 'This transaction is reconciled and locked. An admin can unlock it if it needs correcting.');
  }
}

export async function updateTransaction(workspace, id, changes, actor, ctx) {
  const tx = await findLive(workspace._id, id);
  assertEditable(tx);
  if (changes.version !== undefined && changes.version !== tx.__v) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Someone else changed this transaction since you opened it. Reload to see the latest version.');
  }
  if (changes.type && (changes.type === 'transfer') !== (tx.type === 'transfer')) {
    throw fieldError('type', 'A transfer can’t become income or an expense, or the reverse. Delete it and record a new one.');
  }

  const before = auditView(tx);
  const current = {
    type: tx.type,
    accountId: String(tx.accountId),
    categoryId: tx.categoryId ? String(tx.categoryId) : undefined,
    toAccountId: tx.toAccountId ? String(tx.toAccountId) : undefined,
    amount: str(tx.amount),
    toAmount: tx.type === 'transfer' ? str(tx.toAmount) : undefined,
  };
  const merged = { ...current, ...changes };
  // Changing the destination or amount of a cross-currency transfer needs a fresh received amount.
  if (tx.type === 'transfer' && (changes.toAccountId || changes.accountId || changes.amount) && changes.toAmount === undefined) {
    merged.toAmount = undefined;
  }
  if (merged.type !== 'transfer') {
    delete merged.toAccountId;
    delete merged.toAmount;
  }

  const keep = [String(tx.accountId), tx.toAccountId && String(tx.toAccountId), tx.categoryId && String(tx.categoryId)].filter(Boolean);
  const resolved = await resolveRecord(workspace, merged, { allowArchivedIds: keep });
  const ymd = changes.date ?? toYmd(tx.date);

  const moneyChanged = resolved.amount !== str(tx.amount) || resolved.currency !== tx.currency || ymd !== toYmd(tx.date) || changes.exchangeRate;
  let reporting = tx.reporting.toObject ? tx.reporting.toObject() : tx.reporting;
  reporting = { ...reporting, rate: str(reporting.rate), amount: str(reporting.amount), rateDate: toYmd(reporting.rateDate) };
  if (moneyChanged) {
    if (!changes.exchangeRate && resolved.currency === tx.currency && ymd === toYmd(tx.date)) {
      // Same currency and day: keep the rate the user already accepted.
      reporting = { ...reporting, amount: convert(resolved.amount, reporting.rate, reporting.currency) };
    } else {
      reporting = await buildReportingSnapshot({
        workspaceId: workspace._id,
        amount: resolved.amount,
        currency: resolved.currency,
        reportingCurrency: tx.reporting.currency,
        ymd,
        enteredRate: changes.exchangeRate,
      });
    }
  }

  const next = decimalFields({ ...resolved, reporting });
  Object.assign(tx, next, { date: toUtcDate(ymd), updatedBy: actor._id });
  for (const key of ['description', 'payee', 'notes']) if (changes[key] !== undefined) tx[key] = changes[key];
  if (changes.recurrence) tx.recurrence = recurrenceOf(changes.recurrence);

  try {
    await tx.save();
  } catch (err) {
    if (err instanceof mongoose.Error.VersionError) {
      throw new ApiError(409, 'VERSION_CONFLICT', 'Someone else changed this transaction at the same time. Reload and try again.');
    }
    throw err;
  }

  const changed = diff(before, auditView(tx));
  if (Object.keys(changed).length) {
    await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'transaction.updated', entityType: 'Transaction', entityId: tx._id, metadata: { changes: changed }, ctx });
  }
  if (tx.type === 'expense') await checkBudgetAlerts(workspace, { date: toYmd(tx.date), categoryId: tx.categoryId }, actor.timezone);
  return presentOne(workspace._id, tx);
}

/**
 * Soft delete: the record leaves balances and reports, but stays in the
 * database so the audit trail still points at something real.
 */
export async function deleteTransaction(workspace, id, reason, actor, ctx, { viaDocument = false } = {}) {
  const tx = await findLive(workspace._id, id);
  assertEditable(tx, { viaDocument });
  tx.deletedAt = new Date();
  tx.deletedBy = actor._id;
  await tx.save();
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: 'transaction.deleted',
    entityType: 'Transaction',
    entityId: tx._id,
    metadata: { ...auditView(tx), reason: reason ?? '' },
    ctx,
  });
}

export async function setReconciled(workspace, id, reconciled, actor, ctx) {
  const tx = await findLive(workspace._id, id);
  if ((tx.status === 'reconciled') === reconciled) return presentOne(workspace._id, tx);
  tx.status = reconciled ? 'reconciled' : 'recorded';
  tx.reconciledAt = reconciled ? new Date() : null;
  tx.reconciledBy = reconciled ? actor._id : null;
  await tx.save();
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: reconciled ? 'transaction.reconciled' : 'transaction.unreconciled',
    entityType: 'Transaction',
    entityId: tx._id,
    ctx,
  });
  return presentOne(workspace._id, tx);
}

/* ---------------- queries ---------------- */

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildFilter(workspaceId, f) {
  const q = { workspaceId: new mongoose.Types.ObjectId(String(workspaceId)), deletedAt: null };
  if (f.type) q.type = f.type;
  if (f.status) q.status = f.status;
  if (f.categoryId) q.categoryId = new mongoose.Types.ObjectId(f.categoryId);
  if (f.accountId) {
    const id = new mongoose.Types.ObjectId(f.accountId);
    q.$or = [{ accountId: id }, { toAccountId: id }];
  }
  if (f.from || f.to) {
    q.date = {};
    if (f.from) q.date.$gte = toUtcDate(f.from);
    if (f.to) q.date.$lte = toUtcDate(f.to);
  }
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q), 'i');
    const text = [{ description: rx }, { payee: rx }, { notes: rx }];
    if (q.$or) {
      q.$and = [{ $or: q.$or }, { $or: text }];
      delete q.$or;
    } else q.$or = text;
  }
  if (f.recurring) q['recurrence.isRecurring'] = true;
  return q;
}

export async function listTransactions(workspaceId, filters) {
  const q = buildFilter(workspaceId, filters);
  const { page, limit } = filters;
  const [rows, total] = await Promise.all([
    Transaction.find(q).sort({ date: -1, createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Transaction.countDocuments(q),
  ]);
  const maps = await lookups(workspaceId, rows);
  return { items: rows.map((r) => presentTransaction(r, maps)), meta: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getTransaction(workspaceId, id) {
  return presentOne(workspaceId, await findLive(workspaceId, id));
}

export async function transactionHistory(workspaceId, id) {
  await findLive(workspaceId, id);
  return listAudit(workspaceId, { limit: 200, entityType: 'Transaction', entityId: id });
}

/**
 * Income and expense totals in the workspace's reporting currency, summed
 * exactly in MongoDB. Transfers are excluded: they only move money between
 * accounts the user already owns.
 */
export async function summarize(workspace, { from, to, accountId } = {}) {
  const match = buildFilter(workspace._id, { from, to, accountId });
  match.type = { $in: ['income', 'expense'] };
  match['reporting.currency'] = workspace.baseCurrency;

  const [totals, byCategory] = await Promise.all([
    Transaction.aggregate([{ $match: match }, { $group: { _id: '$type', total: { $sum: '$reporting.amount' }, count: { $sum: 1 } } }]),
    Transaction.aggregate([
      { $match: match },
      { $group: { _id: { type: '$type', categoryId: '$categoryId' }, total: { $sum: '$reporting.amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
  ]);
  const cur = workspace.baseCurrency;
  const pick = (type) => totals.find((t) => t._id === type);
  const income = normalize(str(pick('income')?.total) ?? '0', cur);
  const expense = normalize(str(pick('expense')?.total) ?? '0', cur);
  const net = normalize(new D(income).minus(expense).toString(), cur);

  const categories = await Category.find({ workspaceId: workspace._id, _id: { $in: byCategory.map((r) => r._id.categoryId) } }).lean();
  const names = new Map(categories.map((c) => [String(c._id), c]));
  const breakdown = (type, total) =>
    byCategory
      .filter((r) => r._id.type === type)
      .map((r) => {
        const c = names.get(String(r._id.categoryId));
        const amount = normalize(str(r.total), cur);
        return {
          categoryId: String(r._id.categoryId),
          name: c?.name ?? 'Unknown',
          icon: c?.icon ?? 'tag',
          amount,
          count: r.count,
          // Share as a percentage string with one decimal, computed in decimal.
          share: total === normalize('0', cur) ? '0.0' : percent(amount, total),
        };
      });

  return {
    currency: cur,
    from: from ?? null,
    to: to ?? null,
    income,
    expense,
    net,
    incomeCount: pick('income')?.count ?? 0,
    expenseCount: pick('expense')?.count ?? 0,
    incomeByCategory: breakdown('income', income),
    expenseByCategory: breakdown('expense', expense),
  };
}

function percent(part, whole) {
  return new D(part).div(whole).times(100).toFixed(1);
}

export async function exportRows(workspaceId, filters, max = 10000) {
  const q = buildFilter(workspaceId, filters);
  const rows = await Transaction.find(q).sort({ date: -1, createdAt: -1 }).limit(max).lean();
  const maps = await lookups(workspaceId, rows);
  return rows.map((r) => presentTransaction(r, maps));
}
