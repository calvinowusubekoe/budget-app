import { describe, expect, it } from 'vitest';
import { productionProblems } from '../config/production.js';
import { api, registerUser } from './helpers.js';

describe('HTTP hardening', () => {
  it('sends security headers, hides the framework and never lets caches keep API data', async () => {
    const res = await api().get('/api/health').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('only allows the configured browser origins', async () => {
    const bad = await api().get('/api/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const good = await api().get('/api/health').set('Origin', 'http://localhost:5173');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(good.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects oversized bodies and operator injection in inputs', async () => {
    await api().post('/api/auth/login').set('Content-Type', 'application/json').send(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200_000) })).expect(413);
    const res = await api().post('/api/auth/login').send({ email: { $gt: '' }, password: { $ne: null } });
    expect([400, 422]).toContain(res.status);
    expect(res.body.data).toBeUndefined();
  });

  it('requires a session for every workspace endpoint', async () => {
    for (const path of ['/api/accounts', '/api/transactions', '/api/budgets', '/api/analytics/insights?from=2026-01-01&to=2026-01-31', '/api/subscriptions/current', '/api/ai/status', '/api/susu/plans', '/api/susu/groups']) {
      const res = await api().get(path);
      expect(res.status, path).toBe(401);
    }
  });
});

describe('workspace isolation sweep', () => {
  it("returns 404 for every scoped read of someone else's workspace", async () => {
    const owner = await registerUser({ name: 'Owner' });
    const other = await registerUser({ name: 'Other' });
    const ws = owner.user.lastWorkspaceId;
    const h = { ...other.auth, 'X-Workspace-Id': ws };
    const range = 'from=2026-01-01&to=2026-12-31';
    const paths = [
      '/api/accounts',
      '/api/categories',
      '/api/transactions',
      '/api/budgets',
      '/api/savings-goals',
      '/api/debts',
      '/api/recurring',
      '/api/susu/plans',
      '/api/susu/summary',
      `/api/analytics/dashboard?${range}`,
      `/api/analytics/monthly?${range}`,
      `/api/analytics/spending?${range}`,
      `/api/analytics/savings?${range}`,
      `/api/analytics/separated?${range}`,
      `/api/analytics/insights?${range}`,
      '/api/subscriptions/current',
      '/api/subscriptions/history',
      '/api/ai/status',
      `/api/workspaces/${ws}`,
      `/api/workspaces/${ws}/members`,
      `/api/workspaces/${ws}/audit`,
    ];
    for (const p of paths) {
      const res = await api().get(p).set(h);
      expect(res.status, p).toBe(404);
      expect(JSON.stringify(res.body), p).not.toMatch(/"data"/);
    }
    // Writes too.
    await api().post('/api/accounts').set(h).send({ name: 'x', type: 'cash', currency: 'GHS' }).expect(404);
    await api().post('/api/ai/ask').set(h).send({ question: 'What does this person earn?' }).expect(404);
  });
});

describe('production configuration checks', () => {
  const good = {
    CLIENT_URL: 'https://app.budgetflow.example',
    COOKIE_SECURE: true,
    SMTP_HOST: 'smtp.example',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    AI_PROVIDER: 'none',
    TRUST_PROXY: 1,
    UPLOAD_DIR: '/data/uploads',
    CORS_ORIGINS: '',
  };
  it('passes a sound production setup', () => {
    expect(productionProblems(good, { MONGODB_URI: 'mongodb+srv://x' })).toEqual({ errors: [], warnings: [] });
  });
  it('refuses unsafe settings', () => {
    const { errors, warnings } = productionProblems(
      { ...good, CLIENT_URL: 'http://app.example', COOKIE_SECURE: false, SMTP_HOST: '', JWT_ACCESS_SECRET: 'dev-only-access-secret-change-me-0123456789', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '', FLUTTERWAVE_SECRET_KEY: 'FLWSECK-x', FLUTTERWAVE_WEBHOOK_HASH: '', CORS_ORIGINS: 'http://other.example', PAYSTACK_SECRET_KEY: 'sk_test_1' },
      {},
    );
    expect(errors).toHaveLength(8);
    expect(warnings.join(' ')).toMatch(/TEST key/);
  });
});
