import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { runAtomic } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { sha256 } from '../../utils/crypto.js';
import { D, normalize, str, toDecimal128 } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { notify, workspaceManagers } from '../notifications/notifications.service.js';
import { paidPlanFor, planName, priceFor, planCurrency } from '../subscriptions/plans.js';
import { applyPaidPeriod, revokeRefundedPeriod } from '../subscriptions/subscriptions.service.js';
import { Payment, PaymentWebhookEvent } from './payment.models.js';
import { getProvider } from './providers/index.js';

/**
 * BudgetFlow subscription payments, and nothing else.
 *
 * A plan is only ever activated by applyVerification(), and only with data
 * fetched from the provider's API by this server: never from the browser,
 * never from a webhook body alone. Webhooks are signature-checked and then
 * re-verified with the provider; duplicates are dropped by event id; the
 * pending → succeeded transition is a conditional update, so a payment
 * extends a plan exactly once however many times it's confirmed.
 */

const OPEN = ['pending', 'failed', 'abandoned'];
const MIN = 60_000;

export function presentPayment(p) {
  const c = p.currency;
  return {
    id: String(p._id),
    reference: p.reference,
    provider: p.provider,
    plan: p.plan,
    planName: planName(p.plan),
    billingPeriod: p.billingPeriod,
    amount: normalize(str(p.amount), c),
    currency: c,
    status: p.status,
    failureReason: p.failureReason || null,
    methodType: p.methodType,
    paidAt: p.paidAt,
    fees: p.fees != null ? normalize(str(p.fees), c) : null,
    coverage: p.coverage?.start ? { start: p.coverage.start, end: p.coverage.end } : null,
    reconciliationStatus: p.reconciliationStatus,
    refunds: p.refunds.map((r) => ({ amount: normalize(str(r.amount), c), status: r.status, processedAt: r.processedAt })),
    checkoutUrl: p.status === 'pending' ? p.checkoutUrl : null,
    createdAt: p.createdAt,
  };
}

const txId = (v) => (v.providerTransactionId ? { providerTransactionId: v.providerTransactionId } : {});

const newReference = () => `bf-${crypto.randomBytes(12).toString('hex')}`;

export async function startCheckout(workspace, { plan, billingPeriod, provider: providerKey }, actor, idempotencyKey, ctx) {
  if (plan !== paidPlanFor(workspace.type)) {
    throw ApiError.badRequest(workspace.type === 'business' ? 'Business workspaces use Business Pro.' : 'Personal workspaces use Personal Pro.');
  }
  const amount = priceFor(plan, billingPeriod);
  if (!amount) throw ApiError.conflict(`${planName(plan)} isn't on sale ${billingPeriod === 'yearly' ? 'yearly' : 'monthly'} yet.`, 'NOT_ON_SALE');
  const provider = getProvider(providerKey);
  if (!provider?.configured) throw ApiError.conflict(`${provider?.label ?? 'That provider'} isn't set up on this server.`, 'PROVIDER_NOT_CONFIGURED');

  if (idempotencyKey) {
    const prior = await Payment.findOne({ userId: actor._id, idempotencyKey });
    if (prior) {
      const same = String(prior.workspaceId) === String(workspace._id) && prior.plan === plan && prior.billingPeriod === billingPeriod && prior.provider === providerKey;
      if (!same) throw ApiError.conflict('This checkout key was already used for a different plan.', 'IDEMPOTENCY_MISMATCH');
      if (prior.status === 'pending' && prior.checkoutUrl) return { payment: presentPayment(prior), checkoutUrl: prior.checkoutUrl };
      throw ApiError.conflict('That checkout has finished. Start a new one.', 'CHECKOUT_CLOSED');
    }
  }

  const currency = planCurrency();
  const payment = await Payment.create({
    userId: actor._id,
    workspaceId: workspace._id,
    provider: providerKey,
    reference: newReference(),
    idempotencyKey: idempotencyKey ?? undefined,
    plan,
    billingPeriod,
    amount: toDecimal128(amount),
    currency,
  });

  try {
    const { checkoutUrl } = await provider.initialize({
      reference: payment.reference,
      amount,
      currency,
      email: actor.email,
      name: actor.name,
      callbackUrl: `${env.clientUrl}/settings/billing?checkout=${providerKey}`,
      metadata: { purpose: 'budgetflow_subscription', plan, billingPeriod, workspaceId: String(workspace._id) },
    });
    payment.checkoutUrl = checkoutUrl;
    await payment.save();
  } catch (err) {
    payment.status = 'failed';
    payment.failureReason = "Checkout couldn't be started with the provider.";
    await payment.save();
    throw err;
  }

  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'payment.checkout_started', entityType: 'Payment', entityId: payment._id, metadata: { reference: payment.reference, provider: providerKey, plan, billingPeriod, amount, currency }, ctx });
  return { payment: presentPayment(payment), checkoutUrl: payment.checkoutUrl };
}

async function tellManagers(payment, message) {
  const users = new Set([String(payment.userId), ...(await workspaceManagers(payment.workspaceId)).map(String)]);
  await notify([...users], { workspaceId: payment.workspaceId, link: '/settings/billing', data: { reference: payment.reference }, ...message });
}

/**
 * Applies what the provider's API says about a payment. `v` must come from
 * provider.verify(), never from a request body.
 */
export async function applyVerification(payment, v, { via }, now = new Date()) {
  const checked = { 'verification.lastCheckedAt': now, 'verification.providerStatus': v.providerStatus ?? null };
  await Payment.updateOne({ _id: payment._id }, { $set: checked, $inc: { 'verification.checks': 1 } });
  if (!v.found || v.status === 'pending') return Payment.findById(payment._id);

  if (v.reference !== payment.reference) {
    logger.warn(`payment ${payment.reference}: provider returned reference ${v.reference}`);
    return Payment.findById(payment._id);
  }

  if (v.status === 'success') {
    const matches = v.currency === payment.currency && new D(v.amount).eq(str(payment.amount));
    if (!matches) {
      const flagged = await Payment.findOneAndUpdate(
        { _id: payment._id, status: { $in: OPEN } },
        {
          $set: {
            status: 'review',
            reconciliationStatus: 'mismatch',
            ...txId(v),
            reconciliationNote: `Provider reported ${v.currency} ${v.amount}; expected ${payment.currency} ${normalize(str(payment.amount), payment.currency)}. The plan was not activated.`,
            'verification.apiVerifiedAt': now,
          },
        },
        { new: true },
      );
      if (flagged) {
        await recordAudit({ workspaceId: payment.workspaceId, action: 'payment.mismatch', entityType: 'Payment', entityId: payment._id, metadata: { reference: payment.reference, via, reported: `${v.currency} ${v.amount}` } });
        await tellManagers(flagged, { type: 'payment_review', title: 'A payment needs checking', body: "The amount the provider confirmed doesn't match the plan price, so the plan wasn't changed. Contact BudgetFlow support with the payment reference.", dedupeKey: `pay-review-${payment._id}` });
      }
      return flagged ?? Payment.findById(payment._id);
    }

    const result = await runAtomic(async (session) => {
      const claimed = await Payment.findOneAndUpdate(
        { _id: payment._id, status: { $in: OPEN } },
        {
          $set: {
            status: 'succeeded',
            failureReason: '',
            ...txId(v),
            methodType: v.methodType ?? null,
            paidAt: v.paidAt ?? now,
            fees: toDecimal128(v.fees),
            reconciliationStatus: 'matched',
            reconciliationNote: '',
            'verification.apiVerifiedAt': now,
          },
        },
        { new: true, session },
      );
      if (!claimed) return null; // already applied by another delivery or check
      const { sub, coverage, renewed } = await applyPaidPeriod(claimed, session, now);
      claimed.subscriptionId = sub._id;
      claimed.coverage = coverage;
      await claimed.save({ session });
      return { claimed, sub, renewed };
    });

    if (result) {
      const { claimed, sub, renewed } = result;
      await recordAudit({ workspaceId: claimed.workspaceId, actorId: claimed.userId, action: renewed ? 'subscription.renewed' : 'subscription.activated', entityType: 'Subscription', entityId: sub._id, metadata: { reference: claimed.reference, via, plan: claimed.plan, until: sub.currentPeriodEnd } });
      await tellManagers(claimed, {
        type: 'subscription_activated',
        title: renewed ? `${planName(claimed.plan)} renewed` : `${planName(claimed.plan)} is active`,
        body: `Paid through ${sub.currentPeriodEnd.toISOString().slice(0, 10)}.`,
        dedupeKey: `pay-ok-${claimed._id}`,
      });
      return claimed;
    }
    return Payment.findById(payment._id);
  }

  if (v.status === 'failed' || v.status === 'abandoned') {
    const updated = await Payment.findOneAndUpdate(
      { _id: payment._id, status: 'pending' },
      { $set: { status: v.status, failureReason: v.status === 'failed' ? v.failureReason || 'The provider declined the payment.' : 'Checkout was closed before paying.', 'verification.apiVerifiedAt': now } },
      { new: true },
    );
    if (updated && v.status === 'failed') {
      await tellManagers(updated, { type: 'payment_failed', title: "A plan payment didn't go through", body: 'Nothing was charged by BudgetFlow. You can try again from Plan and billing.', dedupeKey: `pay-fail-${payment._id}` });
    }
    return updated ?? Payment.findById(payment._id);
  }

  // 'reversed' and anything unexpected: keep for reconciliation, change nothing.
  await Payment.updateOne({ _id: payment._id }, { $set: { reconciliationNote: `Provider status: ${v.providerStatus}` } });
  return Payment.findById(payment._id);
}

/** "Check payment" after returning from checkout: the server asks the provider itself. */
export async function checkPayment(workspace, reference) {
  const payment = await Payment.findOne({ reference, workspaceId: workspace._id });
  if (!payment) throw ApiError.notFound('Payment not found.');
  if (OPEN.includes(payment.status)) {
    const provider = getProvider(payment.provider);
    if (!provider?.configured) throw ApiError.conflict(`${payment.provider} is no longer set up on this server.`, 'PROVIDER_NOT_CONFIGURED');
    const v = await provider.verify(payment.reference);
    return presentPayment(await applyVerification(payment, v, { via: 'api' }));
  }
  return presentPayment(payment);
}

export async function listPayments(workspace, { limit = 50 } = {}) {
  const rows = await Payment.find({ workspaceId: workspace._id }).sort({ createdAt: -1 }).limit(limit);
  return rows.map(presentPayment);
}

const processedRefunds = (p) => p.refunds.filter((r) => r.status === 'processed').reduce((acc, r) => acc.plus(str(r.amount)), new D(0));

/** Records a provider-confirmed refund. `r` must come from the provider's API. */
export async function recordRefund(payment, r, now = new Date()) {
  if (!['succeeded', 'partially_refunded', 'refunded'].includes(payment.status)) return 'ignored_not_paid';
  if (r.currency !== payment.currency) return 'ignored_currency';

  const result = await runAtomic(async (session) => {
    const p = await Payment.findById(payment._id).session(session);
    const existing = p.refunds.find((x) => x.providerRefundId === r.refundId);
    if (existing && existing.status === r.status) return null;
    if (existing) Object.assign(existing, { status: r.status, processedAt: r.processedAt, amount: toDecimal128(r.amount) });
    else p.refunds.push({ providerRefundId: r.refundId, amount: toDecimal128(r.amount), status: r.status, processedAt: r.processedAt });

    const total = processedRefunds(p);
    if (total.isZero()) {
      await p.save({ session });
      return { p, full: false, changed: false };
    }
    const full = total.gte(str(p.amount));
    p.status = full ? 'refunded' : 'partially_refunded';
    await p.save({ session });
    await revokeRefundedPeriod(p, { full }, session, now);
    return { p, full, changed: true };
  });

  if (result?.changed) {
    await recordAudit({ workspaceId: payment.workspaceId, action: 'payment.refunded', entityType: 'Payment', entityId: payment._id, metadata: { reference: payment.reference, amount: r.amount, full: result.full } });
    await tellManagers(result.p, { type: 'payment_refunded', title: result.full ? 'Plan payment refunded' : 'Part of a plan payment refunded', body: result.full ? 'The time that payment bought has been removed from the plan.' : '', dedupeKey: `pay-refund-${payment._id}-${r.refundId}` });
  }
  return result?.changed ? 'refund_recorded' : 'refund_unchanged';
}

async function processEvent(provider, ev, now) {
  if (ev.type === 'charge') {
    const payment = ev.reference ? await Payment.findOne({ reference: ev.reference, provider: provider.key }) : null;
    if (!payment) return 'ignored_unknown_reference';
    await Payment.updateOne({ _id: payment._id }, { $set: { 'verification.webhookVerifiedAt': now } });
    const v = await provider.verify(payment.reference);
    const after = await applyVerification(payment, v, { via: 'webhook' }, now);
    return `payment_${after.status}`;
  }
  if (ev.type === 'refund' && provider.fetchRefund && ev.refundId) {
    const r = await provider.fetchRefund(ev.refundId);
    const payment = await Payment.findOne({
      provider: provider.key,
      $or: [...(r.providerTransactionId ? [{ providerTransactionId: r.providerTransactionId }] : []), ...(r.reference ? [{ reference: r.reference }] : [])],
    });
    if (!payment) return 'ignored_unknown_reference';
    return recordRefund(payment, r, now);
  }
  return 'ignored_event_type';
}

/**
 * Webhook entry point. The raw body is needed for the signature, so this
 * route sits before the JSON parser. Returns quickly for duplicates; throws
 * (so the provider retries) when verification with the provider fails.
 */
export async function handleWebhook(providerKey, rawBody, headers, now = new Date()) {
  const provider = getProvider(providerKey);
  if (!provider?.configured) throw ApiError.notFound();
  if (!Buffer.isBuffer(rawBody) || !provider.verifySignature(rawBody, headers)) {
    logger.warn(`${providerKey} webhook rejected: bad signature`);
    throw ApiError.unauthorized('Invalid webhook signature.');
  }
  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw ApiError.badRequest('Webhook body must be JSON.');
  }

  const ev = provider.parseEvent(body);
  const record = await PaymentWebhookEvent.findOneAndUpdate(
    { provider: providerKey, eventId: ev.eventId },
    { $setOnInsert: { type: String(body.event ?? ev.type), reference: ev.reference, payloadHash: sha256(rawBody), signatureVerified: true }, $inc: { attempts: 1 } },
    { upsert: true, new: true },
  );
  if (record.processedAt) return { duplicate: true, outcome: record.outcome };

  try {
    const outcome = await processEvent(provider, ev, now);
    await PaymentWebhookEvent.updateOne({ _id: record._id }, { $set: { processedAt: new Date(), outcome, error: null } });
    return { duplicate: false, outcome };
  } catch (err) {
    await PaymentWebhookEvent.updateOne({ _id: record._id }, { $set: { error: String(err.message).slice(0, 300) } });
    throw err;
  }
}

/**
 * Scheduler job: catches payments whose webhook never arrived by asking the
 * provider directly, and closes checkouts that were never finished.
 */
export async function reconcilePendingPayments(now = new Date()) {
  const due = await Payment.find({
    status: 'pending',
    createdAt: { $lte: new Date(now - 10 * MIN) },
    $or: [{ 'verification.lastCheckedAt': null }, { 'verification.lastCheckedAt': { $lte: new Date(now - 10 * MIN) } }],
  }).limit(50);
  let settled = 0;
  for (const p of due) {
    const provider = getProvider(p.provider);
    if (!provider?.configured) continue;
    try {
      const after = await applyVerification(p, await provider.verify(p.reference), { via: 'reconcile' }, now);
      if (after.status === 'pending' && p.createdAt <= new Date(now - 24 * 60 * MIN)) {
        await Payment.updateOne({ _id: p._id, status: 'pending' }, { $set: { status: 'abandoned', failureReason: 'No completed payment within 24 hours.' } });
      }
      if (after.status !== 'pending') settled += 1;
    } catch (err) {
      logger.warn(`reconcile ${p.reference} failed: ${err.message}`);
    }
  }
  return settled;
}
