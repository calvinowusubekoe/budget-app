import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { Account } from '../accounts/account.model.js';
import { Budget } from '../budgets/budget.model.js';
import { SavingsGoal } from '../savings/savings.models.js';
import { Debt } from '../debts/debts.models.js';
import { RecurringTransaction } from '../recurring/recurring.model.js';
import { SusuPlan } from '../susu/susu.models.js';
import { Invoice, Bill } from '../business/business.models.js';
import { AiUsage } from '../ai/ai.models.js';
import { Subscription } from './subscription.model.js';
import { LIMIT_LABELS, limitsFor, planName } from './plans.js';

const DAY = 86_400_000;
const monthStart = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Live-record counts per limit. Archived, ended and deleted records don't count. */
const COUNTERS = {
  accounts: (w) => Account.countDocuments({ workspaceId: w, status: 'active', deletedAt: null }),
  budgets: (w) => Budget.countDocuments({ workspaceId: w, status: { $ne: 'archived' }, deletedAt: null }),
  savingsGoals: (w) => SavingsGoal.countDocuments({ workspaceId: w, status: 'active' }),
  debts: (w) => Debt.countDocuments({ workspaceId: w, status: 'active' }),
  recurring: (w) => RecurringTransaction.countDocuments({ workspaceId: w, status: { $in: ['active', 'paused'] } }),
  susuPlans: (w) => SusuPlan.countDocuments({ workspaceId: w, status: { $in: ['active', 'paused'] } }),
  invoicesPerMonth: (w, now) => Invoice.countDocuments({ workspaceId: w, createdAt: { $gte: monthStart(now) } }),
  billsPerMonth: (w, now) => Bill.countDocuments({ workspaceId: w, createdAt: { $gte: monthStart(now) } }),
  aiQuestionsPerMonth: (w, now) => AiUsage.countDocuments({ workspaceId: w, feature: { $ne: 'scan' }, createdAt: { $gte: monthStart(now) } }),
  receiptScansPerMonth: (w, now) => AiUsage.countDocuments({ workspaceId: w, feature: 'scan', createdAt: { $gte: monthStart(now) } }),
};

export const graceEnd = (periodEnd) => new Date(periodEnd.getTime() + env.plans.graceDays * DAY);

/**
 * Which plan a workspace gets right now, worked out from the dates rather
 * than the stored status, so a late scheduler run never over- or
 * under-grants. After the paid period there's a grace period unless the
 * owner cancelled.
 */
export function effectivePlan(sub, now = new Date()) {
  if (!sub || !['active', 'past_due'].includes(sub.status)) return { plan: 'free', state: sub ? sub.status : 'none', graceUntil: null };
  if (now <= sub.currentPeriodEnd) return { plan: sub.plan, state: sub.cancelAtPeriodEnd ? 'ending' : 'active', graceUntil: null };
  if (!sub.cancelAtPeriodEnd && now <= graceEnd(sub.currentPeriodEnd)) return { plan: sub.plan, state: 'grace', graceUntil: graceEnd(sub.currentPeriodEnd) };
  return { plan: 'free', state: 'lapsed', graceUntil: null };
}

export async function workspacePlan(workspaceId, now = new Date()) {
  const sub = await Subscription.findOne({ workspaceId });
  return { sub, ...effectivePlan(sub, now) };
}

export async function usageFor(workspaceId, now = new Date()) {
  const keys = Object.keys(COUNTERS);
  const counts = await Promise.all(keys.map((k) => COUNTERS[k](workspaceId, now)));
  return Object.fromEntries(keys.map((k, i) => [k, counts[i]]));
}

/**
 * Blocks creating a record past the workspace's plan limit. Called by each
 * create service; existing records are never touched when a plan lapses.
 */
export async function assertWithinLimit(workspace, key, now = new Date()) {
  const { plan } = await workspacePlan(workspace._id, now);
  const limit = limitsFor(plan)[key];
  if (limit == null) return;
  const used = await COUNTERS[key](workspace._id, now);
  if (used >= limit) {
    throw new ApiError(
      403,
      'PLAN_LIMIT',
      `The ${planName(plan)} plan includes ${limit} ${LIMIT_LABELS[key]}. ${key.endsWith('PerMonth') ? 'The count resets on the 1st, or you can upgrade' : 'Archive one you no longer use, or upgrade'} in Settings → Plan and billing.`,
      { limit: key, max: limit, used },
    );
  }
}
