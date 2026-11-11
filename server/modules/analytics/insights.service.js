import { D } from '../../utils/money.js';
import { money } from '../business/pdf.js';
import { listBudgets } from '../budgets/budgets.service.js';
import { listDebts } from '../debts/debts.service.js';
import { susuSummary } from '../susu/personal.service.js';
import { businessOverview } from '../business/reports.service.js';
import { incomeExpenseSeries, spendingAnalysis, groupPerformance } from './analytics.service.js';
import { SavingsGoal } from '../savings/savings.models.js';
import { presentGoal } from '../savings/savings.service.js';

/**
 * Financial insights from fixed rules over deterministic figures. Each
 * insight carries the exact figures it's based on. Nothing here is generated
 * by a model, so these are facts about the records, not advice.
 */

const SEVERITY_ORDER = { warning: 0, info: 1, good: 2 };

export async function buildInsights(workspace, user, { from, to }, today) {
  const cur = workspace.baseCurrency;
  const m = (amount, c = cur) => money(amount, c);
  const out = [];
  const add = (i) => out.push(i);

  const [flow, spend, budgets, goals, debts, susu, groups] = await Promise.all([
    incomeExpenseSeries(workspace, { from, to, granularity: 'month' }),
    spendingAnalysis(workspace, { from, to }),
    listBudgets(workspace, today),
    SavingsGoal.find({ workspaceId: workspace._id, status: 'active' }).then((gs) => Promise.all(gs.map((g) => presentGoal(g, today)))),
    listDebts(workspace, today),
    susuSummary(workspace, today),
    groupPerformance(user, today),
  ]);

  const t = flow.totals;
  if (new D(t.net).isNegative()) {
    add({ id: 'net-negative', topic: 'income', severity: 'warning', title: `You spent ${m(new D(t.net).abs().toString())} more than you earned`, detail: `Income ${m(t.income)}, spending ${m(t.expense)} between ${from} and ${to}.`, figures: { income: t.income, expense: t.expense, net: t.net }, link: '/reports' });
  } else if (new D(t.income).greaterThan(0) && t.savingsRate !== null) {
    add({ id: 'net-positive', topic: 'income', severity: 'good', title: `You kept ${t.savingsRate}% of your income`, detail: `Income ${m(t.income)}, spending ${m(t.expense)}, left over ${m(t.net)}.`, figures: { income: t.income, expense: t.expense, net: t.net, savingsRate: t.savingsRate }, link: '/reports' });
  }

  if (spend.change !== null && new D(spend.change).abs().gte(20)) {
    const up = new D(spend.change).isPositive();
    add({ id: 'spending-change', topic: 'spending', severity: up ? 'warning' : 'good', title: `Spending ${up ? 'up' : 'down'} ${new D(spend.change).abs().toFixed(1)}% on the previous period`, detail: `${m(spend.total)} against ${m(spend.previousTotal)} from ${spend.previous.from} to ${spend.previous.to}.`, figures: { total: spend.total, previousTotal: spend.previousTotal, change: spend.change }, link: '/reports' });
  }

  for (const u of spend.unusual) {
    if (u.kind === 'category_spike') {
      add({ id: `spike-${u.categoryId}`, topic: 'spending', severity: 'warning', title: `${u.category} is ${u.ratio}× its usual level`, detail: `${m(u.amount)} this period; it averaged ${m(u.average)} over the three periods before.`, figures: { amount: u.amount, average: u.average, ratio: u.ratio }, link: '/expenses' });
    } else {
      add({ id: `large-${u.transactionId}`, topic: 'spending', severity: 'info', title: `A large ${u.category} expense on ${u.date}`, detail: `${m(u.amount)}, about ${u.ratio}× your typical ${u.category} expense of ${m(u.typical)}.`, figures: { amount: u.amount, typical: u.typical, ratio: u.ratio }, link: `/transactions?focus=${u.transactionId}` });
    }
  }

  for (const b of budgets.filter((x) => x.status === 'active')) {
    const c = b.current;
    if (c.state === 'over') add({ id: `budget-over-${b.id}`, topic: 'budgets', severity: 'warning', title: `${b.name} is over budget`, detail: `${m(c.spent, b.currency)} spent of ${m(c.amount, b.currency)} (${c.utilisation}%), with ${c.daysLeft} days left in the period.`, figures: { spent: c.spent, amount: c.amount, utilisation: c.utilisation }, link: '/budgets' });
    else if (c.state === 'warning') add({ id: `budget-warn-${b.id}`, topic: 'budgets', severity: 'warning', title: `${b.name} is ${c.utilisation}% used`, detail: `${m(c.remaining, b.currency)} left for ${c.daysLeft} more days.`, figures: { spent: c.spent, amount: c.amount, remaining: c.remaining, utilisation: c.utilisation }, link: '/budgets' });
  }

  for (const g of goals) {
    const s = g.summary;
    if (s.reached) add({ id: `goal-reached-${g.id}`, topic: 'savings', severity: 'good', title: `${g.name} has reached its target`, detail: `${m(s.current, g.currency)} saved of ${m(g.targetAmount, g.currency)}.`, figures: { current: s.current, target: g.targetAmount }, link: `/savings/${g.id}` });
    else if (s.overdue) add({ id: `goal-overdue-${g.id}`, topic: 'savings', severity: 'warning', title: `${g.name} passed its target date`, detail: `${m(s.remaining, g.currency)} still to go (${s.progress}% saved).`, figures: { remaining: s.remaining, progress: s.progress }, link: `/savings/${g.id}` });
    else if (s.onTrack === false) add({ id: `goal-behind-${g.id}`, topic: 'savings', severity: 'info', title: `${g.name} is behind pace`, detail: s.requiredPerPeriod ? `About ${m(s.requiredPerPeriod, g.currency)} per ${g.contributionFrequency.replace('ly', '')} would reach it by ${g.targetDate}.` : `${s.progress}% saved so far.`, figures: { progress: s.progress, requiredPerPeriod: s.requiredPerPeriod }, link: `/savings/${g.id}` });
  }

  const overdueDebts = debts.filter((d) => d.status === 'active' && d.summary?.overdue);
  if (overdueDebts.length) {
    add({ id: 'debts-overdue', topic: 'debts', severity: 'warning', title: `${overdueDebts.length} debt${overdueDebts.length > 1 ? 's are' : ' is'} past the due date`, detail: overdueDebts.map((d) => `${d.name}: ${m(d.summary.balance, d.currency)} left`).join('; '), figures: Object.fromEntries(overdueDebts.map((d) => [d.name, d.summary.balance])), link: '/debts' });
  }

  for (const p of susu.plans.filter((x) => x.missed > 0)) {
    add({ id: `susu-missed-${p.id}`, topic: 'susu', severity: 'warning', title: `${p.name}: ${p.missed} missed contribution${p.missed > 1 ? 's' : ''}`, detail: `${m(p.current, p.currency)} recorded so far.${p.nextDue ? ` Next due ${p.nextDue}.` : ''}`, figures: { missed: String(p.missed), current: p.current }, link: `/susu/plans/${p.id}` });
  }
  for (const g of groups.filter((x) => x.missedCycles > 0 || new D(x.outstanding).greaterThan(0))) {
    add({ id: `group-${g.groupId}`, topic: 'susu', severity: 'warning', title: `${g.name}: ${m(g.outstanding, g.currency)} outstanding`, detail: `${g.missedCycles} cycle${g.missedCycles === 1 ? '' : 's'} missed by you, from the group's records.`, figures: { outstanding: g.outstanding, missedCycles: String(g.missedCycles) }, link: `/susu/groups/${g.groupId}` });
  }

  if (workspace.type === 'business') {
    const b = await businessOverview(workspace, { from, to }, today);
    const pl = b.profitAndLoss;
    const p = pl.change.netProfit.percent;
    if (p != null && new D(p).abs().gte(15)) {
      const up = new D(p).isPositive();
      add({ id: 'profit-change', topic: 'business', severity: up ? 'good' : 'warning', title: `Profit ${up ? 'up' : 'down'} ${new D(p).abs().toFixed(1)}% on the previous period`, detail: `${m(pl.netProfit)} against ${m(pl.previous.netProfit)} from ${pl.previousPeriod.from} to ${pl.previousPeriod.to}.`, figures: { netProfit: pl.netProfit, previousNetProfit: pl.previous.netProfit, change: p }, link: '/business/reports' });
    }
    if (b.overdueInvoices) add({ id: 'invoices-overdue', topic: 'business', severity: 'warning', title: `${b.overdueInvoices} overdue invoice${b.overdueInvoices > 1 ? 's' : ''}`, detail: 'Customers are past the due date on these.', figures: { overdueInvoices: String(b.overdueInvoices) }, link: '/business/invoices?status=overdue' });
    if (b.overdueBills) add({ id: 'bills-overdue', topic: 'business', severity: 'warning', title: `${b.overdueBills} overdue bill${b.overdueBills > 1 ? 's' : ''}`, detail: 'These are past their due date.', figures: { overdueBills: String(b.overdueBills) }, link: '/business/bills?status=overdue' });
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
