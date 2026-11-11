import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { calendarDate } from '../../validators/money.js';
import { ok } from '../../utils/http.js';
import { listAccounts } from '../accounts/accounts.service.js';
import { listTransactions, summarize } from '../transactions/transactions.service.js';
import { listBudgets } from '../budgets/budgets.service.js';
import { savingsOverview } from '../savings/savings.service.js';
import { debtOverview } from '../debts/debts.service.js';
import { todayIn } from '../../utils/periods.js';
import { susuSummary } from '../susu/personal.service.js';
import { businessOverview } from '../business/reports.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { can } from '../workspaces/permissions.js';
import { csvCell } from '../transactions/csv.js';
import { daysBetween } from '../../utils/periods.js';
import { incomeExpenseSeries, savingsAnalysis, separatedTotals, spendingAnalysis } from './analytics.service.js';
import { buildInsights } from './insights.service.js';

const dashboardSchema = { query: Joi.object({ from: calendarDate.required(), to: calendarDate.required() }) };
const GRAN = Joi.string().valid('month', 'quarter', 'year').default('month');
const rangeSchema = (extra = {}) => ({ query: Joi.object({ from: calendarDate.required(), to: calendarDate.required(), ...extra }) });

/** Ranges must run forwards and stay within ten years, so queries stay bounded. */
function checkRange(req, _res, next) {
  const { from, to } = req.valid.query;
  if (from > to) return next(ApiError.badRequest('The start date must be on or before the end date.'));
  if (daysBetween(from, to) > 3660) return next(ApiError.badRequest('Choose a range of ten years or less.'));
  next();
}
const today = (req) => todayIn(req.user.timezone);

/**
 * One round trip for the dashboard. Every figure comes from the same
 * deterministic calculations as the transaction and account endpoints.
 */
async function dashboard(req, res) {
  const { from, to } = req.valid.query;
  const today = todayIn(req.user.timezone);
  const [summary, accounts, recent, budgets, savings, debts, susu] = await Promise.all([
    summarize(req.workspace, { from, to }),
    listAccounts(req.workspace._id),
    listTransactions(req.workspace._id, { page: 1, limit: 6 }),
    listBudgets(req.workspace, today),
    savingsOverview(req.workspace._id, today),
    debtOverview(req.workspace._id, today),
    susuSummary(req.workspace, today),
  ]);
  ok(res, {
    summary,
    accounts,
    recent: recent.items,
    totalTransactions: recent.meta.total,
    budgets: budgets.filter((b) => b.status === 'active'),
    savings,
    debts,
    // Reported separately: Susu records are never income or spending.
    susu: susu.totals,
  });
}

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth, requireWorkspace('records.read'));
analyticsRouter.get('/dashboard', validate(dashboardSchema), dashboard);
// Business summary for a period: cash-basis profit and loss plus receivables and payables.
analyticsRouter.get('/business', validate(dashboardSchema), async (req, res) => {
  if (req.workspace.type !== 'business') throw ApiError.badRequest('Business analytics are available in business workspaces.');
  ok(res, await businessOverview(req.workspace, req.valid.query, todayIn(req.user.timezone)));
});

// Income vs spending per month, quarter or year, with the previous equal-length period.
analyticsRouter.get('/monthly', validate(rangeSchema({ granularity: GRAN, format: Joi.string().valid('json', 'csv').default('json') })), checkRange, async (req, res) => {
  const data = await incomeExpenseSeries(req.workspace, req.valid.query);
  if (req.valid.query.format !== 'csv') return ok(res, data);
  const lines = [['Period', 'Start', 'End', `Income (${data.currency})`, `Spending (${data.currency})`, `Net (${data.currency})`, 'Kept (%)'].map(csvCell).join(',')];
  for (const s of data.series) lines.push([s.label, s.start, s.end, s.income, s.expense, s.net, s.savingsRate ?? ''].map(csvCell).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="income-spending-${data.from}-to-${data.to}.csv"`).send('\ufeff' + lines.join('\r\n'));
});
// Money in and out per period with a running total. Transfers between accounts are excluded.
analyticsRouter.get('/cash-flow', validate(rangeSchema({ granularity: GRAN })), checkRange, async (req, res) => {
  const d = await incomeExpenseSeries(req.workspace, req.valid.query);
  ok(res, {
    currency: d.currency,
    from: d.from,
    to: d.to,
    granularity: d.granularity,
    series: d.series.map((s) => ({ key: s.key, label: s.label, start: s.start, end: s.end, inflow: s.income, outflow: s.expense, net: s.net, cumulative: s.cumulativeNet })),
    totals: { inflow: d.totals.income, outflow: d.totals.expense, net: d.totals.net },
    note: 'Tracked income and expenses only. Transfers between your own accounts, savings allocations and Susu records are not cash flow here.',
  });
});
analyticsRouter.get('/spending', validate(rangeSchema()), checkRange, async (req, res) => ok(res, await spendingAnalysis(req.workspace, req.valid.query)));
analyticsRouter.get('/savings', validate(rangeSchema({ granularity: GRAN })), checkRange, async (req, res) => ok(res, await savingsAnalysis(req.workspace, req.user, req.valid.query, today(req))));
analyticsRouter.get('/separated', validate(rangeSchema()), checkRange, async (req, res) =>
  ok(res, await separatedTotals(req.workspace, req.user, req.valid.query, { includeSubscriptions: can(req.membership.role, 'workspace.update') })),
);
analyticsRouter.get('/insights', validate(rangeSchema()), checkRange, async (req, res) => ok(res, await buildInsights(req.workspace, req.user, req.valid.query, today(req))));
