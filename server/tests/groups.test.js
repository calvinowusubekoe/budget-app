import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupsRouter } from '../modules/susu/groups.routes.js';
import { SusuActivityLog } from '../modules/susu/group.models.js';
import { Transaction } from '../modules/transactions/transaction.model.js';
import { addDays, todayIn } from '../utils/periods.js';
import { api, registerUser, tokenFromEmail } from './helpers.js';

const TODAY = todayIn('Africa/Accra');
const G = '/api/susu/groups';

/** Organiser + two registered members (Kofi, Esi) + one name-only member (Mama Ama). */
async function setup(over = {}) {
  const org = await registerUser({ name: 'Abena Organiser' });
  const kofi = await registerUser({ name: 'Kofi Mensah' });
  const esi = await registerUser({ name: 'Esi Boateng' });
  const g = (
    await api()
      .post(G)
      .set(org.auth)
      .send({ name: 'Makola Traders Susu', currency: 'GHS', contributionAmount: '100', frequency: 'weekly', startDate: addDays(TODAY, -14), ...over })
      .expect(201)
  ).body.data;
  const invite = async (u, name) => {
    await api().post(`${G}/${g.id}/invitations`).set(org.auth).send({ email: u.email, displayName: name }).expect(201);
    await api().post(`/api/susu/invitations/${tokenFromEmail(u.email, '/susu/invitations/accept')}/accept`).set(u.auth).expect(200);
  };
  await invite(kofi, 'Kofi');
  await invite(esi, 'Esi');
  const mama = (await api().post(`${G}/${g.id}/members`).set(org.auth).send({ displayName: 'Mama Ama', phone: '+233 24 000 0000' }).expect(201)).body.data;
  const members = (await api().get(`${G}/${g.id}/members`).set(org.auth)).body.data;
  const id = (name) => members.find((m) => m.displayName.startsWith(name)).id;
  return { org, kofi, esi, g, mama, id };
}

const generate = (s) => api().post(`${G}/${s.g.id}/cycles`).set(s.org.auth).send({ generate: true });
const contribute = (s, cycleId, memberId, amount, auth = s.org.auth, date = TODAY) => api().post(`${G}/${s.g.id}/cycles/${cycleId}/contributions`).set(auth).send({ memberId, amount, date });

describe('groups and membership', () => {
  it('makes the creator the organiser and lists the group for each member', async () => {
    const s = await setup();
    expect(s.g.me).toMatchObject({ role: 'organizer', status: 'active' });
    expect(s.g.me.capabilities).toContain('cancelConfirmed');
    const kofiGroups = (await api().get(G).set(s.kofi.auth)).body.data;
    expect(kofiGroups[0]).toMatchObject({ name: 'Makola Traders Susu', memberCount: 4, me: { role: 'member' } });
    expect(kofiGroups[0].me.capabilities).toEqual([]);
  });

  it('hides groups from non-members (404) and contacts from ordinary members', async () => {
    const s = await setup();
    const outsider = await registerUser();
    await api().get(`${G}/${s.g.id}`).set(outsider.auth).expect(404);
    await api().get(`${G}/${s.g.id}/reports`).set(outsider.auth).expect(404);
    const asMember = (await api().get(`${G}/${s.g.id}/members`).set(s.kofi.auth)).body.data;
    expect(asMember.every((m) => m.contact === undefined)).toBe(true);
    const asOrg = (await api().get(`${G}/${s.g.id}/members`).set(s.org.auth)).body.data;
    expect(asOrg.find((m) => m.displayName === 'Mama Ama').contact.phone).toBe('+233 24 000 0000');
  });

  it('only accepts an invitation from the invited email, once', async () => {
    const org = await registerUser();
    const invitee = await registerUser();
    const other = await registerUser();
    const g = (await api().post(G).set(org.auth).send({ name: 'x', currency: 'GHS', contributionAmount: '10', frequency: 'daily', startDate: TODAY })).body.data;
    await api().post(`${G}/${g.id}/invitations`).set(org.auth).send({ email: invitee.email, displayName: 'Yaw' });
    const token = tokenFromEmail(invitee.email, '/susu/invitations/accept');
    const preview = (await api().get(`/api/susu/invitations/${token}`).set(invitee.auth).expect(200)).body.data;
    expect(preview).toMatchObject({ groupName: 'x', contributionAmount: '10.00' });
    await api().post(`/api/susu/invitations/${token}/accept`).set(other.auth).expect(403);
    await api().post(`/api/susu/invitations/${token}/accept`).set(invitee.auth).expect(200);
    await api().post(`/api/susu/invitations/${token}/accept`).set(invitee.auth).expect(400);
  });

  it('links a name-only member to an account through an invitation', async () => {
    const s = await setup();
    const ama = await registerUser({ name: 'Ama' });
    await api().post(`${G}/${s.g.id}/invitations`).set(s.org.auth).send({ email: ama.email, memberId: s.mama.id }).expect(201);
    await api().post(`/api/susu/invitations/${tokenFromEmail(ama.email, '/susu/invitations/accept')}/accept`).set(ama.auth).expect(200);
    const members = (await api().get(`${G}/${s.g.id}/members`).set(s.org.auth)).body.data;
    expect(members.find((m) => m.id === s.mama.id)).toMatchObject({ registered: true, status: 'active' });
  });

  it('enforces roles: members can’t manage; assistants only what they’re allowed', async () => {
    const s = await setup();
    await api().post(`${G}/${s.g.id}/members`).set(s.kofi.auth).send({ displayName: 'x' }).expect(403);
    await api().patch(`${G}/${s.g.id}/members/${s.id('Kofi')}`).set(s.org.auth).send({ role: 'assistant' }).expect(200);
    // Default assistant permissions: may record contributions, not manage members or cycles.
    await api().post(`${G}/${s.g.id}/members`).set(s.kofi.auth).send({ displayName: 'x' }).expect(403);
    await generate({ ...s, org: s.kofi }).expect(403);
    await generate(s).expect(201);
    const cycle = (await api().get(`${G}/${s.g.id}/cycles`).set(s.org.auth)).body.data[0];
    await contribute(s, cycle.id, s.id('Esi'), '100', s.kofi.auth).expect(201);
    await contribute(s, cycle.id, s.id('Esi'), '100', s.esi.auth).expect(403);
    // Only organisers change roles or settings.
    await api().patch(`${G}/${s.g.id}/members/${s.id('Esi')}`).set(s.kofi.auth).send({ role: 'assistant' }).expect(403);
    await api().patch(`${G}/${s.g.id}`).set(s.kofi.auth).send({ name: 'Mine' }).expect(403);
  });

  it('protects the last organiser and keeps members with records', async () => {
    const s = await setup();
    const orgId = s.g.me.memberId;
    await api().patch(`${G}/${s.g.id}/members/${orgId}`).set(s.org.auth).send({ role: 'member' }).expect(409);
    await generate(s);
    await api().patch(`${G}/${s.g.id}/members/${s.id('Kofi')}`).set(s.org.auth).send({ status: 'removed' }).expect(409);
    await api().patch(`${G}/${s.g.id}/members/${s.id('Kofi')}`).set(s.org.auth).send({ status: 'suspended' }).expect(200);
    // Suspended members can view but not act.
    await api().get(`${G}/${s.g.id}`).set(s.kofi.auth).expect(200);
  });
});

describe('cycles and rotation', () => {
  it('generates one cycle per active member with dates, recipients and an expected-pool estimate', async () => {
    const s = await setup();
    const cycles = (await generate(s).expect(201)).body.data;
    expect(cycles.map((c) => [c.number, c.dueDate, c.recipient.displayName])).toEqual([
      [1, addDays(TODAY, -14), 'Abena Organiser'],
      [2, addDays(TODAY, -7), 'Kofi'],
      [3, TODAY, 'Esi'],
      [4, addDays(TODAY, 7), 'Mama Ama'],
    ]);
    expect(cycles[0]).toMatchObject({ contributorCount: 4, expectedPerMember: '100.00', expectedPool: '400.00' });
    await generate(s).expect(400); // everyone already has a turn
  });

  it('draws and logs a random order once', async () => {
    const s = await setup({ rotationMethod: 'random' });
    const cycles = (await generate(s)).body.data;
    expect(new Set(cycles.map((c) => c.recipient.id)).size).toBe(4);
    const log = await SusuActivityLog.findOne({ groupId: s.g.id, action: 'rotation.randomised' }).lean();
    expect(log.metadata.order).toEqual(cycles.map((c) => c.recipient.displayName));
  });

  it('changes a cycle only with a reason, and not after a payout is recorded', async () => {
    const s = await setup();
    const [c1] = (await generate(s)).body.data;
    await api().patch(`${G}/${s.g.id}/cycles/${c1.id}`).set(s.org.auth).send({ recipientMemberId: s.id('Esi') }).expect(422);
    await api().patch(`${G}/${s.g.id}/cycles/${c1.id}`).set(s.org.auth).send({ recipientMemberId: s.id('Esi'), reason: 'Swapped turns at the meeting' }).expect(200);
    await api().post(`${G}/${s.g.id}/cycles/${c1.id}/payouts`).set(s.org.auth).send({ actualAmount: '400', payoutDate: TODAY }).expect(201);
    await api().patch(`${G}/${s.g.id}/cycles/${c1.id}`).set(s.org.auth).send({ recipientMemberId: s.id('Kofi'), reason: 'again' }).expect(409);
  });

  it('locks the schedule once cycles exist', async () => {
    const s = await setup();
    await generate(s);
    await api().patch(`${G}/${s.g.id}`).set(s.org.auth).send({ frequency: 'daily' }).expect(409);
    await api().patch(`${G}/${s.g.id}`).set(s.org.auth).send({ contributionAmount: '120' }).expect(200);
    const cycles = (await api().get(`${G}/${s.g.id}/cycles`).set(s.org.auth)).body.data;
    expect(cycles[0].expectedPerMember).toBe('100.00'); // existing cycles keep their snapshot
  });
});

describe('contribution records', () => {
  it('a member confirms or disputes their own record; nobody else can', async () => {
    const s = await setup();
    const [c1] = (await generate(s)).body.data;
    const r = (await contribute(s, c1.id, s.id('Kofi'), '100').expect(201)).body.data;
    expect(r).toMatchObject({ status: 'recorded', member: { displayName: 'Kofi' } });

    // Kofi was asked to confirm.
    const n = (await api().get('/api/notifications').set(s.kofi.auth)).body.data;
    expect(n[0]).toMatchObject({ type: 'susu_confirm_request' });

    await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.esi.auth).send({ action: 'confirm' }).expect(403);
    await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.org.auth).send({ action: 'confirm' }).expect(403);
    const ok = await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.kofi.auth).send({ action: 'confirm' }).expect(200);
    expect(ok.body.data.status).toBe('confirmed');

    // Confirmed records are locked.
    await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.org.auth).send({ amount: '90', reason: 'typo' }).expect(409);
  });

  it('dispute, correction and re-confirmation keep a full history; organisers are told', async () => {
    const s = await setup();
    const [c1] = (await generate(s)).body.data;
    const r = (await contribute(s, c1.id, s.id('Esi'), '80')).body.data;
    await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.esi.auth).send({ action: 'dispute' }).expect(422);
    await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.esi.auth).send({ action: 'dispute', reason: 'I paid 100 in cash' }).expect(200);
    expect((await api().get('/api/notifications').set(s.org.auth)).body.data[0]).toMatchObject({ type: 'susu_disputed', body: 'I paid 100 in cash' });

    const corrected = await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.org.auth).send({ amount: '100', reason: 'Checked the notebook' }).expect(200);
    expect(corrected.body.data).toMatchObject({ status: 'recorded', amount: '100.00' });
    const done = await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.esi.auth).send({ action: 'confirm' }).expect(200);
    expect(done.body.data.events.map((e) => e.type)).toEqual(['recorded', 'disputed', 'corrected', 'confirmed']);
    expect(done.body.data.events[2].changes.amount).toEqual({ from: '80.00', to: '100.00' });
  });

  it('cancelling needs a reason, and a confirmed record needs an organiser', async () => {
    const s = await setup();
    await api().patch(`${G}/${s.g.id}/members/${s.id('Kofi')}`).set(s.org.auth).send({ role: 'assistant' });
    const [c1] = (await generate(s)).body.data;
    const r = (await contribute(s, c1.id, s.id('Esi'), '100')).body.data;
    await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.esi.auth).send({ action: 'confirm' });
    await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.kofi.auth).send({ action: 'cancel', reason: 'Wrong week' }).expect(403);
    await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.org.auth).send({ action: 'cancel' }).expect(422);
    await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.org.auth).send({ action: 'cancel', reason: 'Recorded in the wrong cycle' }).expect(200);
    await api().patch(`${G}/${s.g.id}/contributions/${r.id}`).set(s.esi.auth).send({ action: 'confirm' }).expect(400);
  });

  it('rejects records for members not expected in the cycle, future dates and bad precision', async () => {
    const s = await setup();
    const [c1] = (await generate(s)).body.data;
    const late = await registerUser();
    await api().post(`${G}/${s.g.id}/invitations`).set(s.org.auth).send({ email: late.email, displayName: 'Late joiner' });
    await api().post(`/api/susu/invitations/${tokenFromEmail(late.email, '/susu/invitations/accept')}/accept`).set(late.auth);
    const lateId = (await api().get(`${G}/${s.g.id}/members`).set(s.org.auth)).body.data.find((m) => m.displayName === 'Late joiner').id;
    await contribute(s, c1.id, lateId, '100').expect(422);
    await contribute(s, c1.id, s.id('Kofi'), '100', s.org.auth, addDays(TODAY, 1)).expect(422);
    await contribute(s, c1.id, s.id('Kofi'), '100.001').expect(422);
  });

  it('members see only their own contributions', async () => {
    const s = await setup();
    const [c1] = (await generate(s)).body.data;
    await contribute(s, c1.id, s.id('Kofi'), '100');
    await contribute(s, c1.id, s.id('Esi'), '100');
    const kofiView = (await api().get(`${G}/${s.g.id}/contributions`).set(s.kofi.auth)).body.data;
    expect(kofiView.map((c) => c.member.displayName)).toEqual(['Kofi']);
    expect((await api().get(`${G}/${s.g.id}/contributions`).set(s.org.auth)).body.data).toHaveLength(2);
  });
});

describe('self-recorded records', () => {
  it('whoever entered a record about themselves can’t confirm it', async () => {
    const s = await setup();
    const [c1] = (await generate(s)).body.data; // the organiser collects in cycle 1
    const own = (await contribute(s, c1.id, s.g.me.memberId, '100')).body.data;
    expect(own).toMatchObject({ canRespond: false, selfRecorded: true });
    await api().patch(`${G}/${s.g.id}/contributions/${own.id}`).set(s.org.auth).send({ action: 'confirm' }).expect(403);
    const p = (await api().post(`${G}/${s.g.id}/cycles/${c1.id}/payouts`).set(s.org.auth).send({ actualAmount: '400', payoutDate: TODAY })).body.data;
    await api().patch(`${G}/${s.g.id}/payouts/${p.id}`).set(s.org.auth).send({ action: 'confirm' }).expect(403);

    // Recorded by someone else, the organiser can confirm it.
    await api().patch(`${G}/${s.g.id}/members/${s.id('Kofi')}`).set(s.org.auth).send({ role: 'assistant' });
    const byKofi = (await contribute(s, c1.id, s.g.me.memberId, '50', s.kofi.auth)).body.data;
    const view = (await api().get(`${G}/${s.g.id}/contributions?cycleId=${c1.id}`).set(s.org.auth)).body.data.find((r) => r.id === byKofi.id);
    expect(view).toMatchObject({ canRespond: true, selfRecorded: false });
    await api().patch(`${G}/${s.g.id}/contributions/${byKofi.id}`).set(s.org.auth).send({ action: 'confirm' }).expect(200);
  });
});

describe('payouts', () => {
  it('records one payout per cycle, which only the recipient can confirm', async () => {
    const s = await setup();
    const cycles = (await generate(s)).body.data;
    const c2 = cycles[1]; // Kofi collects
    const p = (await api().post(`${G}/${s.g.id}/cycles/${c2.id}/payouts`).set(s.org.auth).send({ actualAmount: '380', payoutDate: TODAY, confirmationDetails: 'Cash at Sunday meeting' }).expect(201)).body.data;
    expect(p).toMatchObject({ recipient: { displayName: 'Kofi' }, expectedAmount: '400.00', actualAmount: '380.00', status: 'recorded' });
    await api().post(`${G}/${s.g.id}/cycles/${c2.id}/payouts`).set(s.org.auth).send({ actualAmount: '1', payoutDate: TODAY }).expect(409);
    await api().patch(`${G}/${s.g.id}/payouts/${p.id}`).set(s.esi.auth).send({ action: 'confirm' }).expect(403);
    await api().patch(`${G}/${s.g.id}/payouts/${p.id}`).set(s.kofi.auth).send({ action: 'confirm' }).expect(200);
    // Everyone in the group can see payouts.
    expect((await api().get(`${G}/${s.g.id}/payouts`).set(s.esi.auth)).body.data[0]).toMatchObject({ status: 'confirmed' });
    // Members can't record payouts.
    await api().post(`${G}/${s.g.id}/cycles/${cycles[2].id}/payouts`).set(s.kofi.auth).send({ actualAmount: '1', payoutDate: TODAY }).expect(403);
  });
});

describe('reports', () => {
  it('works out outstanding amounts from recorded and confirmed records, never scheduled or disputed ones', async () => {
    const s = await setup();
    const [c1, c2, c3] = (await generate(s)).body.data;
    // Cycle 1 (due 2 weeks ago): org 100, Kofi 100 (confirmed), Esi 60 (partial), Mama nothing (missed)
    await contribute(s, c1.id, s.g.me.memberId, '100');
    const k = (await contribute(s, c1.id, s.id('Kofi'), '100')).body.data;
    await api().patch(`${G}/${s.g.id}/contributions/${k.id}`).set(s.kofi.auth).send({ action: 'confirm' });
    await contribute(s, c1.id, s.id('Esi'), '60');
    // Cycle 2: Esi records 100 but disputes it; it doesn't count as received
    const e = (await contribute(s, c2.id, s.id('Esi'), '100')).body.data;
    await api().patch(`${G}/${s.g.id}/contributions/${e.id}`).set(s.esi.auth).send({ action: 'dispute', reason: 'Not mine' });

    const r = (await api().get(`${G}/${s.g.id}/reports`).set(s.org.auth).expect(200)).body.data;
    const cy1 = r.cycles.find((c) => c.number === 1);
    expect(cy1).toMatchObject({ expectedPool: '400.00', received: '260.00', confirmed: '100.00', outstanding: '140.00' });
    expect(cy1.members.map((m) => m.state).sort()).toEqual(['missed', 'paid', 'paid', 'partial']);
    const cy2 = r.cycles.find((c) => c.number === 2);
    expect(cy2).toMatchObject({ received: '0.00', disputed: '100.00', outstanding: '400.00' });
    // Cycle 3 is due today (counted); cycle 4 is next week (scheduled, not counted).
    expect(r.cycles.find((c) => c.number === 4).members.every((m) => m.state === 'scheduled')).toBe(true);
    expect(r.totals).toMatchObject({ dueCycles: 3, expectedToDate: '1200.00', received: '260.00', outstanding: '940.00' });

    const esiRow = r.members.find((m) => m.member.displayName === 'Esi');
    // Cycle 3 is due today: owed (so outstanding) but not yet "missed".
    expect(esiRow).toMatchObject({ expectedToDate: '300.00', received: '60.00', disputed: '100.00', outstanding: '240.00', partialCycles: 1, missedCycles: 0, upcoming: '100.00' });
    expect(r.cycles.find((c) => c.number === 3).members.every((m) => m.state === 'due')).toBe(true);
    expect(r.members.find((m) => m.member.displayName === 'Mama Ama').missedCycles).toBe(2);
    expect(r.disputes).toHaveLength(1);

    // A member sees cycle totals but only their own row.
    const mine = (await api().get(`${G}/${s.g.id}/reports`).set(s.kofi.auth)).body.data;
    expect(mine.members.map((m) => m.member.displayName)).toEqual(['Kofi']);
    expect(mine.cycles[0].members).toHaveLength(1);
    expect(mine.disputes).toHaveLength(0);
    void c3;
  });

  it('never touches anyone’s workspace accounts or reports', async () => {
    const s = await setup();
    const [c1] = (await generate(s)).body.data;
    await contribute(s, c1.id, s.id('Kofi'), '100');
    await api().post(`${G}/${s.g.id}/cycles/${c1.id}/payouts`).set(s.org.auth).send({ actualAmount: '400', payoutDate: TODAY });
    expect(await Transaction.countDocuments({})).toBe(0);
    for (const u of [s.org, s.kofi]) {
      const sum = (await api().get('/api/transactions/summary').set({ ...u.auth, 'X-Workspace-Id': u.user.lastWorkspaceId })).body.data;
      expect(sum).toMatchObject({ income: '0.00', expense: '0.00' });
    }
  });
});

describe('activity history', () => {
  it('logs every important action; members see group events and their own', async () => {
    const s = await setup();
    const [c1] = (await generate(s)).body.data;
    await contribute(s, c1.id, s.id('Esi'), '100');
    await api().patch(`${G}/${s.g.id}`).set(s.org.auth).send({ collectionSchedule: 'Sundays after church' });
    const all = (await api().get(`${G}/${s.g.id}/activity`).set(s.org.auth)).body.data.map((a) => a.action);
    expect(all).toEqual(expect.arrayContaining(['group.created', 'member.invited', 'member.joined', 'member.added', 'cycles.generated', 'contribution.recorded', 'group.settings_changed']));
    const kofi = (await api().get(`${G}/${s.g.id}/activity`).set(s.kofi.auth)).body.data.map((a) => a.action);
    expect(kofi).not.toContain('contribution.recorded'); // Esi's, not his
    expect(kofi).toContain('cycles.generated');
    await expect(SusuActivityLog.updateMany({}, { action: 'x' })).rejects.toThrow(/immutable/);
  });
});

describe('susu business-rule guardrails', () => {
  it('group routes only record payouts; nothing initiates, sends or collects money', () => {
    const routes = groupsRouter.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, methods: Object.keys(l.route.methods) }));
    for (const r of routes) expect(r.path).not.toMatch(/checkout|wallet|transfer|disburse|settle|collect|webhook|charge|send|execute|initiate|pay(?!outs)/i);
    const payoutRoutes = routes.filter((r) => r.path.includes('payouts'));
    // Proof files are evidence of a payout made elsewhere; they don't move money.
    expect(payoutRoutes.map((r) => `${r.methods[0]} ${r.path}`).sort()).toEqual(['get /:groupId/payouts', 'patch /:groupId/payouts/:recordId', 'post /:groupId/cycles/:cycleId/payouts', 'get /:groupId/payouts/:recordId/proof', 'post /:groupId/payouts/:recordId/proof'].sort());
  });

  it('no Susu code references a payment provider or the payments module', async () => {
    const dir = path.resolve('modules/susu');
    for (const f of await fs.readdir(dir)) {
      const text = await fs.readFile(path.join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/paystack|flutterwave|stripe|momo ?api|\.\.\/payments|from ['"].*payments/i);
    }
  });
});

describe('offline replays', () => {
  it('stores a contribution once when the same Idempotency-Key is sent twice', async () => {
    const s = await setup();
    const cycles = (await generate(s).expect(201)).body.data;
    const send = () => api().post(`${G}/${s.g.id}/cycles/${cycles[0].id}/contributions`).set(s.org.auth).set('Idempotency-Key', 'offline-draft-0001').send({ memberId: s.id('Kofi'), amount: '100', date: TODAY });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([201, 201]);
    expect(a.body.data.id).toBe(b.body.data.id);
    const list = (await api().get(`${G}/${s.g.id}/contributions`).set(s.org.auth)).body.data;
    expect(list).toHaveLength(1);
  });
});
