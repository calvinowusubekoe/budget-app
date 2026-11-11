import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { add, fitsCurrency, minorUnits, normalize, str, toDecimal128 } from '../../utils/money.js';
import { toUtcDate, toYmd } from '../../validators/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { Transaction } from '../transactions/transaction.model.js';
import { Account } from './account.model.js';
import { assertWithinLimit } from '../subscriptions/entitlements.js';

/**
 * Signed movements per account, summed exactly as Decimal128 inside MongoDB.
 * income: +amount, expense: −amount, transfer: −amount on the source and
 * +toAmount on the destination. Deleted transactions are excluded.
 */
export async function movementsByAccount(workspaceId, { accountIds, asOf } = {}) {
  const match = { workspaceId: new mongoose.Types.ObjectId(String(workspaceId)), deletedAt: null };
  if (asOf) match.date = { $lte: toUtcDate(asOf) };
  if (accountIds) {
    const ids = accountIds.map((id) => new mongoose.Types.ObjectId(String(id)));
    match.$or = [{ accountId: { $in: ids } }, { toAccountId: { $in: ids } }];
  }
  const rows = await Transaction.aggregate([
    { $match: match },
    {
      $project: {
        entries: {
          $cond: [
            { $eq: ['$type', 'transfer'] },
            [
              { account: '$accountId', value: { $multiply: ['$amount', -1] } },
              { account: '$toAccountId', value: '$toAmount' },
            ],
            [{ account: '$accountId', value: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', { $multiply: ['$amount', -1] }] } }],
          ],
        },
      },
    },
    { $unwind: '$entries' },
    { $group: { _id: '$entries.account', total: { $sum: '$entries.value' }, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), { total: str(r.total), count: r.count }]));
}

export function presentAccount(a, movement) {
  const movementTotal = movement?.total ?? '0';
  return {
    id: a._id.toString(),
    name: a.name,
    type: a.type,
    currency: a.currency,
    institution: a.institution,
    notes: a.notes,
    status: a.status,
    openingBalance: normalize(str(a.openingBalance), a.currency),
    openingDate: toYmd(a.openingDate),
    balance: normalize(add(str(a.openingBalance), movementTotal).toString(), a.currency),
    transactionCount: movement?.count ?? 0,
    createdAt: a.createdAt,
  };
}

export async function listAccounts(workspaceId, { includeArchived = false } = {}) {
  const q = { workspaceId };
  if (!includeArchived) q.status = 'active';
  const accounts = await Account.find(q).sort({ status: 1, createdAt: 1 });
  const movements = await movementsByAccount(workspaceId);
  return accounts.map((a) => presentAccount(a, movements.get(a._id.toString())));
}

/** Active-account balances summed per currency. Currencies are never mixed. */
export function totalsByCurrency(accounts) {
  const sums = new Map();
  for (const a of accounts) {
    if (a.status !== 'active') continue;
    sums.set(a.currency, add(sums.get(a.currency) ?? '0', a.balance));
  }
  return [...sums.entries()].map(([currency, total]) => ({ currency, amount: normalize(total.toString(), currency) }));
}

export async function getAccount(workspaceId, id) {
  const account = await Account.findOne({ _id: id, workspaceId });
  if (!account) throw ApiError.notFound('Account not found.');
  const movements = await movementsByAccount(workspaceId, { accountIds: [id] });
  return presentAccount(account, movements.get(account._id.toString()));
}

function assertFits(value, currency, field) {
  if (!fitsCurrency(value, currency)) {
    const n = minorUnits(currency);
    throw ApiError.validation([{ location: 'body', field, message: `${currency} amounts have ${n === 0 ? 'no' : `at most ${n}`} decimal place${n === 1 ? '' : 's'}.` }]);
  }
}

export async function createAccount(workspace, input, actor, ctx) {
  await assertWithinLimit(workspace, 'accounts');
  const openingBalance = input.openingBalance ?? '0';
  assertFits(openingBalance, input.currency, 'openingBalance');
  const account = await Account.create({
    workspaceId: workspace._id,
    name: input.name,
    type: input.type,
    currency: input.currency,
    institution: input.institution ?? '',
    notes: input.notes ?? '',
    openingBalance: toDecimal128(normalize(openingBalance, input.currency)),
    openingDate: toUtcDate(input.openingDate),
    createdBy: actor._id,
  });
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: 'account.created',
    entityType: 'Account',
    entityId: account._id,
    metadata: { name: account.name, type: account.type, currency: account.currency, openingBalance: str(account.openingBalance) },
    ctx,
  });
  return presentAccount(account);
}

const hasTransactions = (workspaceId, accountId) =>
  Transaction.exists({ workspaceId, $or: [{ accountId }, { toAccountId: accountId }] });

export async function updateAccount(workspace, id, changes, actor, ctx) {
  const account = await Account.findOne({ _id: id, workspaceId: workspace._id });
  if (!account) throw ApiError.notFound('Account not found.');
  const before = presentAccount(account);

  if (changes.currency && changes.currency !== account.currency) {
    if (await hasTransactions(workspace._id, account._id)) {
      throw ApiError.conflict('This account already has transactions in ' + account.currency + ', so its currency can’t change. Create a new account instead.', 'CURRENCY_LOCKED');
    }
    account.currency = changes.currency;
  }
  if (changes.openingBalance !== undefined) {
    assertFits(changes.openingBalance, account.currency, 'openingBalance');
    account.openingBalance = toDecimal128(normalize(changes.openingBalance, account.currency));
  } else if (changes.currency) {
    assertFits(str(account.openingBalance), account.currency, 'openingBalance');
  }
  for (const key of ['name', 'type', 'institution', 'notes', 'status']) {
    if (changes[key] !== undefined) account[key] = changes[key];
  }
  if (changes.openingDate) account.openingDate = toUtcDate(changes.openingDate);
  await account.save();

  const after = presentAccount(account);
  const changed = Object.fromEntries(
    ['name', 'type', 'currency', 'institution', 'notes', 'status', 'openingBalance', 'openingDate']
      .filter((k) => before[k] !== after[k])
      .map((k) => [k, { from: before[k], to: after[k] }]),
  );
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: changes.status === 'archived' ? 'account.archived' : 'account.updated',
    entityType: 'Account',
    entityId: account._id,
    metadata: { changes: changed },
    ctx,
  });
  return getAccount(workspace._id, account._id);
}

/** Only accounts that were never used can be deleted; others are archived. */
export async function deleteAccount(workspace, id, actor, ctx) {
  const account = await Account.findOne({ _id: id, workspaceId: workspace._id });
  if (!account) throw ApiError.notFound('Account not found.');
  if (await hasTransactions(workspace._id, account._id)) {
    throw ApiError.conflict('This account has transaction history, so it can’t be deleted. Archive it to hide it instead.', 'ACCOUNT_IN_USE');
  }
  await account.deleteOne();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'account.deleted', entityType: 'Account', entityId: account._id, metadata: { name: account.name }, ctx });
}
