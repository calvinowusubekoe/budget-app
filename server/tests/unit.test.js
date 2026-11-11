import { describe, expect, it } from 'vitest';
import { can, assignableRoles, permissionsFor } from '../modules/workspaces/permissions.js';
import { _scrub } from '../middleware/sanitize.js';
import { isCurrency } from '../utils/currencies.js';
import { api } from './helpers.js';

describe('permissions', () => {
  it('maps roles to permissions', () => {
    expect(can('owner', 'billing.manage')).toBe(true);
    expect(can('admin', 'billing.manage')).toBe(false);
    expect(can('viewer', 'records.write')).toBe(false);
    expect(can('member', 'records.write')).toBe(true);
    expect(permissionsFor('viewer').every((p) => p.endsWith('.read'))).toBe(true);
  });

  it('throws on unknown permissions so typos fail loudly', () => {
    expect(() => can('owner', 'records.wirte')).toThrow();
  });

  it('limits which roles each actor may assign', () => {
    expect(assignableRoles('owner')).toContain('admin');
    expect(assignableRoles('admin')).not.toContain('admin');
    expect(assignableRoles('member')).toEqual([]);
  });
});

describe('sanitizer', () => {
  it('drops operator and dotted keys recursively', () => {
    const out = _scrub({ a: 1, $where: 'x', nested: { 'b.c': 1, ok: { $gt: 1, keep: true } }, list: [{ $ne: 1, v: 2 }] });
    expect(out).toEqual({ a: 1, nested: { ok: { keep: true } }, list: [{ v: 2 }] });
  });
});

describe('meta', () => {
  it('knows ISO 4217 currencies', () => {
    for (const c of ['GHS', 'USD', 'EUR', 'GBP', 'NGN', 'CAD', 'XOF']) expect(isCurrency(c)).toBe(true);
    expect(isCurrency('ABC')).toBe(false);
  });

  it('serves health, meta, and OpenAPI docs; API responses are not cacheable', async () => {
    const health = await api().get('/api/health').expect(200);
    expect(health.body.data.database).toBe('connected');
    expect(health.headers['cache-control']).toBe('no-store');
    const meta = await api().get('/api/meta').expect(200);
    expect(meta.body.data.currencies.featured[0]).toBe('GHS');
    const spec = await api().get('/api/openapi.json').expect(200);
    expect(Object.keys(spec.body.paths)).toContain('/auth/register');
  });

  it('returns JSON errors for unknown routes and bad JSON', async () => {
    const nf = await api().get('/api/nope').expect(404);
    expect(nf.body.success).toBe(false);
    const bad = await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(bad.body.error.code).toBe('BAD_REQUEST');
  });

  it('sets security headers', async () => {
    const res = await api().get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
