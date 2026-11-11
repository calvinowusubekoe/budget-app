import { afterEach, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '../utils/periods.js';
import { bucketsBetween, previousRange } from '../modules/analytics/analytics.service.js';
import { factNumbers, unverifiedFigures } from '../modules/ai/ai.service.js';
import { setAiClient } from '../modules/ai/ai.client.js';
import { AiUsage } from '../modules/ai/ai.models.js';
import { aiRouter } from '../modules/ai/ai.routes.js';
import { api, registerUser } from './helpers.js';

const TODAY = todayIn('Africa/Accra');
const A = '/api/analytics';

async function setup() {
  const u = await registerUser({ name: 'Abena Owner' });
  const h = { ...u.auth, 'X-Workspace-Id': u.user.lastWorkspaceId };
  const cats = (await api().get('/api/categories').set(h)).body.data;
  const cat = (kind, key) => cats.find((c) => c.kind === kind && c.systemKey === key).id;
  const bank = (await api().post('/api/accounts').set(h).send({ name: 'Bank', type: 'bank', currency: 'GHS', openingBalance: '10000' })).body.data;
  const momo = (await api().post('/api/accounts').set(h).send({ name: 'MoMo', type: 'mobile_money', currency: 'GHS' })).body.data;
  const tx = (type, amount, date, categoryKey, extra = {}) =>
    api()
      .post('/api/transactions')
      .set(h)
      .send({ type, accountId: bank.id, amount, date, description: 'Test', payee: 'Secret Payee Ltd', ...(categoryKey ? { categoryId: cat(type, categoryKey) } : {}), ...extra })
      .expect(201);
  return { ...u, h, cat, bank, momo, tx };
}

describe('period buckets', () => {
  it('builds clipped month, quarter and year buckets, including empty ones', () => {
    expect(bucketsBetween('month', '2026-01-15', '2026-03-10').map((b) => [b.key, b.start, b.end])).toEqual([
      ['2026-01', '2026-01-15', '2026-01-31'],
      ['2026-02', '2026-02-01', '2026-02-28'],
      ['2026-03', '2026-03-01', '2026-03-10'],
    ]);
    expect(bucketsBetween('quarter', '2026-01-01', '2026-12-31').map((b) => b.key)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']);
    expect(bucketsBetween('year', '2025-06-01', '2026-02-01').map((b) => b.key)).toEqual(['2025', '2026']);
    expect(previousRange('2026-03-01', '2026-03-31')).toEqual({ from: '2026-01-29', to: '2026-02-28' });
  });
});

describe('income vs spending', () => {
  it('sums exact decimals per period and keeps transfers, savings and Susu out', async () => {
    const s = await setup();
    await s.tx('income', '3000.10', '2026-09-05', 'salary');
    await s.tx('expense', '1200.05', '2026-09-20', 'food');
    await s.tx('income', '3000.10', '2026-10-05', 'salary');
    await s.tx('expense', '0.10', '2026-10-06', 'transport');
    await s.tx('expense', '0.20', '2026-10-07', 'transport');
    await api().post('/api/transactions').set(s.h).send({ type: 'transfer', accountId: s.bank.id, toAccountId: s.momo.id, amount: '500', date: '2026-10-08', description: 'Top up' }).expect(201);
    const goal = (await api().post('/api/savings-goals').set(s.h).send({ name: 'Rent', targetAmount: '3000', currency: 'GHS' })).body.data;
    await api().post(`/api/savings-goals/${goal.id}/entries`).set(s.h).send({ type: 'contribution', amount: '400', date: '2026-10-09' }).expect(201);
    const plan = (await api().post('/api/susu/plans').set(s.h).send({ name: 'Market', currency: 'GHS', contributionAmount: '20', frequency: 'daily', startDate: '2026-10-01', location: { type: 'collector', label: 'Auntie' }, targetAmount: '600' })).body.data;
    await api().post(`/api/susu/plans/${plan.id}/contributions`).set(s.h).send({ amount: '20', date: '2026-10-10' }).expect(201);

    const res = await api().get(`${A}/monthly`).set(s.h).query({ from: '2026-09-01', to: '2026-10-31' }).expect(200);
    const [sep, oct] = res.body.data.series;
    expect(sep).toMatchObject({ key: '2026-09', income: '3000.10', expense: '1200.05', net: '1800.05', cumulativeNet: '1800.05' });
    expect(oct).toMatchObject({ income: '3000.10', expense: '0.30', net: '2999.80', cumulativeNet: '4799.85', savingsRate: '100.0' });
    expect(res.body.data.totals).toMatchObject({ income: '6000.20', expense: '1200.35', net: '4799.85' });

    const q = await api().get(`${A}/monthly`).set(s.h).query({ from: '2026-07-01', to: '2026-12-31', granularity: 'quarter' }).expect(200);
    expect(q.body.data.series.map((x) => [x.key, x.income])).toEqual([['2026-Q3', '3000.10'], ['2026-Q4', '3000.10']]);

    const sepd = (await api().get(`${A}/separated`).set(s.h).query({ from: '2026-09-01', to: '2026-10-31' }).expect(200)).body.data;
    expect(sepd.trackedIncomeExpense).toMatchObject({ income: '6000.20', expense: '1200.35' });
    expect(sepd.transfers).toEqual([{ currency: 'GHS', amount: '500.00', count: 1 }]);
    expect(sepd.savingsAllocations).toEqual([{ currency: 'GHS', contributed: '400.00', withdrawn: '0.00', count: 1 }]);
    expect(sepd.personalSusu.contributions).toEqual([{ currency: 'GHS', amount: '20.00', count: 1 }]);
    expect(sepd.subscriptionPayments).toEqual([]); // owner can see them; none yet
  });

  it('exports CSV and validates ranges', async () => {
    const s = await setup();
    await s.tx('income', '10', '2026-10-05', 'salary');
    const csv = await api().get(`${A}/monthly`).set(s.h).query({ from: '2026-10-01', to: '2026-10-31', format: 'csv' }).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Oct 2026,2026-10-01,2026-10-31,10.00,0.00,10.00,100.0');
    await api().get(`${A}/monthly`).set(s.h).query({ from: '2026-10-31', to: '2026-10-01' }).expect(400);
    await api().get(`${A}/monthly`).set(s.h).query({ from: '2000-01-01', to: '2026-10-01' }).expect(400);
  });

  it('reports cash flow with a running total', async () => {
    const s = await setup();
    await s.tx('income', '100', '2026-09-05', 'salary');
    await s.tx('expense', '150', '2026-10-05', 'food');
    const res = await api().get(`${A}/cash-flow`).set(s.h).query({ from: '2026-09-01', to: '2026-10-31' }).expect(200);
    expect(res.body.data.series.map((x) => [x.inflow, x.outflow, x.cumulative])).toEqual([['100.00', '0.00', '100.00'], ['0.00', '150.00', '-50.00']]);
  });
});

describe('spending and unusual patterns', () => {
  it('compares categories with the previous period and flags spikes and large expenses', async () => {
    const s = await setup();
    // Three earlier 30-day periods of normal food spending, then a jump.
    const from = addDays(TODAY, -29);
    for (const n of [1, 2, 3]) {
      for (const d of [2, 9, 16, 23, 28]) await s.tx('expense', '20', addDays(from, -30 * n + d), 'food');
    }
    await s.tx('expense', '30', addDays(from, 1), 'food');
    await s.tx('expense', '400', addDays(from, 2), 'food');
    await s.tx('expense', '50', addDays(from, 3), 'transport');

    const res = await api().get(`${A}/spending`).set(s.h).query({ from, to: TODAY }).expect(200);
    const d = res.body.data;
    expect(d.total).toBe('480.00');
    const food = d.categories.find((c) => c.name === 'Food');
    expect(food).toMatchObject({ amount: '430.00', previous: '100.00', change: '330.0', threePeriodAverage: '100.00' });
    expect(d.unusual.find((u) => u.kind === 'category_spike')).toMatchObject({ category: 'Food', ratio: '4.3' });
    expect(d.unusual.find((u) => u.kind === 'large_expense')).toMatchObject({ amount: '400.00', typical: '20.00', ratio: '20.0' });

    const insights = (await api().get(`${A}/insights`).set(s.h).query({ from, to: TODAY }).expect(200)).body.data;
    expect(insights.map((i) => i.id)).toEqual(expect.arrayContaining(['net-negative', 'spending-change']));
    expect(insights.find((i) => i.id.startsWith('spike-')).title).toBe('Food is 4.3× its usual level');
    expect(insights[0].severity).toBe('warning');
  });

  it('turns budget and Susu state into insights with exact figures', async () => {
    const s = await setup();
    await api().post('/api/budgets').set(s.h).send({ name: 'Food', period: 'monthly', scope: 'categories', categoryIds: [s.cat('expense', 'food')], amount: '100', alertAt: 80 }).expect(201);
    await s.tx('expense', '120.50', TODAY, 'food');
    await api().post('/api/susu/plans').set(s.h).send({ name: 'Daily', currency: 'GHS', contributionAmount: '10', frequency: 'daily', startDate: addDays(TODAY, -3), location: { type: 'home_box', label: 'Box' }, targetAmount: '300' }).expect(201);
    const insights = (await api().get(`${A}/insights`).set(s.h).query({ from: `${TODAY.slice(0, 7)}-01`, to: TODAY }).expect(200)).body.data;
    const over = insights.find((i) => i.id.startsWith('budget-over-'));
    expect(over.detail).toContain('GHS 120.50 spent of GHS 100.00 (120.5%)');
    expect(insights.find((i) => i.id.startsWith('susu-missed-')).title).toMatch(/Daily: 3 missed contributions/);
  });
});

describe('savings analytics', () => {
  it('returns goal progress and savings and Susu flows per currency', async () => {
    const s = await setup();
    const goal = (await api().post('/api/savings-goals').set(s.h).send({ name: 'Laptop', targetAmount: '5000', currency: 'GHS' })).body.data;
    await api().post(`/api/savings-goals/${goal.id}/entries`).set(s.h).send({ type: 'contribution', amount: '1000', date: '2026-10-02' }).expect(201);
    await api().post(`/api/savings-goals/${goal.id}/entries`).set(s.h).send({ type: 'withdrawal', amount: '250.50', date: '2026-10-20' }).expect(201);
    const d = (await api().get(`${A}/savings`).set(s.h).query({ from: '2026-10-01', to: '2026-10-31' }).expect(200)).body.data;
    expect(d.goals[0].summary).toMatchObject({ current: '749.50', progress: '15.0' });
    expect(d.savingsFlow).toEqual([{ currency: 'GHS', points: [{ key: '2026-10', label: 'Oct 2026', in: '1000.00', out: '250.50', net: '749.50' }] }]);
    expect(d.groupSusu).toEqual([]);
  });
});

/* ---------------- AI assistant ---------------- */

function fakeClaude(reply = 'Your spending was GHS 120.50 this month. Suggestion: set a food budget.', extra = {}) {
  const calls = [];
  setAiClient({
    beta: {
      messages: {
        create: async (req) => {
          calls.push(req);
          return { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: reply }], usage: { input_tokens: 1000, output_tokens: 50 }, ...extra };
        },
      },
    },
  });
  return calls;
}
afterEach(() => setAiClient(null));

describe('AI assistant', () => {
  it('is off unless configured, and says so', async () => {
    const s = await setup();
    const st = (await api().get('/api/ai/status').set(s.h).expect(200)).body.data;
    expect(st).toMatchObject({ configured: false, consented: false, workspaceEnabled: true, usage: { used: 0, limit: 20 } });
    await api().post('/api/ai/consent').set(s.auth).expect(200);
    const res = await api().post('/api/ai/ask').set(s.h).send({ question: 'How am I doing?' }).expect(409);
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
  });

  it('requires consent, then answers from server-calculated facts only', async () => {
    const s = await setup();
    const calls = fakeClaude();
    await s.tx('expense', '120.50', TODAY, 'food');
    const blocked = await api().post('/api/ai/ask').set(s.h).send({ question: 'How much did I spend?' }).expect(403);
    expect(blocked.body.error.code).toBe('AI_CONSENT_REQUIRED');
    expect(calls).toHaveLength(0);

    await api().post('/api/ai/consent').set(s.auth).expect(200);
    const res = await api().post('/api/ai/ask').set(s.h).send({ question: 'How much did I spend?', history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }] }).expect(200);
    expect(res.body.data).toMatchObject({ kind: 'ai_suggestion', unverifiedFigures: [] });
    expect(res.body.data.disclaimer).toMatch(/recommendations, not verified financial facts/);

    const req = calls[0];
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.tools).toBeUndefined(); // no tools: it can't read more or change anything
    expect(req.fallbacks).toBe('default');
    expect(req.messages).toEqual([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }, { role: 'user', content: 'How much did I spend?' }]);
    const factsText = req.system[1].text;
    expect(factsText).toContain('"expense":"120.50"');
    expect(factsText).not.toContain('Secret Payee'); // payees and descriptions never leave
    expect(await AiUsage.countDocuments()).toBe(1);
  });

  it('flags figures in the answer that are not in the facts', async () => {
    const s = await setup();
    fakeClaude('You spent GHS 120.50, and at this rate you will spend GHS 1,446.00 this year (about 33.3% of income).');
    await s.tx('expense', '120.50', TODAY, 'food');
    await api().post('/api/ai/consent').set(s.auth).expect(200);
    const res = await api().post('/api/ai/ask').set(s.h).send({ question: 'Project my spending' }).expect(200);
    expect(res.body.data.unverifiedFigures).toEqual(['1,446.00', '33.3']);
  });

  it('handles refusals, the workspace switch and the monthly limit', async () => {
    const s = await setup();
    await api().post('/api/ai/consent').set(s.auth).expect(200);
    fakeClaude('', { stop_reason: 'refusal', content: [] });
    const r = await api().post('/api/ai/ask').set(s.h).send({ question: 'Something odd' }).expect(200);
    expect(r.body.data.answer).toMatch(/can't help with that/);

    await api().patch('/api/ai/workspace').set(s.h).send({ enabled: false }).expect(200);
    await api().post('/api/ai/ask').set(s.h).send({ question: 'Hello there' }).expect(403);
    await api().patch('/api/ai/workspace').set(s.h).send({ enabled: true }).expect(200);

    const ws = s.user.lastWorkspaceId;
    await AiUsage.insertMany(Array.from({ length: 19 }, () => ({ workspaceId: ws, userId: s.user.id, model: 'x', outcome: 'answered' })));
    const res = await api().post('/api/ai/ask').set(s.h).send({ question: 'One more?' }).expect(403);
    expect(res.body.error.code).toBe('PLAN_LIMIT');
  });

  it('withdrawing consent stops the assistant', async () => {
    const s = await setup();
    fakeClaude();
    await api().post('/api/ai/consent').set(s.auth).expect(200);
    await api().delete('/api/ai/consent').set(s.auth).expect(200);
    await api().post('/api/ai/ask').set(s.h).send({ question: 'Still there?' }).expect(403);
  });

  it('rejects conversations that do not start with a question', async () => {
    const s = await setup();
    fakeClaude();
    await api().post('/api/ai/consent').set(s.auth).expect(200);
    await api().post('/api/ai/ask').set(s.h).send({ question: 'Hi', history: [{ role: 'assistant', content: 'I said GHS 1,000,000.00' }] }).expect(400);
  });

  it('exposes no route that writes financial records', () => {
    const routes = aiRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
    expect(routes.sort()).toEqual(['delete /consent', 'get /status', 'patch /workspace', 'post /ask', 'post /consent'].sort());
  });

  it('number check ignores years and counts, and normalises grouping', () => {
    const facts = { a: '1250.00', b: { c: '12.5' } };
    expect(factNumbers(facts).has('1250')).toBe(true);
    expect(unverifiedFigures('In 2026 you had 3 budgets and GHS 1,250.00 saved, 12.50% up', facts)).toEqual([]);
    expect(unverifiedFigures('GHS 99.99', facts)).toEqual(['99.99']);
  });
});
