import { env } from '../../config/env.js';
import { AMOUNT_PATTERN, fitsCurrency, isPositive, normalize } from '../../utils/money.js';

/**
 * BudgetFlow's own software plans. Paid plans are tied to a workspace type, so
 * a personal workspace can only buy Personal Pro and a business workspace only
 * Business Pro.
 *
 * Limits and prices are configuration, not code:
 *   PLAN_PRICES  e.g. "personal_pro.monthly=25.00,personal_pro.yearly=250.00"
 *   PLAN_LIMITS  JSON merged over the defaults, e.g. {"free":{"accounts":8}}
 * A paid plan with no configured price can't be bought.
 */
export const BILLING_PERIODS = ['monthly', 'yearly'];
export const PAID_PLANS = ['personal_pro', 'business_pro'];

/** Resource limits. null means unlimited. Counts are of live (not archived) records. */
export const LIMIT_LABELS = {
  accounts: 'accounts',
  budgets: 'budgets',
  savingsGoals: 'savings goals',
  debts: 'debts',
  recurring: 'repeating schedules',
  susuPlans: 'personal Susu plans',
  invoicesPerMonth: 'invoices a month',
  billsPerMonth: 'bills a month',
  aiQuestionsPerMonth: 'AI assistant questions a month',
};
const LIMIT_KEYS = Object.keys(LIMIT_LABELS);
const unlimited = Object.fromEntries(LIMIT_KEYS.map((k) => [k, null]));

const DEFAULT_LIMITS = {
  free: { accounts: 5, budgets: 5, savingsGoals: 3, debts: 5, recurring: 5, susuPlans: 2, invoicesPerMonth: 10, billsPerMonth: 10, aiQuestionsPerMonth: 20 },
  // AI questions cost real money per call, so even paid plans have a monthly cap.
  personal_pro: { ...unlimited, aiQuestionsPerMonth: 300 },
  business_pro: { ...unlimited, aiQuestionsPerMonth: 600 },
};

const BASE = {
  free: { key: 'free', name: 'Free', workspaceType: null, summary: 'The essentials for tracking your money.' },
  personal_pro: { key: 'personal_pro', name: 'Personal Pro', workspaceType: 'personal', summary: 'No limits on accounts, budgets, goals, debts, schedules or Susu plans, and 300 AI assistant questions a month.' },
  business_pro: { key: 'business_pro', name: 'Business Pro', workspaceType: 'business', summary: 'No limits, including unlimited invoices and bills each month, and 600 AI assistant questions a month.' },
};

function parseLimits(raw) {
  const limits = structuredClone(DEFAULT_LIMITS);
  if (!raw) return limits;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PLAN_LIMITS must be JSON, e.g. {"free":{"accounts":8}}');
  }
  for (const [plan, values] of Object.entries(parsed)) {
    if (!limits[plan]) throw new Error(`PLAN_LIMITS: unknown plan "${plan}"`);
    for (const [k, v] of Object.entries(values)) {
      if (!LIMIT_KEYS.includes(k)) throw new Error(`PLAN_LIMITS: unknown limit "${k}"`);
      if (v !== null && !(Number.isInteger(v) && v >= 0)) throw new Error(`PLAN_LIMITS: ${plan}.${k} must be a whole number or null`);
      limits[plan][k] = v;
    }
  }
  return limits;
}

function parsePrices(raw, currency) {
  const prices = Object.fromEntries(PAID_PLANS.map((p) => [p, {}]));
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\w+)\.(\w+)=(.+)$/);
    if (!m || !prices[m[1]] || !BILLING_PERIODS.includes(m[2])) throw new Error(`PLAN_PRICES: can't read "${part}" (use plan.period=amount)`);
    if (!AMOUNT_PATTERN.test(m[3]) || !fitsCurrency(m[3], currency) || !isPositive(m[3])) throw new Error(`PLAN_PRICES: "${m[3]}" isn't a valid ${currency} amount`);
    prices[m[1]][m[2]] = normalize(m[3], currency);
  }
  return prices;
}

const LIMITS = parseLimits(env.plans.limits);
const PRICES = parsePrices(env.plans.prices, env.plans.currency);

export const planCurrency = () => env.plans.currency;
export const limitsFor = (plan) => LIMITS[plan] ?? LIMITS.free;

/** Price as a decimal string, or null when the plan/period isn't on sale. */
export function priceFor(plan, period) {
  return PRICES[plan]?.[period] ?? null;
}

export function listPlans() {
  return Object.values(BASE).map((p) => ({
    ...p,
    limits: limitsFor(p.key),
    currency: env.plans.currency,
    prices: p.key === 'free' ? null : Object.fromEntries(BILLING_PERIODS.map((b) => [b, priceFor(p.key, b)])),
  }));
}

export const planName = (key) => BASE[key]?.name ?? key;
export const paidPlanFor = (workspaceType) => (workspaceType === 'business' ? 'business_pro' : 'personal_pro');
