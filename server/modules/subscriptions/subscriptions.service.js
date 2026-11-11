import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { D, normalize, str } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { notify, workspaceManagers } from '../notifications/notifications.service.js';
import { Subscription } from './subscription.model.js';
import { effectivePlan, graceEnd, usageFor } from './entitlements.js';
import { limitsFor, planName } from './plans.js';

const DAY = 86_400_000;

/** Adds a month or a year, keeping the time and clamping to the month's last day. */
export function addBillingPeriod(date, period) {
  const d = new Date(date);
  const months = period === 'yearly' ? 12 : 1;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target;
}

export function presentSubscription(sub) {
  if (!sub) return null;
  return {
    id: String(sub._id),
    plan: sub.plan,
    planName: planName(sub.plan),
    billingPeriod: sub.billingPeriod,
    status: sub.status,
    startedAt: sub.startedAt,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    renewalDate: sub.cancelAtPeriodEnd || ['cancelled', 'expired'].includes(sub.status) ? null : sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    cancelledAt: sub.cancelledAt,
    endedAt: sub.endedAt,
    provider: sub.provider,
    currency: sub.currency,
    amount: normalize(str(sub.amount), sub.currency),
    paymentStatus: sub.paymentStatus,
  };
}

export async function currentFor(workspace, now = new Date()) {
  const sub = await Subscription.findOne({ workspaceId: workspace._id });
  const eff = effectivePlan(sub, now);
  return {
    plan: eff.plan,
    planName: planName(eff.plan),
    state: eff.state,
    graceUntil: eff.graceUntil,
    limits: limitsFor(eff.plan),
    usage: await usageFor(workspace._id, now),
    subscription: presentSubscription(sub),
  };
}

/**
 * Applies a verified payment: starts the plan, or extends it from the end of
 * the paid period so an early renewal never loses days. Only called by the
 * payments service after the provider has confirmed the exact amount.
 */
export async function applyPaidPeriod(payment, session, now = new Date()) {
  const existing = await Subscription.findOne({ workspaceId: payment.workspaceId }).session(session);
  const renewing = existing && ['active', 'past_due'].includes(existing.status) && existing.plan === payment.plan && graceEnd(existing.currentPeriodEnd) >= now;
  const start = renewing && existing.currentPeriodEnd > now ? existing.currentPeriodEnd : now;
  const end = addBillingPeriod(start, payment.billingPeriod);

  const fields = {
    userId: payment.userId,
    plan: payment.plan,
    billingPeriod: payment.billingPeriod,
    status: 'active',
    currentPeriodEnd: end,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    cancellationReason: '',
    endedAt: null,
    provider: payment.provider,
    providerReference: payment.providerTransactionId ?? null,
    lastPaymentId: payment._id,
    currency: payment.currency,
    amount: payment.amount,
    paymentStatus: 'paid',
  };
  // A new plan, or a renewal paid during the grace period, starts a fresh period today.
  // An early renewal keeps the current start and just pushes the end out.
  if (!renewing) Object.assign(fields, { startedAt: now, currentPeriodStart: now });
  else if (start === now) fields.currentPeriodStart = now;

  const sub = await Subscription.findOneAndUpdate({ workspaceId: payment.workspaceId }, { $set: fields }, { upsert: true, new: true, session, setDefaultsOnInsert: true });
  return { sub, coverage: { start, end }, renewed: Boolean(renewing) };
}

/**
 * A full refund takes back the period that payment bought. The workspace
 * drops to Free at once if nothing paid remains.
 */
export async function revokeRefundedPeriod(payment, { full }, session, now = new Date()) {
  const sub = await Subscription.findOne({ workspaceId: payment.workspaceId }).session(session);
  if (!sub) return null;
  if (!full) {
    sub.paymentStatus = 'partially_refunded';
    await sub.save({ session });
    return sub;
  }
  sub.paymentStatus = 'refunded';
  if (payment.coverage?.start && payment.coverage?.end && sub.currentPeriodEnd.getTime() === payment.coverage.end.getTime()) {
    sub.currentPeriodEnd = payment.coverage.start;
  }
  if (sub.currentPeriodEnd <= now) {
    sub.status = 'cancelled';
    sub.endedAt = now;
    sub.cancelAtPeriodEnd = false;
    sub.cancellationReason = 'Payment refunded';
  }
  await sub.save({ session });
  return sub;
}

export async function cancelSubscription(workspace, { reason = '' }, actor, ctx) {
  const sub = await Subscription.findOne({ workspaceId: workspace._id });
  if (!sub || !['active', 'past_due'].includes(sub.status)) throw ApiError.conflict("There's no paid plan to cancel.", 'NO_SUBSCRIPTION');
  if (sub.cancelAtPeriodEnd) return presentSubscription(sub);
  sub.cancelAtPeriodEnd = true;
  sub.cancelledAt = new Date();
  sub.cancellationReason = reason;
  await sub.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'subscription.cancelled', entityType: 'Subscription', entityId: sub._id, metadata: { plan: sub.plan, endsAt: sub.currentPeriodEnd, reason }, ctx });
  return presentSubscription(sub);
}

/** Undo a cancellation while the paid period is still running. */
export async function resumeSubscription(workspace, actor, ctx, now = new Date()) {
  const sub = await Subscription.findOne({ workspaceId: workspace._id });
  if (!sub || !sub.cancelAtPeriodEnd || !['active', 'past_due'].includes(sub.status) || sub.currentPeriodEnd <= now) {
    throw ApiError.conflict('Only a cancelled plan that is still running can be kept. Buy the plan again instead.', 'NOT_RESUMABLE');
  }
  sub.cancelAtPeriodEnd = false;
  sub.cancelledAt = null;
  sub.cancellationReason = '';
  await sub.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'subscription.resumed', entityType: 'Subscription', entityId: sub._id, metadata: { plan: sub.plan }, ctx });
  return presentSubscription(sub);
}

const fmtDate = (d) => d.toISOString().slice(0, 10);

/**
 * Scheduler sweep: renewal reminders, then moving lapsed plans along
 * active → past_due (grace) → expired. Entitlements already follow the dates;
 * this keeps stored statuses and notifications in step.
 */
export async function sweepSubscriptions(now = new Date()) {
  let changed = 0;
  const reminderCutoff = new Date(now.getTime() + env.plans.reminderDays * DAY);

  const dueSoon = await Subscription.find({ status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: { $gt: now, $lte: reminderCutoff } });
  for (const sub of dueSoon) {
    await notify(await workspaceManagers(sub.workspaceId), {
      workspaceId: sub.workspaceId,
      type: 'subscription_renewal_due',
      title: `${planName(sub.plan)} ends on ${fmtDate(sub.currentPeriodEnd)}`,
      body: "Kontaa doesn't charge you automatically. Renew from Plan and billing to keep your plan.",
      link: '/settings/billing',
      dedupeKey: `sub-renew-${sub._id}-${fmtDate(sub.currentPeriodEnd)}`,
    });
  }

  const lapsed = await Subscription.find({ status: { $in: ['active', 'past_due'] }, currentPeriodEnd: { $lte: now } });
  for (const sub of lapsed) {
    let next;
    if (sub.cancelAtPeriodEnd) next = 'cancelled';
    else if (now > graceEnd(sub.currentPeriodEnd)) next = 'expired';
    else next = 'past_due';
    if (next === sub.status) continue;

    const res = await Subscription.updateOne(
      { _id: sub._id, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd },
      { $set: { status: next, ...(next === 'past_due' ? {} : { endedAt: now }) } },
    );
    if (!res.modifiedCount) continue;
    changed += 1;
    const managers = await workspaceManagers(sub.workspaceId);
    if (next === 'past_due') {
      await notify(managers, {
        workspaceId: sub.workspaceId,
        type: 'subscription_past_due',
        title: `${planName(sub.plan)} has ended`,
        body: `You keep it until ${fmtDate(graceEnd(sub.currentPeriodEnd))} while you renew. After that the workspace moves to Free; nothing is deleted.`,
        link: '/settings/billing',
        dedupeKey: `sub-pastdue-${sub._id}-${fmtDate(sub.currentPeriodEnd)}`,
      });
    } else {
      await notify(managers, {
        workspaceId: sub.workspaceId,
        type: 'subscription_expired',
        title: 'This workspace is now on the Free plan',
        body: 'Your records are all still here. Free plan limits apply to new ones.',
        link: '/settings/billing',
        dedupeKey: `sub-ended-${sub._id}-${fmtDate(sub.currentPeriodEnd)}`,
      });
    }
    await recordAudit({ workspaceId: sub.workspaceId, action: `subscription.${next}`, entityType: 'Subscription', entityId: sub._id, metadata: { plan: sub.plan, periodEnd: sub.currentPeriodEnd } });
  }
  return changed;
}

/** Sum of refunds so far, as a decimal. */
export const refundedTotal = (payment) => payment.refunds.filter((r) => r.status === 'processed').reduce((acc, r) => acc.plus(str(r.amount)), new D(0));
