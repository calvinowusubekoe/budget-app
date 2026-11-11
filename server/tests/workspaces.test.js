import { describe, expect, it } from 'vitest';
import { AuditLog } from '../modules/audit/auditLog.model.js';
import { api, registerUser, tokenFromEmail } from './helpers.js';

async function businessWorkspace(owner, name = 'Kente Traders') {
  const res = await api()
    .post('/api/workspaces')
    .set(owner.auth)
    .send({ name, type: 'business', baseCurrency: 'GHS', business: { legalName: `${name} Ltd`, industry: 'Retail' } });
  expect(res.status).toBe(201);
  return res.body.data;
}

/** Invites `invitee` with `role` and accepts; returns the invitee's member id. */
async function addMember(owner, workspace, invitee, role) {
  await api().post(`/api/workspaces/${workspace.id}/invitations`).set(owner.auth).send({ email: invitee.email, role }).expect(201);
  const token = tokenFromEmail(invitee.email, '/invitations/accept');
  await api().post('/api/workspaces/invitations/accept').set(invitee.auth).send({ token }).expect(200);
  const members = await api().get(`/api/workspaces/${workspace.id}/members`).set(owner.auth);
  return members.body.data.find((m) => m.email === invitee.email).id;
}

describe('workspace creation and isolation', () => {
  it('creates a business workspace owned by the caller', async () => {
    const owner = await registerUser();
    const ws = await businessWorkspace(owner);
    expect(ws).toMatchObject({ type: 'business', role: 'owner', baseCurrency: 'GHS' });
    expect(ws.permissions).toContain('billing.manage');

    const list = await api().get('/api/workspaces').set(owner.auth);
    expect(list.body.data.map((w) => w.type)).toEqual(['personal', 'business']);
  });

  it('rejects business details on a personal workspace', async () => {
    const owner = await registerUser();
    await api()
      .post('/api/workspaces')
      .set(owner.auth)
      .send({ name: 'Side', type: 'personal', baseCurrency: 'GHS', business: { legalName: 'X' } })
      .expect(422);
  });

  it('returns 404 (not 403) for workspaces the user is not part of', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const bWs = b.user.lastWorkspaceId;
    await api().get(`/api/workspaces/${bWs}`).set(a.auth).expect(404);
    await api().get(`/api/workspaces/${bWs}/members`).set(a.auth).expect(404);
    await api().patch(`/api/workspaces/${bWs}`).set(a.auth).send({ name: 'Mine now' }).expect(404);
  });

  it('rejects malformed workspace ids', async () => {
    const a = await registerUser();
    await api().get('/api/workspaces/not-an-id').set(a.auth).expect(422);
  });

  it('requires authentication', async () => {
    await api().get('/api/workspaces').expect(401);
  });
});

describe('invitations', () => {
  it('does not allow inviting people to a personal workspace', async () => {
    const owner = await registerUser();
    const res = await api()
      .post(`/api/workspaces/${owner.user.lastWorkspaceId}/invitations`)
      .set(owner.auth)
      .send({ email: 'someone@example.com', role: 'member' });
    expect(res.status).toBe(400);
  });

  it('invites, accepts, and grants the invited role', async () => {
    const owner = await registerUser();
    const invitee = await registerUser({ name: 'Yaw Boateng' });
    const ws = await businessWorkspace(owner);
    await addMember(owner, ws, invitee, 'member');

    const seen = await api().get(`/api/workspaces/${ws.id}`).set(invitee.auth);
    expect(seen.body.data.role).toBe('member');
    expect(seen.body.data.permissions).toContain('records.write');
    expect(seen.body.data.permissions).not.toContain('members.manage');
  });

  it('refuses an invitation accepted by a different account', async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const intruder = await registerUser();
    const ws = await businessWorkspace(owner);
    await api().post(`/api/workspaces/${ws.id}/invitations`).set(owner.auth).send({ email: invitee.email, role: 'admin' });
    const token = tokenFromEmail(invitee.email, '/invitations/accept');

    await api().post('/api/workspaces/invitations/accept').set(intruder.auth).send({ token }).expect(403);
    await api().get(`/api/workspaces/${ws.id}`).set(intruder.auth).expect(404);
  });

  it('invitations are single-use and revocable', async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const ws = await businessWorkspace(owner);

    const inv = await api().post(`/api/workspaces/${ws.id}/invitations`).set(owner.auth).send({ email: invitee.email, role: 'viewer' });
    const token = tokenFromEmail(invitee.email, '/invitations/accept');
    await api().delete(`/api/workspaces/${ws.id}/invitations/${inv.body.data.id}`).set(owner.auth).expect(200);
    await api().post('/api/workspaces/invitations/accept').set(invitee.auth).send({ token }).expect(400);

    await addMember(owner, ws, invitee, 'viewer');
    const again = await api()
      .post(`/api/workspaces/${ws.id}/invitations`)
      .set(owner.auth)
      .send({ email: invitee.email, role: 'viewer' });
    expect(again.status).toBe(409);
  });
});

describe('role-based access control', () => {
  it('viewers can read but not manage; members cannot manage members', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const member = await registerUser();
    const ws = await businessWorkspace(owner);
    const viewerId = await addMember(owner, ws, viewer, 'viewer');
    await addMember(owner, ws, member, 'member');

    await api().get(`/api/workspaces/${ws.id}/members`).set(viewer.auth).expect(200);
    await api().patch(`/api/workspaces/${ws.id}`).set(viewer.auth).send({ name: 'x' }).expect(403);
    await api().get(`/api/workspaces/${ws.id}/invitations`).set(member.auth).expect(403);
    await api().patch(`/api/workspaces/${ws.id}/members/${viewerId}`).set(member.auth).send({ role: 'member' }).expect(403);
    await api().get(`/api/workspaces/${ws.id}/audit`).set(member.auth).expect(403);
  });

  it('only the owner can create or promote admins', async () => {
    const owner = await registerUser();
    const admin = await registerUser();
    const member = await registerUser();
    const ws = await businessWorkspace(owner);
    await addMember(owner, ws, admin, 'admin');
    const memberId = await addMember(owner, ws, member, 'member');

    await api().post(`/api/workspaces/${ws.id}/invitations`).set(admin.auth).send({ email: 'new@example.com', role: 'admin' }).expect(403);
    await api().patch(`/api/workspaces/${ws.id}/members/${memberId}`).set(admin.auth).send({ role: 'admin' }).expect(403);
    await api().patch(`/api/workspaces/${ws.id}/members/${memberId}`).set(admin.auth).send({ role: 'viewer' }).expect(200);
    await api().patch(`/api/workspaces/${ws.id}/members/${memberId}`).set(owner.auth).send({ role: 'admin' }).expect(200);
  });

  it('protects the owner and lets members leave', async () => {
    const owner = await registerUser();
    const admin = await registerUser();
    const member = await registerUser();
    const ws = await businessWorkspace(owner);
    await addMember(owner, ws, admin, 'admin');
    const memberId = await addMember(owner, ws, member, 'member');
    const members = await api().get(`/api/workspaces/${ws.id}/members`).set(owner.auth);
    const ownerId = members.body.data.find((m) => m.role === 'owner').id;

    await api().patch(`/api/workspaces/${ws.id}/members/${ownerId}`).set(admin.auth).send({ role: 'viewer' }).expect(403);
    await api().delete(`/api/workspaces/${ws.id}/members/${ownerId}`).set(admin.auth).expect(403);
    await api().delete(`/api/workspaces/${ws.id}/members/${ownerId}`).set(owner.auth).expect(403);

    await api().delete(`/api/workspaces/${ws.id}/members/${memberId}`).set(member.auth).expect(200);
    await api().get(`/api/workspaces/${ws.id}`).set(member.auth).expect(404);
  });

  it('a removed member loses access immediately', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const ws = await businessWorkspace(owner);
    const memberId = await addMember(owner, ws, member, 'member');
    await api().delete(`/api/workspaces/${ws.id}/members/${memberId}`).set(owner.auth).expect(200);
    await api().get(`/api/workspaces/${ws.id}`).set(member.auth).expect(404);
  });
});

describe('audit history', () => {
  it('records workspace changes with before/after and exposes them to admins', async () => {
    const owner = await registerUser();
    const ws = await businessWorkspace(owner);
    await api().patch(`/api/workspaces/${ws.id}`).set(owner.auth).send({ name: 'Kente Traders Accra', baseCurrency: 'USD' }).expect(200);

    const res = await api().get(`/api/workspaces/${ws.id}/audit`).set(owner.auth).expect(200);
    const update = res.body.data.find((e) => e.action === 'workspace.updated');
    expect(update.metadata.before).toEqual({ name: 'Kente Traders', baseCurrency: 'GHS' });
    expect(update.metadata.after).toEqual({ name: 'Kente Traders Accra', baseCurrency: 'USD' });
    expect(res.body.data.map((e) => e.action)).toContain('workspace.created');
  });

  it('audit entries cannot be modified', async () => {
    const owner = await registerUser();
    await businessWorkspace(owner);
    await expect(AuditLog.updateMany({}, { action: 'tampered' })).rejects.toThrow(/immutable/);
  });
});
