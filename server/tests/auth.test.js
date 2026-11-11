import { describe, expect, it } from 'vitest';
import { User } from '../modules/users/user.model.js';
import { Session } from '../modules/auth/session.model.js';
import { AuthToken } from '../modules/auth/authToken.model.js';
import { api, PASSWORD, refreshCookieValue, registerUser, tokenFromEmail, uniqueEmail } from './helpers.js';

describe('registration', () => {
  it('creates the user, a private Personal workspace, and a session', async () => {
    const { user, token, cookie, email } = await registerUser({ defaultCurrency: 'USD' });

    expect(user.email).toBe(email);
    expect(user.emailVerified).toBe(false);
    expect(user.defaultCurrency).toBe('USD');
    expect(token).toBeTypeOf('string');

    const raw = [].concat(cookie).find((c) => c.startsWith('bf_rt='));
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(raw).toMatch(/Path=\/api\/auth/);

    const res = await api().get('/api/workspaces').set('Authorization', `Bearer ${token}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ name: 'Personal', type: 'personal', baseCurrency: 'USD', role: 'owner' });
    expect(user.lastWorkspaceId).toBe(res.body.data[0].id);
  });

  it('never stores the password or refresh secret in plaintext', async () => {
    const { email, cookie } = await registerUser();
    const stored = await User.findOne({ email }).select('+passwordHash').lean();
    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);

    const secret = refreshCookieValue(cookie).split('.')[1];
    const session = await Session.findOne({ userId: stored._id }).lean();
    expect(session.tokenHash).not.toBe(secret);
    expect(JSON.stringify(session)).not.toContain(secret);
  });

  it('records versioned consent', async () => {
    const { email } = await registerUser({ marketingConsent: true });
    const stored = await User.findOne({ email }).lean();
    expect(stored.consents.map((c) => c.type).sort()).toEqual(['marketing', 'privacy', 'terms']);
    expect(stored.consents.every((c) => c.version)).toBe(true);
  });

  it('requires terms and privacy acceptance', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ name: 'Kofi', email: uniqueEmail(), password: PASSWORD, acceptTerms: true, acceptPrivacy: false });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].field).toBe('acceptPrivacy');
  });

  it('rejects weak passwords and unknown currencies', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ name: 'Kofi', email: uniqueEmail(), password: 'short', defaultCurrency: 'XYZ', acceptTerms: true, acceptPrivacy: true });
    expect(res.status).toBe(422);
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toContain('password');
    expect(fields).toContain('defaultCurrency');
  });

  it('rejects a duplicate email', async () => {
    const { email } = await registerUser();
    const res = await api()
      .post('/api/auth/register')
      .send({ name: 'Copy', email: email.toUpperCase(), password: PASSWORD, acceptTerms: true, acceptPrivacy: true });
    expect(res.status).toBe(409);
  });

  it('strips Mongo operator keys from input', async () => {
    const res = await api().post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(422);
  });
});

describe('login and lockout', () => {
  it('signs in with correct credentials and gives the same error for wrong password or unknown email', async () => {
    const { email } = await registerUser();
    const good = await api().post('/api/auth/login').send({ email, password: PASSWORD });
    expect(good.status).toBe(200);

    const wrong = await api().post('/api/auth/login').send({ email, password: 'nope nope 1' });
    const unknown = await api().post('/api/auth/login').send({ email: uniqueEmail(), password: 'nope nope 1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after repeated failures', async () => {
    const { email } = await registerUser();
    for (let i = 0; i < 5; i += 1) {
      await api().post('/api/auth/login').send({ email, password: 'wrong password 1' });
    }
    const res = await api().post('/api/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(423);
  });
});

describe('refresh token rotation', () => {
  it('rotates the refresh token and issues a working access token', async () => {
    const { cookie } = await registerUser();
    const first = refreshCookieValue(cookie);
    const res = await api().post('/api/auth/refresh').set('Cookie', first);
    expect(res.status).toBe(200);
    const second = refreshCookieValue(res.headers['set-cookie']);
    expect(second).not.toBe(first);

    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('revokes the session when an old refresh token is replayed', async () => {
    const { cookie, auth } = await registerUser();
    const first = refreshCookieValue(cookie);
    const rotated = await api().post('/api/auth/refresh').set('Cookie', first);
    const second = refreshCookieValue(rotated.headers['set-cookie']);

    const replay = await api().post('/api/auth/refresh').set('Cookie', first);
    expect(replay.status).toBe(401);

    // The legitimate holder is now signed out too: the family is burned.
    const after = await api().post('/api/auth/refresh').set('Cookie', second);
    expect(after.status).toBe(401);
    const me = await api().get('/api/auth/me').set(auth);
    expect(me.status).toBe(401);
  });

  it('rejects refresh without a cookie', async () => {
    const res = await api().post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });
});

describe('logout and sessions', () => {
  it('logout ends the session immediately, even for an unexpired access token', async () => {
    const { cookie, auth } = await registerUser();
    await api().post('/api/auth/logout').set('Cookie', refreshCookieValue(cookie)).expect(200);
    await api().get('/api/auth/me').set(auth).expect(401);
    await api().post('/api/auth/refresh').set('Cookie', refreshCookieValue(cookie)).expect(401);
  });

  it('lists sessions and revokes another device', async () => {
    const { email, auth } = await registerUser();
    const other = await api().post('/api/auth/login').send({ email, password: PASSWORD });
    const otherAuth = { Authorization: `Bearer ${other.body.data.accessToken}` };

    const list = await api().get('/api/auth/sessions').set(auth);
    expect(list.body.data).toHaveLength(2);
    const target = list.body.data.find((s) => !s.current);

    await api().delete(`/api/auth/sessions/${target.id}`).set(auth).expect(200);
    await api().get('/api/auth/me').set(otherAuth).expect(401);
    await api().get('/api/auth/me').set(auth).expect(200);
  });

  it('cannot revoke another user’s session', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const bSessions = await api().get('/api/auth/sessions').set(b.auth);
    await api().delete(`/api/auth/sessions/${bSessions.body.data[0].id}`).set(a.auth).expect(404);
    await api().get('/api/auth/me').set(b.auth).expect(200);
  });
});

describe('email verification', () => {
  it('verifies with the emailed token, once', async () => {
    const { email, auth } = await registerUser();
    const token = tokenFromEmail(email, '/verify-email');

    const res = await api().post('/api/auth/verify-email').send({ token });
    expect(res.status).toBe(200);
    expect(res.body.data.user.emailVerified).toBe(true);

    await api().post('/api/auth/verify-email').send({ token }).expect(400);
    await api().post('/api/auth/resend-verification').set(auth).expect(400);
  });

  it('stores only a hash of the token', async () => {
    const { email } = await registerUser();
    const token = tokenFromEmail(email, '/verify-email');
    const rows = await AuthToken.find().lean();
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('resend invalidates the previous link', async () => {
    const { email, auth } = await registerUser();
    const oldToken = tokenFromEmail(email, '/verify-email');
    await api().post('/api/auth/resend-verification').set(auth).expect(201);
    const newToken = tokenFromEmail(email, '/verify-email');
    expect(newToken).not.toBe(oldToken);
    await api().post('/api/auth/verify-email').send({ token: oldToken }).expect(400);
    await api().post('/api/auth/verify-email').send({ token: newToken }).expect(200);
  });
});

describe('password reset', () => {
  it('responds identically for unknown emails', async () => {
    const { email } = await registerUser();
    const known = await api().post('/api/auth/forgot-password').send({ email });
    const unknown = await api().post('/api/auth/forgot-password').send({ email: uniqueEmail() });
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
  });

  it('resets the password, signs out every device, and the token is single-use', async () => {
    const { email, auth } = await registerUser();
    await api().post('/api/auth/forgot-password').send({ email });
    const token = tokenFromEmail(email, '/reset-password');

    await api().post('/api/auth/reset-password').send({ token, password: 'brand new pass 9' }).expect(200);
    await api().get('/api/auth/me').set(auth).expect(401);
    await api().post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);
    await api().post('/api/auth/login').send({ email, password: 'brand new pass 9' }).expect(200);
    await api().post('/api/auth/reset-password').send({ token, password: 'another pass 77' }).expect(400);
  });
});

describe('profile', () => {
  it('updates preferences and keeps marketing consent history', async () => {
    const { auth, email } = await registerUser();
    const res = await api()
      .patch('/api/users/me')
      .set(auth)
      .send({ name: 'Ama K. Mensah', defaultCurrency: 'EUR', timezone: 'Europe/London', marketingConsent: true });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ name: 'Ama K. Mensah', defaultCurrency: 'EUR', marketingConsent: true });
    const stored = await User.findOne({ email }).lean();
    expect(stored.consents.filter((c) => c.type === 'marketing')).toHaveLength(2);
  });

  it('rejects an unknown time zone and a workspace the user does not belong to', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await api().patch('/api/users/me').set(a.auth).send({ timezone: 'Mars/Olympus' }).expect(422);
    await api().patch('/api/users/me').set(a.auth).send({ lastWorkspaceId: b.user.lastWorkspaceId }).expect(404);
  });

  it('changes password and signs out other devices only', async () => {
    const { email, auth } = await registerUser();
    const other = await api().post('/api/auth/login').send({ email, password: PASSWORD });
    const otherAuth = { Authorization: `Bearer ${other.body.data.accessToken}` };

    await api().post('/api/users/me/password').set(auth).send({ currentPassword: 'wrong', newPassword: 'new password 12' }).expect(422);
    await api().post('/api/users/me/password').set(auth).send({ currentPassword: PASSWORD, newPassword: 'new password 12' }).expect(200);
    await api().get('/api/auth/me').set(auth).expect(200);
    await api().get('/api/auth/me').set(otherAuth).expect(401);
  });

  it('exports profile data without secrets', async () => {
    const { auth } = await registerUser();
    const res = await api().get('/api/users/me/export').set(auth).expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('passwordHash');
    expect(res.body.data.memberships).toHaveLength(1);
  });
});
