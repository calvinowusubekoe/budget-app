import { ApiError } from '../../utils/ApiError.js';
import { convert, invertRate, normalizeRate, str, toDecimal128 } from '../../utils/money.js';
import { toUtcDate, toYmd } from '../../validators/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { ExchangeRate } from './exchangeRate.model.js';
import { fetchProviderRate, providerLabel } from './providers.js';

export function presentRate(r) {
  return {
    id: r._id.toString(),
    from: r.from,
    to: r.to,
    rate: str(r.rate),
    effectiveDate: toYmd(r.effectiveDate),
    source: r.source,
    provider: r.provider,
    providerLabel: r.provider ? providerLabel(r.provider) : null,
    fetchedAt: r.fetchedAt,
    createdAt: r.createdAt,
  };
}

export async function listRates(workspaceId, { from, to, limit = 100 } = {}) {
  const q = { workspaceId };
  if (from) q.from = from;
  if (to) q.to = to;
  const rows = await ExchangeRate.find(q).sort({ effectiveDate: -1, createdAt: -1 }).limit(limit);
  return rows.map(presentRate);
}

/** Saves a manual rate. One manual rate per pair per day; a second entry replaces it. */
export async function saveManualRate(workspace, { from, to, rate, effectiveDate }, actor, ctx) {
  if (from === to) throw ApiError.badRequest('Choose two different currencies.');
  const day = toUtcDate(effectiveDate);
  const value = normalizeRate(rate);
  const existing = await ExchangeRate.findOne({ workspaceId: workspace._id, from, to, effectiveDate: day, source: 'manual' });
  const before = existing ? str(existing.rate) : null;
  const doc = await ExchangeRate.findOneAndUpdate(
    { workspaceId: workspace._id, from, to, effectiveDate: day, source: 'manual' },
    { $set: { rate: toDecimal128(value), createdBy: actor._id } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: existing ? 'exchange_rate.replaced' : 'exchange_rate.created',
    entityType: 'ExchangeRate',
    entityId: doc._id,
    metadata: { from, to, effectiveDate, rate: value, previousRate: before },
    ctx,
  });
  return presentRate(doc);
}

export async function fetchAndStoreProviderRate(workspace, { from, to }, actor, ctx, fetchImpl) {
  if (from === to) throw ApiError.badRequest('Choose two different currencies.');
  const result = await fetchProviderRate(from, to, fetchImpl);
  const day = toUtcDate(toYmd(result.effectiveDate));
  const doc = await ExchangeRate.findOneAndUpdate(
    { workspaceId: workspace._id, from, to, effectiveDate: day, source: 'provider' },
    { $set: { rate: toDecimal128(result.rate), provider: result.provider, fetchedAt: new Date(), createdBy: actor._id } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: 'exchange_rate.fetched',
    entityType: 'ExchangeRate',
    entityId: doc._id,
    metadata: { from, to, rate: result.rate, provider: result.provider },
    ctx,
  });
  return presentRate(doc);
}

export async function deleteRate(workspace, id, actor, ctx) {
  const doc = await ExchangeRate.findOneAndDelete({ _id: id, workspaceId: workspace._id });
  if (!doc) throw ApiError.notFound('Exchange rate not found.');
  // Safe: transactions hold their own copy of any rate they used.
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'exchange_rate.deleted', entityType: 'ExchangeRate', entityId: doc._id, metadata: presentRate(doc), ctx });
}

/**
 * Finds the rate to convert `from` → `to` for a calendar date. Prefers the
 * most recent direct rate on or before the date; falls back to inverting the
 * reverse pair (marked estimated). Returns null when nothing is on record.
 */
export async function findRate(workspaceId, from, to, ymd) {
  if (from === to) return { rate: '1', source: 'same', estimated: false, rateDate: ymd, provider: null };
  const day = toUtcDate(ymd);
  const pick = (f, t) =>
    ExchangeRate.findOne({ workspaceId, from: f, to: t, effectiveDate: { $lte: day } }).sort({ effectiveDate: -1, source: 1, updatedAt: -1 });
  const direct = await pick(from, to);
  if (direct) {
    const rateDate = toYmd(direct.effectiveDate);
    return { rate: str(direct.rate), source: direct.source, estimated: rateDate !== ymd, rateDate, provider: direct.provider };
  }
  const reverse = await pick(to, from);
  if (reverse) {
    return { rate: invertRate(str(reverse.rate)), source: reverse.source, estimated: true, rateDate: toYmd(reverse.effectiveDate), provider: reverse.provider };
  }
  return null;
}

/**
 * Builds the reporting snapshot for a transaction. An explicitly entered
 * rate wins; otherwise the rate table is used; otherwise the caller is told
 * exactly which rate is missing.
 */
export async function buildReportingSnapshot({ workspaceId, amount, currency, reportingCurrency, ymd, enteredRate }) {
  let found;
  if (currency === reportingCurrency) {
    found = { rate: '1', source: 'same', estimated: false, rateDate: ymd, provider: null };
  } else if (enteredRate) {
    found = { rate: normalizeRate(enteredRate), source: 'entered', estimated: false, rateDate: ymd, provider: null };
  } else {
    found = await findRate(workspaceId, currency, reportingCurrency, ymd);
  }
  if (!found) {
    throw new ApiError(422, 'RATE_REQUIRED', `Enter the ${currency} to ${reportingCurrency} exchange rate for this date.`, [
      { location: 'body', field: 'exchangeRate', message: `How many ${reportingCurrency} is 1 ${currency}?` },
    ]);
  }
  return {
    currency: reportingCurrency,
    rate: found.rate,
    amount: convert(amount, found.rate, reportingCurrency),
    source: found.source,
    estimated: found.estimated,
    rateDate: found.rateDate,
    provider: found.provider,
  };
}
