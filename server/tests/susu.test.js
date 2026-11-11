import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSchedule } from '../modules/susu/schedule.js';
import { susuRouter } from '../modules/susu/susu.routes.js';
import { Transaction } from '../modules/transactions/transaction.model.js';
import { addDays, todayIn } from '../utils/periods.js';
import { api, registerUser } from './helpers.js';

const TODAY = todayIn('Africa/Accra');

afterAll(async () => {
  await fs.rm(path.resolve('tests/.uploads'), { recursive: true, force: true });
});

const plan = (over = {}) => ({
  startDate: '2026-11-02',
  targetDate: null,
  frequency: 'weekly',
  intervalDays: null,
  currency: 'GHS',
  contributionAmounts: [{ amount: '50', effectiveFrom: '2026-11-02' }],
  pauses: [],
  endedOn: null,
  ...over,
});

describe('schedule calculator', () => {
  it('classifies each weekly period as met, partial, missed or open', () => {
    const { windows, stats } = buildSchedule(
      plan(),
      [
        { date: '2026-11-02', amount: '50' }, // week 1: met
        { date: '2026-11-10', amount: '20' }, // week 2: partial
        // week 3 (16th): nothing, missed
        { date: '2026-11-25', amount: '30' }, // week 4 so far
      ],
      '2026-11-26',
    );
    expect(windows.map((w) => [w.due, w.status, w.contributed])).toEqual([
      ['2026-11-02', 'met', '50.00'],
      ['2026-11-09', 'partial', '20.00'],
      ['2026-11-16', 'missed', '0.00'],
      ['2026-11-23', 'open', '30.00'],
    ]);
    // Expected so far: 3 closed weeks x 50 = 150; paid in them: 70.
    expect(stats).toMatchObject({ met: 1, partial: 1, missed: 1, open: 1, expectedToDate: '150.00', arrears: '80.00', streak: 0, nextDue: '2026-11-30' });
  });

  it('lets extra payments cover a short period in the arrears total', () => {
    const { stats } = buildSchedule(plan(), [{ date: '2026-11-02', amount: '100' }], '2026-11-16');
    expect(stats).toMatchObject({ met: 1, missed: 1, arrears: '0.00' });
  });

  it('does not count paused periods as missed', () => {
    const { windows, stats } = buildSchedule(plan({ pauses: [{ from: '2026-11-08', to: '2026-11-20' }] }), [{ date: '2026-11-02', amount: '50' }], '2026-11-24');
    expect(windows.map((w) => w.status)).toEqual(['met', 'paused', 'paused', 'open']);
    expect(stats).toMatchObject({ missed: 0, arrears: '0.00', streak: 1 });
  });

  it('handles daily, custom and monthly schedules, and planned amount changes', () => {
    const daily = buildSchedule(plan({ frequency: 'daily', contributionAmounts: [{ amount: '5', effectiveFrom: '2026-11-02' }] }), [{ date: '2026-11-03', amount: '5' }], '2026-11-05');
    expect(daily.windows.map((w) => w.status)).toEqual(['missed', 'met', 'missed', 'open']);

    const custom = buildSchedule(plan({ frequency: 'custom', intervalDays: 3 }), [], '2026-11-08');
    expect(custom.windows.map((w) => w.due)).toEqual(['2026-11-02', '2026-11-05', '2026-11-08']);

    const monthly = buildSchedule(
      plan({ startDate: '2026-01-31', frequency: 'monthly', contributionAmounts: [{ amount: '100', effectiveFrom: '2026-01-31' }, { amount: '150', effectiveFrom: '2026-03-01' }] }),
      [],
      '2026-04-05',
    );
    expect(monthly.windows.map((w) => [w.due, w.expected])).toEqual([
      ['2026-01-31', '100.00'],
      ['2026-02-28', '100.00'],
      ['2026-03-31', '150.00'],
    ]);
  });

  it('stops at the target date or the day the plan ended', () => {
    expect(buildSchedule(plan({ targetDate: '2026-11-12' }), [], '2026-12-31').windows).toHaveLength(2);
    expect(buildSchedule(plan({ endedOn: '2026-11-03' }), [], '2026-12-31').stats.nextDue).toBeNull();
  });
});

async function setup() {
  const u = await registerUser();
  const h = { ...u.auth, 'X-Workspace-Id': u.user.lastWorkspaceId };
  const create = (body = {}) =>
    api()
      .post('/api/susu/plans')
      .set(h)
      .send({ name: 'Market susu', currency: 'GHS', contributionAmount: '20', frequency: 'daily', startDate: addDays(TODAY, -4), location: { type: 'collector', label: 'Auntie Akos' }, targetAmount: '600', ...body });
  return { ...u, h, create };
}

describe('personal susu plans', () => {
  it('tracks contributions and withdrawals as records only, with missed days', async () => {
    const s = await setup();
    const p = (await s.create().expect(201)).body.data;
    expect(p).toMatchObject({ contributionAmount: '20.00', location: { type: 'collector', label: 'Auntie Akos' }, status: 'active' });

    // Days -4, -3 paid; -2, -1 missed; today open.
    for (const d of [-4, -3]) await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).send({ amount: '20', date: addDays(TODAY, d) }).expect(201);
    const res = await api().post(`/api/susu/plans/${p.id}/withdrawals`).set(s.h).send({ amount: '15.50', date: TODAY, reason: 'School lunch' }).expect(201);
    expect(res.body.data.plan.summary).toMatchObject({ contributed: '40.00', withdrawn: '15.50', current: '24.50', remaining: '575.50', progress: '4.1' });
    expect(res.body.data.plan.summary.schedule).toMatchObject({ met: 2, missed: 2, open: 1, arrears: '40.00' });

    // No transactions were created and no account or report moved.
    expect(await Transaction.countDocuments({ workspaceId: s.user.lastWorkspaceId })).toBe(0);
    const sum = (await api().get('/api/transactions/summary').set(s.h)).body.data;
    expect(sum).toMatchObject({ income: '0.00', expense: '0.00' });
  });

  it('won’t withdraw more than is recorded, and cancels entries with a reason', async () => {
    const s = await setup();
    const p = (await s.create()).body.data;
    const c = (await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).send({ amount: '20', date: TODAY })).body.data.entry;
    await api().post(`/api/susu/plans/${p.id}/withdrawals`).set(s.h).send({ amount: '20.01', date: TODAY, reason: 'x' }).expect(422);
    await api().post(`/api/susu/plans/${p.id}/withdrawals`).set(s.h).send({ amount: '5', date: TODAY }).expect(422); // reason required
    const w = (await api().post(`/api/susu/plans/${p.id}/withdrawals`).set(s.h).send({ amount: '5', date: TODAY, reason: 'Transport' })).body.data.entry;

    await api().post(`/api/susu/plans/${p.id}/contributions/${c.id}/cancel`).set(s.h).send({ reason: 'Wrong day' }).expect(409);
    await api().post(`/api/susu/plans/${p.id}/withdrawals/${w.id}/cancel`).set(s.h).send({}).expect(422);
    const r = await api().post(`/api/susu/plans/${p.id}/withdrawals/${w.id}/cancel`).set(s.h).send({ reason: 'Recorded by mistake' }).expect(200);
    expect(r.body.data.plan.summary.current).toBe('20.00');
    const list = (await api().get(`/api/susu/plans/${p.id}/withdrawals`).set(s.h)).body.data;
    expect(list[0]).toMatchObject({ status: 'cancelled', cancelReason: 'Recorded by mistake', reason: 'Transport' });
  });

  it('rejects future, pre-start and over-precise entries', async () => {
    const s = await setup();
    const p = (await s.create()).body.data;
    await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).send({ amount: '20', date: addDays(TODAY, 1) }).expect(422);
    await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).send({ amount: '20', date: addDays(TODAY, -5) }).expect(422);
    await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).send({ amount: '20.005', date: TODAY }).expect(422);
    await s.create({ frequency: 'custom' }).expect(422); // interval required
  });

  it('pausing keeps paused days out of the missed count; resuming counts again', async () => {
    const s = await setup();
    const p = (await s.create({ startDate: TODAY })).body.data;
    const paused = await api().patch(`/api/susu/plans/${p.id}`).set(s.h).send({ status: 'paused' }).expect(200);
    expect(paused.body.data.summary.schedule).toMatchObject({ paused: 1, missed: 0 });
    const resumed = await api().patch(`/api/susu/plans/${p.id}`).set(s.h).send({ status: 'active' }).expect(200);
    expect(resumed.body.data.status).toBe('active');
    expect(resumed.body.data.summary.schedule.paused).toBe(0);
  });

  it('locks the schedule once contributions exist; amount changes apply from today', async () => {
    const s = await setup();
    const p = (await s.create()).body.data;
    await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).send({ amount: '20', date: addDays(TODAY, -4) });
    await api().patch(`/api/susu/plans/${p.id}`).set(s.h).send({ frequency: 'weekly' }).expect(409);
    const upd = await api().patch(`/api/susu/plans/${p.id}`).set(s.h).send({ contributionAmount: '25' }).expect(200);
    expect(upd.body.data.contributionHistory).toEqual([
      { amount: '20.00', effectiveFrom: addDays(TODAY, -4) },
      { amount: '25.00', effectiveFrom: TODAY },
    ]);
    const sched = (await api().get(`/api/susu/plans/${p.id}/schedule`).set(s.h)).body.data;
    expect(sched.windows[0]).toMatchObject({ due: TODAY, expected: '25.00' });
    expect(sched.windows.at(-1)).toMatchObject({ due: addDays(TODAY, -4), expected: '20.00', status: 'met' });
  });

  it('completed plans take withdrawals but not contributions; cancelled plans are read-only', async () => {
    const s = await setup();
    const p = (await s.create()).body.data;
    await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).send({ amount: '60', date: TODAY });
    await api().patch(`/api/susu/plans/${p.id}`).set(s.h).send({ status: 'completed' }).expect(200);
    await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).send({ amount: '1', date: TODAY }).expect(400);
    await api().post(`/api/susu/plans/${p.id}/withdrawals`).set(s.h).send({ amount: '60', date: TODAY, reason: 'Collected at the end' }).expect(201);

    const q = (await s.create({ name: 'Other' })).body.data;
    await api().patch(`/api/susu/plans/${q.id}`).set(s.h).send({ status: 'cancelled' }).expect(422);
    await api().patch(`/api/susu/plans/${q.id}`).set(s.h).send({ status: 'cancelled', cancelReason: 'Collector stopped' }).expect(200);
    await api().post(`/api/susu/plans/${q.id}/contributions`).set(s.h).send({ amount: '1', date: TODAY }).expect(400);
    await api().patch(`/api/susu/plans/${q.id}`).set(s.h).send({ name: 'x' }).expect(400);
  });

  it('gives monthly summaries and a workspace overview per currency', async () => {
    const s = await setup();
    const p = (await s.create()).body.data;
    await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).send({ amount: '20', date: TODAY });
    await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).send({ amount: '20', date: TODAY });
    await api().post(`/api/susu/plans/${p.id}/withdrawals`).set(s.h).send({ amount: '10', date: TODAY, reason: 'Fuel' });
    const usd = (await s.create({ name: 'Dollar box', currency: 'USD', location: { type: 'home_box' }, contributionAmount: '5', startDate: TODAY })).body.data;
    await api().post(`/api/susu/plans/${usd.id}/contributions`).set(s.h).send({ amount: '5', date: TODAY });

    const monthly = (await api().get(`/api/susu/plans/${p.id}/monthly`).set(s.h)).body.data;
    expect(monthly[0]).toEqual({ month: TODAY.slice(0, 7), contributed: '40.00', withdrawn: '10.00', net: '30.00', contributions: 2, withdrawals: 1 });

    const summary = (await api().get('/api/susu/summary').set(s.h)).body.data;
    expect(summary.totals).toEqual(expect.arrayContaining([expect.objectContaining({ currency: 'GHS', current: '30.00', plans: 1 }), expect.objectContaining({ currency: 'USD', current: '5.00' })]));
    const dash = (await api().get(`/api/analytics/dashboard?from=${TODAY}&to=${TODAY}`).set(s.h)).body.data;
    expect(dash.susu).toHaveLength(2);
    expect(dash.summary).toMatchObject({ income: '0.00', expense: '0.00' });
  });

  it('attaches one proof file per contribution, checked by content', async () => {
    const s = await setup();
    const p = (await s.create()).body.data;
    const c = (await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).send({ amount: '20', date: TODAY })).body.data.entry;
    await api().post(`/api/susu/plans/${p.id}/contributions/${c.id}/attachment`).set(s.h).attach('file', Buffer.from('not an image'), 'card.jpg').expect(415);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
    const up = await api().post(`/api/susu/plans/${p.id}/contributions/${c.id}/attachment`).set(s.h).attach('file', jpeg, 'collector-card.jpg').expect(201);
    expect(up.body.data.attachment).toMatchObject({ name: 'collector-card.jpg', mimeType: 'image/jpeg' });
    const dl = await api().get(`/api/susu/plans/${p.id}/contributions/${c.id}/attachment`).set(s.h).expect(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('keeps plans private to their workspace and read-only for viewers', async () => {
    const a = await setup();
    const b = await setup();
    const bp = (await b.create()).body.data;
    await api().get(`/api/susu/plans/${bp.id}`).set(a.h).expect(404);
    await api().post(`/api/susu/plans/${bp.id}/contributions`).set(a.h).send({ amount: '20', date: TODAY }).expect(404);
    expect((await api().get('/api/susu/plans').set(a.h)).body.data).toHaveLength(0);
  });

  it('audits every change', async () => {
    const s = await setup();
    const p = (await s.create()).body.data;
    const c = (await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).send({ amount: '20', date: TODAY })).body.data.entry;
    await api().post(`/api/susu/plans/${p.id}/contributions/${c.id}/cancel`).set(s.h).send({ reason: 'Duplicate' });
    await api().patch(`/api/susu/plans/${p.id}`).set(s.h).send({ status: 'paused' });
    const audit = (await api().get(`/api/workspaces/${s.user.lastWorkspaceId}/audit`).set(s.auth)).body.data.map((e) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['susu_plan.created', 'susu_plan.contribution_recorded', 'susu_plan.contribution_cancelled', 'susu_plan.paused']));
  });
});

describe('susu business-rule guardrail', () => {
  it('exposes no payment, payout, transfer, checkout or wallet routes', () => {
    const paths = susuRouter.stack.filter((l) => l.route).map((l) => l.route.path);
    expect(paths.length).toBeGreaterThan(5);
    for (const p of paths) expect(p).not.toMatch(/pay|payout|transfer|checkout|wallet|disburse|collect|settle/i);
  });
});

describe('offline replays', () => {
  it('records a personal Susu contribution once per Idempotency-Key, even when replayed', async () => {
    const s = await setup();
    const p = (await s.create().expect(201)).body.data;
    const send = () => api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).set('Idempotency-Key', 'offline-draft-0002').send({ amount: '20', date: TODAY });
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.body.data.entry.id).toBe(b.body.data.entry.id);
    const again = await send().expect(201);
    expect(again.body.data.entry.id).toBe(a.body.data.entry.id);
    expect((await api().get(`/api/susu/plans/${p.id}/contributions`).set(s.h)).body.data).toHaveLength(1);
    await api().post(`/api/susu/plans/${p.id}/contributions`).set(s.h).set('Idempotency-Key', 'bad key!').send({ amount: '20', date: TODAY }).expect(400);
  });
});
