import { describe, expect, it } from 'vitest';
import { addDays, addMonths, occurrence, periodOf, previousPeriod, todayIn } from '../utils/periods.js';
import { Budget } from '../modules/budgets/budget.model.js';
import { RecurringTransaction } from '../modules/recurring/recurring.model.js';
import { runDueSchedules } from '../modules/recurring/recurring.service.js';
import { Transaction } from '../modules/transactions/transaction.model.js';
import { api, registerUser, tokenFromEmail } from './helpers.js';

const TODAY = todayIn('Africa/Accra');

async function setup() {
  const u = await registerUser();
  const h = { ...u.auth, 'X-Workspace-Id': u.user.lastWorkspaceId };
  const cats = (await api().get('/api/categories').set(h)).body.data;
  const cat = (key) => cats.find((c) => c.systemKey === key).id;
  const acc = (await api().post('/api/accounts').set(h).send({ name: 'Bank', type: 'bank', currency: 'GHS', openingBalance: '5000' })).body.data;
  const expense = (amount, extra = {}) =>
    api().post('/api/transactions').set(h).send({ type: 'expense', accountId: acc.id, categoryId: cat('food'), amount, date: TODAY, description: 'Spend', ...extra });
  return { ...u, h, cat, acc, expense, ws: u.user.lastWorkspaceId };
}

describe('calendar maths', () => {
  it('builds Monday-to-Sunday weeks, calendar months and years', () => {
    expect(periodOf('weekly', '2026-11-11')).toEqual({ start: '2026-11-09', end: '2026-11-15', key: 'W2026-11-09' });
    expect(periodOf('weekly', '2026-11-15').start).toBe('2026-11-09'); // Sunday belongs to the week before
    expect(periodOf('monthly', '2028-02-10')).toMatchObject({ start: '2028-02-01', end: '2028-02-29' });
    expect(periodOf('yearly', '2026-06-30')).toMatchObject({ start: '2026-01-01', end: '2026-12-31' });
    expect(previousPeriod('monthly', '2026-01-15')).toMatchObject({ start: '2025-12-01', end: '2025-12-31' });
  });

  it('clamps month ends without drifting', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(occurrence('2026-01-31', 'monthly', 1, 1)).toBe('2026-02-28');
    expect(occurrence('2026-01-31', 'monthly', 1, 2)).toBe('2026-03-31');
    expect(occurrence('2024-02-29', 'yearly', 1, 1)).toBe('2025-02-28');
    expect(occurrence('2026-11-11', 'weekly', 2, 3)).toBe('2026-12-23');
    expect(occurrence('2026-12-15', 'quarterly', 1, 1)).toBe('2027-03-15');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('budgets', () => {
  it('tracks spending against the current period with exact remaining and utilisation', async () => {
    const s = await setup();
    const b = (await api().post('/api/budgets').set(s.h).send({ name: 'Food', period: 'monthly', scope: 'categories', categoryIds: [s.cat('food')], amount: '1000', alertAt: 80 })).body.data;
    await s.expense('333.33');
    await s.expense('100.01');
    // Other categories and income don't count.
    await s.expense('500', { categoryId: s.cat('transport') });
    await api().post('/api/transactions').set(s.h).send({ type: 'income', accountId: s.acc.id, categoryId: s.cat('salary'), amount: '9000', date: TODAY, description: 'Pay' });

    const res = await api().get(`/api/budgets/${b.id}`).set(s.h).expect(200);
    expect(res.body.data.current).toMatchObject({ amount: '1000.00', spent: '433.34', remaining: '566.66', utilisation: '43.3', state: 'under', transactionCount: 2 });
  });

  it('a whole-workspace budget counts every expense category', async () => {
    const s = await setup();
    const b = (await api().post('/api/budgets').set(s.h).send({ name: 'Everything', period: 'weekly', scope: 'all', amount: '200' })).body.data;
    await s.expense('150');
    await s.expense('80', { categoryId: s.cat('transport') });
    const res = await api().get(`/api/budgets/${b.id}`).set(s.h);
    expect(res.body.data.current).toMatchObject({ spent: '230.00', remaining: '-30.00', state: 'over' });
  });

  it('alerts owners once at the warning level and once when exceeded', async () => {
    const s = await setup();
    await api().post('/api/budgets').set(s.h).send({ name: 'Food', period: 'monthly', scope: 'categories', categoryIds: [s.cat('food')], amount: '100', alertAt: 80 });
    await s.expense('50');
    let n = (await api().get('/api/notifications').set(s.auth)).body;
    expect(n.data).toHaveLength(0);

    await s.expense('35'); // 85%
    await s.expense('1'); // still warning: no duplicate
    n = (await api().get('/api/notifications').set(s.auth)).body;
    expect(n.data.map((x) => x.type)).toEqual(['budget_warning']);
    expect(n.meta.unread).toBe(1);

    await s.expense('20'); // 106%
    n = (await api().get('/api/notifications').set(s.auth)).body;
    expect(n.data.map((x) => x.type).sort()).toEqual(['budget_exceeded', 'budget_warning']);

    await api().post('/api/notifications/read-all').set(s.auth).expect(200);
    expect((await api().get('/api/notifications').set(s.auth)).body.meta.unread).toBe(0);
  });

  it('paused budgets don’t alert', async () => {
    const s = await setup();
    const b = (await api().post('/api/budgets').set(s.h).send({ name: 'Food', period: 'monthly', scope: 'all', amount: '10' })).body.data;
    await api().patch(`/api/budgets/${b.id}`).set(s.h).send({ status: 'paused' }).expect(200);
    await s.expense('50');
    expect((await api().get('/api/notifications').set(s.auth)).body.data).toHaveLength(0);
  });

  it('a changed limit applies from the current period; history keeps earlier limits', async () => {
    const s = await setup();
    const b = (await api().post('/api/budgets').set(s.h).send({ name: 'Food', period: 'monthly', scope: 'all', amount: '1000' })).body.data;
    await api().patch(`/api/budgets/${b.id}`).set(s.h).send({ amount: '1500' }).expect(200);
    // Spending in the previous month is compared with the old limit.
    const lastMonth = addDays(periodOf('monthly', TODAY).start, -3);
    await s.expense('400', { date: lastMonth });
    await s.expense('300');

    const hist = (await api().get(`/api/budgets/${b.id}/history?periods=3`).set(s.h)).body.data;
    expect(hist[0]).toMatchObject({ amount: '1500.00', spent: '300.00', utilisation: '20.0' });
    expect(hist[1]).toMatchObject({ amount: '1000.00', spent: '400.00', utilisation: '40.0' });
    expect(hist[2].spent).toBe('0.00');
    const stored = await Budget.findById(b.id).lean();
    expect(stored.amounts).toHaveLength(2);
  });

  it('validates categories and archives on delete', async () => {
    const s = await setup();
    await api().post('/api/budgets').set(s.h).send({ name: 'x', period: 'monthly', scope: 'categories', amount: '10' }).expect(422);
    await api().post('/api/budgets').set(s.h).send({ name: 'x', period: 'monthly', scope: 'categories', categoryIds: [s.cat('salary')], amount: '10' }).expect(422);
    const b = (await api().post('/api/budgets').set(s.h).send({ name: 'x', period: 'monthly', scope: 'all', amount: '10' })).body.data;
    await api().patch(`/api/budgets/${b.id}`).set(s.h).send({ period: 'weekly' }).expect(422);
    await api().delete(`/api/budgets/${b.id}`).set(s.h).expect(200);
    expect((await api().get('/api/budgets').set(s.h)).body.data).toHaveLength(0);
    expect((await api().get('/api/budgets?includeArchived=true').set(s.h)).body.data[0].status).toBe('archived');
  });
});

describe('savings goals', () => {
  it('tracks contributions and withdrawals without touching accounts or reports', async () => {
    const s = await setup();
    const g = (await api().post('/api/savings-goals').set(s.h).send({ name: 'School fees', targetAmount: '3000', currency: 'GHS', targetDate: addDays(TODAY, 120), contributionFrequency: 'monthly' })).body.data;
    await api().post(`/api/savings-goals/${g.id}/entries`).set(s.h).send({ type: 'contribution', amount: '1000.10', date: TODAY }).expect(201);
    const res = await api().post(`/api/savings-goals/${g.id}/entries`).set(s.h).send({ type: 'withdrawal', amount: '200.05', date: TODAY }).expect(201);
    expect(res.body.data.goal.summary).toMatchObject({ contributed: '1000.10', withdrawn: '200.05', current: '800.05', remaining: '2199.95', progress: '26.7', reached: false });
    expect(res.body.data.goal.summary.requiredPerPeriod).not.toBeNull();
    // One day of history is too little to project a pace from.
    expect(res.body.data.goal.summary.projectedDate).toBeNull();

    // Accounts and income/expense totals are unchanged.
    expect((await api().get(`/api/accounts/${s.acc.id}`).set(s.h)).body.data.balance).toBe('5000.00');
    const sum = (await api().get('/api/transactions/summary').set(s.h)).body.data;
    expect(sum).toMatchObject({ income: '0.00', expense: '0.00' });
  });

  it('won’t withdraw more than is saved, and reverses entries with a reason instead of editing', async () => {
    const s = await setup();
    const g = (await api().post('/api/savings-goals').set(s.h).send({ name: 'Car', targetAmount: '500', currency: 'GHS' })).body.data;
    const c = (await api().post(`/api/savings-goals/${g.id}/entries`).set(s.h).send({ type: 'contribution', amount: '100', date: TODAY })).body.data.entry;
    await api().post(`/api/savings-goals/${g.id}/entries`).set(s.h).send({ type: 'withdrawal', amount: '100.01', date: TODAY }).expect(422);
    const w = (await api().post(`/api/savings-goals/${g.id}/entries`).set(s.h).send({ type: 'withdrawal', amount: '60', date: TODAY })).body.data.entry;

    await api().post(`/api/savings-goals/${g.id}/entries/${c.id}/reverse`).set(s.h).send({ reason: 'typo' }).expect(409); // would go negative
    await api().post(`/api/savings-goals/${g.id}/entries/${w.id}/reverse`).set(s.h).send({}).expect(422); // reason required
    const r = await api().post(`/api/savings-goals/${g.id}/entries/${w.id}/reverse`).set(s.h).send({ reason: 'Entered twice' }).expect(200);
    expect(r.body.data.goal.summary.current).toBe('100.00');
    await api().post(`/api/savings-goals/${g.id}/entries/${w.id}/reverse`).set(s.h).send({ reason: 'again' }).expect(404);

    const entries = (await api().get(`/api/savings-goals/${g.id}/entries`).set(s.h)).body.data;
    expect(entries.find((e) => e.id === w.id)).toMatchObject({ status: 'reversed', reversalReason: 'Entered twice' });
    await api().post(`/api/savings-goals/${g.id}/entries`).set(s.h).send({ type: 'contribution', amount: '1', date: addDays(TODAY, 2) }).expect(422);
  });

  it('projects a completion date from at least two weeks of history', async () => {
    const s = await setup();
    const g = (await api().post('/api/savings-goals').set(s.h).send({ name: 'Fridge', targetAmount: '1000', currency: 'GHS' })).body.data;
    const res = await api().post(`/api/savings-goals/${g.id}/entries`).set(s.h).send({ type: 'contribution', amount: '200', date: addDays(TODAY, -20) });
    // 200 over 20 days = 10 a day; 800 left = 80 more days.
    expect(res.body.data.goal.summary.projectedDate).toBe(addDays(TODAY, 80));
  });

  it('marks a goal reached and gives a monthly trend', async () => {
    const s = await setup();
    const g = (await api().post('/api/savings-goals').set(s.h).send({ name: 'Phone', targetAmount: '100', currency: 'GHS' })).body.data;
    const res = await api().post(`/api/savings-goals/${g.id}/entries`).set(s.h).send({ type: 'contribution', amount: '120', date: TODAY });
    expect(res.body.data.goal.summary).toMatchObject({ reached: true, remaining: '0.00', progress: '120.0', projectedDate: null });
    const trend = (await api().get(`/api/savings-goals/${g.id}/trend`).set(s.h)).body.data;
    expect(trend).toHaveLength(12);
    expect(trend[11]).toEqual({ month: TODAY.slice(0, 7), net: '120.00' });
  });
});

describe('debts', () => {
  it('computes the balance from principal, charges and payments and marks it paid off', async () => {
    const s = await setup();
    const d = (await api().post('/api/debts').set(s.h).send({ name: 'Car loan', direction: 'i_owe', counterparty: 'Fidelity Bank', principal: '1000', currency: 'GHS', startDate: addDays(TODAY, -30), interestRate: '24' })).body.data;
    await api().post(`/api/debts/${d.id}/payments`).set(s.h).send({ type: 'charge', amount: '20.50', date: TODAY, notes: 'Interest' }).expect(201);
    let r = await api().post(`/api/debts/${d.id}/payments`).set(s.h).send({ amount: '400', date: TODAY }).expect(201);
    expect(r.body.data.debt.summary).toMatchObject({ owedTotal: '1020.50', paid: '400.00', balance: '620.50', paidPercent: '39.2' });
    expect(r.body.data.debt.summary.projectedPayoff).not.toBeNull();

    await api().post(`/api/debts/${d.id}/payments`).set(s.h).send({ amount: '620.51', date: TODAY }).expect(422);
    r = await api().post(`/api/debts/${d.id}/payments`).set(s.h).send({ amount: '620.50', date: TODAY }).expect(201);
    expect(r.body.data.debt).toMatchObject({ status: 'paid_off' });
    expect(r.body.data.debt.summary.balance).toBe('0.00');

    // Reversing the final payment reopens it.
    const pid = r.body.data.payment.id;
    r = await api().post(`/api/debts/${d.id}/payments/${pid}/reverse`).set(s.h).send({ reason: 'Bounced' }).expect(200);
    expect(r.body.data.debt.status).toBe('active');
    expect((await api().get(`/api/accounts/${s.acc.id}`).set(s.h)).body.data.balance).toBe('5000.00');
  });

  it('flags overdue debts and locks the principal once payments exist', async () => {
    const s = await setup();
    const d = (await api().post('/api/debts').set(s.h).send({ name: 'Loan to Kojo', direction: 'owed_to_me', principal: '300', currency: 'GHS', startDate: addDays(TODAY, -60), dueDate: addDays(TODAY, -1) })).body.data;
    expect(d.summary.overdue).toBe(true);
    await api().post(`/api/debts/${d.id}/payments`).set(s.h).send({ amount: '100', date: TODAY });
    await api().patch(`/api/debts/${d.id}`).set(s.h).send({ principal: '400' }).expect(409);
    await api().post(`/api/debts/${d.id}/payments`).set(s.h).send({ amount: '1', date: addDays(TODAY, -61) }).expect(422);

    const dash = (await api().get(`/api/analytics/dashboard?from=${TODAY}&to=${TODAY}`).set(s.h)).body.data;
    expect(dash.debts).toEqual([{ direction: 'owed_to_me', currency: 'GHS', balance: '200.00', count: 1, overdue: 1 }]);
  });
});

describe('recurring transactions', () => {
  const schedule = (s, body) => api().post('/api/recurring').set(s.h).send({ type: 'expense', accountId: s.acc.id, categoryId: s.cat('utilities'), amount: '150', description: 'ECG prepaid', frequency: 'weekly', ...body });

  it('catches up past occurrences once, then only creates new ones when due', async () => {
    const s = await setup();
    const res = await schedule(s, { startDate: addDays(TODAY, -14) }).expect(201);
    // TODAY-14, TODAY-7 and TODAY are all due.
    expect(res.body.data.created).toBe(3);
    expect(res.body.data.nextDate).toBe(addDays(TODAY, 7));

    // Running again (or on a second server) creates nothing new.
    await runDueSchedules();
    await runDueSchedules();
    expect(await Transaction.countDocuments({ recurringId: res.body.data.id })).toBe(3);
    expect((await api().get(`/api/accounts/${s.acc.id}`).set(s.h)).body.data.balance).toBe('4550.00');

    // A week later, one more.
    await runDueSchedules(new Date(Date.now() + 7 * 86400000));
    expect(await Transaction.countDocuments({ recurringId: res.body.data.id })).toBe(4);
  });

  it('turns an existing transaction into a schedule that continues from it', async () => {
    const s = await setup();
    const tx = (await s.expense('99', { date: addDays(TODAY, -31), description: 'Netflix' })).body.data;
    const res = await api().post('/api/recurring').set(s.h).send({ fromTransactionId: tx.id, frequency: 'monthly' }).expect(201);
    expect(res.body.data.anchorDate).toBe(tx.date);
    expect(res.body.data.created).toBeGreaterThanOrEqual(2); // the original plus last month's catch-up
    const original = (await api().get(`/api/transactions/${tx.id}`).set(s.h)).body.data;
    expect(original).toMatchObject({ recurringId: res.body.data.id, recurrence: { isRecurring: true, frequency: 'monthly' } });
    await api().post('/api/recurring').set(s.h).send({ fromTransactionId: tx.id, frequency: 'monthly' }).expect(409);
  });

  it('stops and notifies when a foreign-currency occurrence has no rate', async () => {
    const s = await setup();
    const usd = (await api().post('/api/accounts').set(s.h).send({ name: 'USD', type: 'bank', currency: 'USD' })).body.data;
    const res = await schedule(s, { accountId: usd.id, startDate: TODAY, amount: '10' }).expect(201);
    expect(res.body.data.created).toBe(0);
    expect(res.body.data.lastError).toMatch(/exchange rate/);
    expect(res.body.data.nextDate).toBe(TODAY); // not skipped
    const n = (await api().get('/api/notifications').set(s.auth)).body.data;
    expect(n[0].type).toBe('recurring_failed');

    // After adding a rate, resuming creates it.
    await api().post('/api/exchange-rates').set(s.h).send({ from: 'USD', to: 'GHS', rate: '15', effectiveDate: TODAY });
    const resumed = await api().patch(`/api/recurring/${res.body.data.id}`).set(s.h).send({ status: 'active' }).expect(200);
    expect(resumed.body.data.created).toBe(1);
  });

  it('in remind mode, waits for confirmation and confirming twice saves once', async () => {
    const s = await setup();
    const res = await schedule(s, { startDate: TODAY, mode: 'remind' }).expect(201);
    expect(res.body.data).toMatchObject({ created: 0, pending: [TODAY] });
    const n = (await api().get('/api/notifications').set(s.auth)).body.data;
    expect(n[0]).toMatchObject({ type: 'recurring_due', data: { date: TODAY } });

    await api().post(`/api/recurring/${res.body.data.id}/confirm`).set(s.h).send({ date: TODAY }).expect(201);
    await api().post(`/api/recurring/${res.body.data.id}/confirm`).set(s.h).send({ date: TODAY }).expect(400);
    expect(await Transaction.countDocuments({ recurringId: res.body.data.id })).toBe(1);
  });

  it('respects end dates, pausing and skipping', async () => {
    const s = await setup();
    const ended = await schedule(s, { startDate: addDays(TODAY, -14), endDate: addDays(TODAY, -7) }).expect(201);
    expect(ended.body.data).toMatchObject({ created: 2, status: 'ended', nextDate: null });

    const r = (await schedule(s, { startDate: addDays(TODAY, 1), frequency: 'daily' })).body.data;
    await api().post(`/api/recurring/${r.id}/skip`).set(s.h).expect(200);
    const paused = await api().patch(`/api/recurring/${r.id}`).set(s.h).send({ status: 'paused' });
    expect(paused.body.data.nextDate).toBeNull();
    await runDueSchedules(new Date(Date.now() + 5 * 86400000));
    expect(await Transaction.countDocuments({ recurringId: r.id })).toBe(0);
    const stored = await RecurringTransaction.findById(r.id).lean();
    expect(stored.occurrencesDone).toBe(1);
  });

  it('stops creating if the schedule’s creator loses write access', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const ws = (await api().post('/api/workspaces').set(owner.auth).send({ name: 'Shop', type: 'business', baseCurrency: 'GHS' })).body.data;
    await api().post(`/api/workspaces/${ws.id}/invitations`).set(owner.auth).send({ email: member.email, role: 'member' });
    await api().post('/api/workspaces/invitations/accept').set(member.auth).send({ token: tokenFromEmail(member.email, '/invitations/accept') });
    const mh = { ...member.auth, 'X-Workspace-Id': ws.id };
    const acc = (await api().post('/api/accounts').set(mh).send({ name: 'Till', type: 'cash', currency: 'GHS' })).body.data;
    const cats = (await api().get('/api/categories').set(mh)).body.data;
    const r = (await api().post('/api/recurring').set(mh).send({ type: 'expense', accountId: acc.id, categoryId: cats.find((c) => c.kind === 'expense').id, amount: '5', description: 'Rent', frequency: 'daily', startDate: addDays(TODAY, 1) })).body.data;

    const members = (await api().get(`/api/workspaces/${ws.id}/members`).set(owner.auth)).body.data;
    await api().patch(`/api/workspaces/${ws.id}/members/${members.find((m) => m.email === member.email).id}`).set(owner.auth).send({ role: 'viewer' });
    await runDueSchedules(new Date(Date.now() + 3 * 86400000));
    expect(await Transaction.countDocuments({ recurringId: r.id })).toBe(0);
    expect((await RecurringTransaction.findById(r.id).lean()).lastError).toMatch(/no longer has access/);
  });
});

describe('isolation', () => {
  it('budgets, goals, debts and schedules from another workspace are invisible', async () => {
    const a = await setup();
    const b = await setup();
    const bb = (await api().post('/api/budgets').set(b.h).send({ name: 'x', period: 'monthly', scope: 'all', amount: '1' })).body.data;
    const bg = (await api().post('/api/savings-goals').set(b.h).send({ name: 'x', targetAmount: '1', currency: 'GHS' })).body.data;
    const bd = (await api().post('/api/debts').set(b.h).send({ name: 'x', direction: 'i_owe', principal: '1', currency: 'GHS', startDate: TODAY })).body.data;
    await api().get(`/api/budgets/${bb.id}`).set(a.h).expect(404);
    await api().post(`/api/savings-goals/${bg.id}/entries`).set(a.h).send({ type: 'contribution', amount: '1', date: TODAY }).expect(404);
    await api().post(`/api/debts/${bd.id}/payments`).set(a.h).send({ amount: '1', date: TODAY }).expect(404);
    await api().post('/api/budgets').set(a.h).send({ name: 'x', period: 'monthly', scope: 'categories', categoryIds: [b.cat('food')], amount: '1' }).expect(422);
    await api().post('/api/recurring').set(a.h).send({ type: 'expense', accountId: b.acc.id, categoryId: a.cat('food'), amount: '1', description: 'x', frequency: 'monthly', startDate: TODAY }).expect(422);
  });
});
