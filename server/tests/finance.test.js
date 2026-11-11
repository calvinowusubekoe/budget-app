import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Transaction } from '../modules/transactions/transaction.model.js';
import { api, registerUser, tokenFromEmail } from './helpers.js';

/** A signed-in user plus helpers bound to their Personal workspace (GHS). */
async function setup(currency = 'GHS') {
  const u = await registerUser({ defaultCurrency: currency });
  const ws = u.user.lastWorkspaceId;
  const h = { ...u.auth, 'X-Workspace-Id': ws };
  const cats = (await api().get('/api/categories').set(h)).body.data;
  const cat = (kind, systemKey) => cats.find((c) => c.kind === kind && c.systemKey === systemKey).id;
  const account = async (body) => {
    const res = await api().post('/api/accounts').set(h).send({ type: 'bank', currency, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data;
  };
  const tx = (body, headers = {}) => api().post('/api/transactions').set(h).set(headers).send({ date: '2026-11-05', description: 'Test', ...body });
  const balance = async (id) => (await api().get(`/api/accounts/${id}`).set(h)).body.data.balance;
  return { ...u, ws, h, cat, account, tx, balance };
}

afterAll(async () => {
  await fs.rm(path.resolve('tests/.uploads'), { recursive: true, force: true });
});

describe('categories', () => {
  it('seeds income and expense defaults once per workspace', async () => {
    const s = await setup();
    const res = await api().get('/api/categories').set(s.h);
    const kinds = res.body.data.map((c) => c.systemKey);
    expect(kinds).toEqual(expect.arrayContaining(['salary', 'business_revenue', 'freelance', 'rental', 'investments', 'gifts', 'housing', 'food', 'transport', 'utilities', 'education', 'healthcare', 'entertainment', 'subscriptions', 'business_expenses']));
    const again = await api().get('/api/categories').set(s.h);
    expect(again.body.data).toHaveLength(res.body.data.length);
  });

  it('creates custom categories, rejects duplicates, archives instead of deleting', async () => {
    const s = await setup();
    const c = await api().post('/api/categories').set(s.h).send({ kind: 'expense', name: 'Church dues' }).expect(201);
    await api().post('/api/categories').set(s.h).send({ kind: 'expense', name: '  church DUES ' }).expect(409);
    await api().patch(`/api/categories/${c.body.data.id}`).set(s.h).send({ archived: true }).expect(200);
    const list = await api().get('/api/categories?kind=expense').set(s.h);
    expect(list.body.data.find((x) => x.id === c.body.data.id)).toBeUndefined();
  });
});

describe('accounts and balances', () => {
  it('derives the balance from the opening balance and transactions', async () => {
    const s = await setup();
    const acc = await s.account({ name: 'GCB Current', openingBalance: '1000.00' });
    await s.tx({ type: 'income', accountId: acc.id, categoryId: s.cat('income', 'salary'), amount: '2500.50' }).expect(201);
    await s.tx({ type: 'expense', accountId: acc.id, categoryId: s.cat('expense', 'food'), amount: '120.25' }).expect(201);
    await s.tx({ type: 'expense', accountId: acc.id, categoryId: s.cat('expense', 'transport'), amount: '0.10' }).expect(201);
    await s.tx({ type: 'expense', accountId: acc.id, categoryId: s.cat('expense', 'transport'), amount: '0.20' }).expect(201);
    expect(await s.balance(acc.id)).toBe('3379.95');
  });

  it('transfers move money between accounts without counting as income or expense', async () => {
    const s = await setup();
    const bank = await s.account({ name: 'Bank', openingBalance: '500' });
    const momo = await s.account({ name: 'MTN MoMo', type: 'mobile_money', openingBalance: '0' });
    await s.tx({ type: 'transfer', accountId: bank.id, toAccountId: momo.id, amount: '200' }).expect(201);
    expect(await s.balance(bank.id)).toBe('300.00');
    expect(await s.balance(momo.id)).toBe('200.00');

    const sum = await api().get('/api/transactions/summary?from=2026-11-01&to=2026-11-30').set(s.h);
    expect(sum.body.data).toMatchObject({ income: '0.00', expense: '0.00', net: '0.00' });
  });

  it('handles cross-currency transfers with both amounts recorded', async () => {
    const s = await setup();
    const usd = await s.account({ name: 'Dollar account', currency: 'USD', openingBalance: '100' });
    const ghs = await s.account({ name: 'Cedi account', openingBalance: '0' });
    await s.tx({ type: 'transfer', accountId: usd.id, toAccountId: ghs.id, amount: '50' }).expect(422); // received amount missing
    await s.tx({ type: 'transfer', accountId: usd.id, toAccountId: ghs.id, amount: '50', toAmount: '770.00', exchangeRate: '15.40' }).expect(201);
    expect(await s.balance(usd.id)).toBe('50.00');
    expect(await s.balance(ghs.id)).toBe('770.00');

    await s.account({ name: 'Second cedi', openingBalance: '-20.50' });
    const list = await api().get('/api/accounts').set(s.h);
    expect(list.body.meta.totals).toEqual(
      expect.arrayContaining([
        { currency: 'USD', amount: '50.00' },
        { currency: 'GHS', amount: '749.50' },
      ]),
    );
  });

  it('enforces currency decimal places', async () => {
    const s = await setup();
    const acc = await s.account({ name: 'Bank' });
    const res = await s.tx({ type: 'expense', accountId: acc.id, categoryId: s.cat('expense', 'food'), amount: '10.555' });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0]).toMatchObject({ field: 'amount' });
    await api().post('/api/accounts').set(s.h).send({ name: 'Yen', type: 'cash', currency: 'JPY', openingBalance: '10.5' }).expect(422);
  });

  it('rejects amounts sent as JSON numbers', async () => {
    const s = await setup();
    const acc = await s.account({ name: 'Bank' });
    const res = await s.tx({ type: 'expense', accountId: acc.id, categoryId: s.cat('expense', 'food'), amount: 10.5 });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].message).toMatch(/as text/);
  });

  it('locks account currency once used, and only deletes unused accounts', async () => {
    const s = await setup();
    const used = await s.account({ name: 'Used' });
    const unused = await s.account({ name: 'Unused' });
    await s.tx({ type: 'expense', accountId: used.id, categoryId: s.cat('expense', 'food'), amount: '5' }).expect(201);
    await api().patch(`/api/accounts/${used.id}`).set(s.h).send({ currency: 'USD' }).expect(409);
    await api().delete(`/api/accounts/${used.id}`).set(s.h).expect(409);
    await api().patch(`/api/accounts/${used.id}`).set(s.h).send({ status: 'archived' }).expect(200);
    await api().delete(`/api/accounts/${unused.id}`).set(s.h).expect(200);
    // Archived accounts can't take new transactions.
    await s.tx({ type: 'expense', accountId: used.id, categoryId: s.cat('expense', 'food'), amount: '5' }).expect(422);
  });
});

describe('multi-currency reporting snapshots', () => {
  it('uses rate 1 for the reporting currency', async () => {
    const s = await setup();
    const acc = await s.account({ name: 'Bank' });
    const res = await s.tx({ type: 'income', accountId: acc.id, categoryId: s.cat('income', 'salary'), amount: '100' });
    expect(res.body.data.reporting).toMatchObject({ currency: 'GHS', rate: '1', amount: '100.00', source: 'same', estimated: false });
  });

  it('asks for a rate when none is on record, then uses an entered one', async () => {
    const s = await setup();
    const usd = await s.account({ name: 'USD', currency: 'USD' });
    const body = { type: 'income', accountId: usd.id, categoryId: s.cat('income', 'freelance'), amount: '250.00' };
    const missing = await s.tx(body);
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('RATE_REQUIRED');

    const ok = await s.tx({ ...body, exchangeRate: '15.4321' }).expect(201);
    expect(ok.body.data).toMatchObject({ amount: '250.00', currency: 'USD' });
    expect(ok.body.data.reporting).toMatchObject({ currency: 'GHS', rate: '15.4321', amount: '3858.03', source: 'entered' });
  });

  it('uses the latest stored rate on or before the date and marks older rates as estimated', async () => {
    const s = await setup();
    const usd = await s.account({ name: 'USD', currency: 'USD' });
    await api().post('/api/exchange-rates').set(s.h).send({ from: 'USD', to: 'GHS', rate: '15.00', effectiveDate: '2026-11-01' }).expect(201);
    await api().post('/api/exchange-rates').set(s.h).send({ from: 'USD', to: 'GHS', rate: '16.00', effectiveDate: '2026-11-10' }).expect(201);
    const body = { type: 'expense', accountId: usd.id, categoryId: s.cat('expense', 'subscriptions'), amount: '10' };

    const onDay = await s.tx({ ...body, date: '2026-11-01' });
    expect(onDay.body.data.reporting).toMatchObject({ rate: '15', amount: '150.00', source: 'manual', estimated: false });
    const later = await s.tx({ ...body, date: '2026-11-05' });
    expect(later.body.data.reporting).toMatchObject({ rate: '15', amount: '150.00', estimated: true, rateDate: '2026-11-01' });
    const after = await s.tx({ ...body, date: '2026-11-12' });
    expect(after.body.data.reporting).toMatchObject({ rate: '16', amount: '160.00' });
    // A rate dated after the transaction is never used.
    await s.tx({ ...body, date: '2026-10-31' }).expect(422);
  });

  it('derives a rate from the reverse pair and marks it estimated', async () => {
    const s = await setup();
    const eur = await s.account({ name: 'EUR', currency: 'EUR' });
    await api().post('/api/exchange-rates').set(s.h).send({ from: 'GHS', to: 'EUR', rate: '0.0625', effectiveDate: '2026-11-01' }).expect(201);
    const res = await s.tx({ type: 'expense', accountId: eur.id, categoryId: s.cat('expense', 'food'), amount: '3' });
    expect(res.body.data.reporting).toMatchObject({ rate: '16', amount: '48.00', estimated: true });
  });

  it('never re-converts history when rates change later', async () => {
    const s = await setup();
    const usd = await s.account({ name: 'USD', currency: 'USD' });
    await api().post('/api/exchange-rates').set(s.h).send({ from: 'USD', to: 'GHS', rate: '15.00', effectiveDate: '2026-11-01' });
    const t = await s.tx({ type: 'income', accountId: usd.id, categoryId: s.cat('income', 'salary'), amount: '100' });
    // Same day, same pair: replaces the table entry...
    await api().post('/api/exchange-rates').set(s.h).send({ from: 'USD', to: 'GHS', rate: '99.00', effectiveDate: '2026-11-01' }).expect(201);
    // ...but the saved transaction keeps its own snapshot.
    const after = await api().get(`/api/transactions/${t.body.data.id}`).set(s.h);
    expect(after.body.data.reporting).toMatchObject({ rate: '15', amount: '1500.00' });
    // Editing only the notes keeps the snapshot too.
    const edited = await api().patch(`/api/transactions/${t.body.data.id}`).set(s.h).send({ notes: 'November retainer' });
    expect(edited.body.data.reporting).toMatchObject({ rate: '15', amount: '1500.00' });
  });

  it('recalculates the reporting amount with the same rate when only the amount changes', async () => {
    const s = await setup();
    const usd = await s.account({ name: 'USD', currency: 'USD' });
    const t = await s.tx({ type: 'income', accountId: usd.id, categoryId: s.cat('income', 'salary'), amount: '100', exchangeRate: '15.5' });
    const edited = await api().patch(`/api/transactions/${t.body.data.id}`).set(s.h).send({ amount: '200' });
    expect(edited.body.data.reporting).toMatchObject({ rate: '15.5', amount: '3100.00', source: 'entered' });
  });

  it('previews conversions for forms', async () => {
    const s = await setup();
    await api().post('/api/exchange-rates').set(s.h).send({ from: 'NGN', to: 'GHS', rate: '0.0095', effectiveDate: '2026-11-01' });
    const res = await api().get('/api/exchange-rates/resolve?from=NGN&date=2026-11-03&amount=50000').set(s.h).expect(200);
    expect(res.body.data).toMatchObject({ found: true, to: 'GHS', rate: '0.0095', convertedAmount: '475.00', estimated: true });
  });

  it('reports that automatic rates are off unless configured', async () => {
    const s = await setup();
    const res = await api().post('/api/exchange-rates/fetch').set(s.h).send({ from: 'USD', to: 'GHS' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PROVIDER_DISABLED');
  });

  it('locks the workspace reporting currency once records exist', async () => {
    const s = await setup();
    await api().patch(`/api/workspaces/${s.ws}`).set(s.auth).send({ baseCurrency: 'USD' }).expect(200);
    await api().patch(`/api/workspaces/${s.ws}`).set(s.auth).send({ baseCurrency: 'GHS' }).expect(200);
    const acc = await s.account({ name: 'Bank' });
    await s.tx({ type: 'expense', accountId: acc.id, categoryId: s.cat('expense', 'food'), amount: '1' }).expect(201);
    const res = await api().patch(`/api/workspaces/${s.ws}`).set(s.auth).send({ baseCurrency: 'USD' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REPORTING_CURRENCY_LOCKED');
  });
});

describe('transaction rules', () => {
  it('requires a category of the matching kind; transfers have none', async () => {
    const s = await setup();
    const a = await s.account({ name: 'A' });
    const b = await s.account({ name: 'B' });
    await s.tx({ type: 'expense', accountId: a.id, amount: '1' }).expect(422);
    const wrong = await s.tx({ type: 'expense', accountId: a.id, categoryId: s.cat('income', 'salary'), amount: '1' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details[0].field).toBe('categoryId');
    await s.tx({ type: 'transfer', accountId: a.id, toAccountId: b.id, categoryId: s.cat('expense', 'food'), amount: '1' }).expect(422);
    await s.tx({ type: 'transfer', accountId: a.id, toAccountId: a.id, amount: '1' }).expect(422);
    await s.tx({ type: 'expense', accountId: a.id, categoryId: s.cat('expense', 'food'), amount: '0' }).expect(422);
    await s.tx({ type: 'expense', accountId: a.id, categoryId: s.cat('expense', 'food'), amount: '5', date: '2026-02-30' }).expect(422);
  });

  it('requires a frequency for recurring transactions', async () => {
    const s = await setup();
    const a = await s.account({ name: 'A' });
    const base = { type: 'expense', accountId: a.id, categoryId: s.cat('expense', 'subscriptions'), amount: '50' };
    await s.tx({ ...base, recurrence: { isRecurring: true } }).expect(422);
    const ok = await s.tx({ ...base, recurrence: { isRecurring: true, frequency: 'monthly' } }).expect(201);
    expect(ok.body.data.recurrence).toEqual({ isRecurring: true, frequency: 'monthly' });
  });

  it('saves an Idempotency-Key retry only once', async () => {
    const s = await setup();
    const a = await s.account({ name: 'A' });
    const body = { type: 'expense', accountId: a.id, categoryId: s.cat('expense', 'food'), amount: '12.00' };
    const key = { 'Idempotency-Key': 'offline-draft-0001' };
    const first = await s.tx(body, key).expect(201);
    const second = await s.tx(body, key).expect(200);
    expect(second.body.meta.replayed).toBe(true);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await s.balance(a.id)).toBe('-12.00');
  });

  it('detects edit conflicts with the version number', async () => {
    const s = await setup();
    const a = await s.account({ name: 'A' });
    const t = (await s.tx({ type: 'expense', accountId: a.id, categoryId: s.cat('expense', 'food'), amount: '5' })).body.data;
    await api().patch(`/api/transactions/${t.id}`).set(s.h).send({ notes: 'first', version: t.version }).expect(200);
    const stale = await api().patch(`/api/transactions/${t.id}`).set(s.h).send({ notes: 'second', version: t.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('a transfer cannot be turned into income or expense', async () => {
    const s = await setup();
    const a = await s.account({ name: 'A' });
    const b = await s.account({ name: 'B' });
    const t = (await s.tx({ type: 'transfer', accountId: a.id, toAccountId: b.id, amount: '5' })).body.data;
    await api().patch(`/api/transactions/${t.id}`).set(s.h).send({ type: 'expense', categoryId: s.cat('expense', 'food') }).expect(422);
  });

  it('reconciled transactions are locked; deletes are soft and leave balances', async () => {
    const s = await setup();
    const a = await s.account({ name: 'A', openingBalance: '100' });
    const t = (await s.tx({ type: 'expense', accountId: a.id, categoryId: s.cat('expense', 'food'), amount: '40' })).body.data;

    await api().post(`/api/transactions/${t.id}/reconcile`).set(s.h).expect(200);
    await api().patch(`/api/transactions/${t.id}`).set(s.h).send({ amount: '1' }).expect(409);
    await api().delete(`/api/transactions/${t.id}`).set(s.h).send({}).expect(409);
    await api().post(`/api/transactions/${t.id}/unreconcile`).set(s.h).expect(200);

    await api().delete(`/api/transactions/${t.id}`).set(s.h).send({ reason: 'Duplicate entry' }).expect(200);
    expect(await s.balance(a.id)).toBe('100.00');
    await api().get(`/api/transactions/${t.id}`).set(s.h).expect(404);
    // Still stored, flagged deleted, for the audit trail.
    const stored = await Transaction.findById(t.id).lean();
    expect(stored.deletedAt).toBeInstanceOf(Date);
  });

  it('keeps an audit history of each transaction with field-level changes', async () => {
    const s = await setup();
    const a = await s.account({ name: 'A' });
    const t = (await s.tx({ type: 'expense', accountId: a.id, categoryId: s.cat('expense', 'food'), amount: '40' })).body.data;
    await api().patch(`/api/transactions/${t.id}`).set(s.h).send({ amount: '45.50', description: 'Market run' });
    const hist = await api().get(`/api/transactions/${t.id}/history`).set(s.h);
    const update = hist.body.data.find((e) => e.action === 'transaction.updated');
    expect(update.metadata.changes.amount).toEqual({ from: '40.00', to: '45.50' });
    expect(update.metadata.changes.description).toEqual({ from: 'Test', to: 'Market run' });
    expect(hist.body.data.map((e) => e.action)).toContain('transaction.created');
  });
});

describe('search, filters, summary and export', () => {
  let s;
  beforeEach(async () => {
    s = await setup();
    const bank = await s.account({ name: 'Bank' });
    const cash = await s.account({ name: 'Cash', type: 'cash' });
    s.bank = bank;
    await s.tx({ type: 'income', accountId: bank.id, categoryId: s.cat('income', 'salary'), amount: '3000', date: '2026-11-01', description: 'November salary' });
    await s.tx({ type: 'expense', accountId: bank.id, categoryId: s.cat('expense', 'housing'), amount: '1200', date: '2026-11-02', description: 'Rent', payee: 'Landlord' });
    await s.tx({ type: 'expense', accountId: cash.id, categoryId: s.cat('expense', 'food'), amount: '300', date: '2026-11-03', description: 'Makola market' });
    await s.tx({ type: 'expense', accountId: cash.id, categoryId: s.cat('expense', 'food'), amount: '100', date: '2026-10-28', description: 'October groceries' });
    await s.tx({ type: 'transfer', accountId: bank.id, toAccountId: cash.id, amount: '500', date: '2026-11-04', description: 'ATM withdrawal' });
  });

  it('filters by type, account, date range and text', async () => {
    const q = (qs) => api().get(`/api/transactions?${qs}`).set(s.h);
    expect((await q('type=expense')).body.meta.total).toBe(3);
    expect((await q(`accountId=${s.bank.id}`)).body.meta.total).toBe(3);
    expect((await q('from=2026-11-01&to=2026-11-30')).body.meta.total).toBe(4);
    expect((await q('q=landlord')).body.data[0].description).toBe('Rent');
    expect((await q('q=.*')).body.meta.total).toBe(0); // regex characters are literal
    const page = await q('limit=2&page=2');
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ page: 2, total: 5, pages: 3 });
  });

  it('summarises income and spending for a period, excluding transfers', async () => {
    const res = await api().get('/api/transactions/summary?from=2026-11-01&to=2026-11-30').set(s.h);
    expect(res.body.data).toMatchObject({ currency: 'GHS', income: '3000.00', expense: '1500.00', net: '1500.00', expenseCount: 2 });
    const top = res.body.data.expenseByCategory[0];
    expect(top).toMatchObject({ name: 'Housing', amount: '1200.00', share: '80.0' });
  });

  it('serves the dashboard in one call', async () => {
    const res = await api().get('/api/analytics/dashboard?from=2026-11-01&to=2026-11-30').set(s.h).expect(200);
    expect(res.body.data.summary.net).toBe('1500.00');
    expect(res.body.data.accounts.map((a) => a.balance)).toEqual(['1300.00', '100.00']);
    expect(res.body.data.recent.length).toBeGreaterThan(0);
  });

  it('exports CSV with signed amounts and rate details', async () => {
    const res = await api().get('/api/transactions/export.csv?from=2026-11-01').set(s.h).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.trim().split('\r\n');
    expect(lines).toHaveLength(5);
    expect(lines.find((l) => l.includes('Rent'))).toContain('-1200.00,GHS');
  });
});

describe('workspace isolation and permissions', () => {
  it('cannot read or use another workspace’s accounts, categories or transactions', async () => {
    const a = await setup();
    const b = await setup();
    const bAcc = await b.account({ name: 'B bank' });
    const bTx = (await b.tx({ type: 'expense', accountId: bAcc.id, categoryId: b.cat('expense', 'food'), amount: '5' })).body.data;

    await api().get(`/api/accounts/${bAcc.id}`).set(a.h).expect(404);
    await api().get(`/api/transactions/${bTx.id}`).set(a.h).expect(404);
    await api().patch(`/api/transactions/${bTx.id}`).set(a.h).send({ notes: 'x' }).expect(404);
    // Using B's account or category from A's workspace is rejected.
    const aAcc = await a.account({ name: 'A bank' });
    await a.tx({ type: 'expense', accountId: bAcc.id, categoryId: a.cat('expense', 'food'), amount: '5' }).expect(422);
    await a.tx({ type: 'expense', accountId: aAcc.id, categoryId: b.cat('expense', 'food'), amount: '5' }).expect(422);
    // Switching the header to B's workspace is refused for A.
    await api().get('/api/transactions').set({ ...a.auth, 'X-Workspace-Id': b.ws }).expect(404);
    expect((await api().get('/api/transactions').set(a.h)).body.meta.total).toBe(0);
  });

  it('viewers can read but not write', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const ws = (await api().post('/api/workspaces').set(owner.auth).send({ name: 'Shop', type: 'business', baseCurrency: 'GHS' })).body.data;
    await api().post(`/api/workspaces/${ws.id}/invitations`).set(owner.auth).send({ email: viewer.email, role: 'viewer' });
    await api().post('/api/workspaces/invitations/accept').set(viewer.auth).send({ token: tokenFromEmail(viewer.email, '/invitations/accept') }).expect(200);

    const oh = { ...owner.auth, 'X-Workspace-Id': ws.id };
    const vh = { ...viewer.auth, 'X-Workspace-Id': ws.id };
    const acc = (await api().post('/api/accounts').set(oh).send({ name: 'Till', type: 'cash', currency: 'GHS' })).body.data;
    await api().get('/api/accounts').set(vh).expect(200);
    await api().post('/api/accounts').set(vh).send({ name: 'Mine', type: 'cash', currency: 'GHS' }).expect(403);
    const cats = (await api().get('/api/categories').set(vh)).body.data;
    await api()
      .post('/api/transactions')
      .set(vh)
      .send({ type: 'income', accountId: acc.id, categoryId: cats.find((c) => c.kind === 'income').id, amount: '1', date: '2026-11-01', description: 'x' })
      .expect(403);
    await api().post('/api/exchange-rates').set(vh).send({ from: 'USD', to: 'GHS', rate: '15', effectiveDate: '2026-11-01' }).expect(403);
  });

  it('only admins can unlock a reconciled transaction', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const ws = (await api().post('/api/workspaces').set(owner.auth).send({ name: 'Shop', type: 'business', baseCurrency: 'GHS' })).body.data;
    await api().post(`/api/workspaces/${ws.id}/invitations`).set(owner.auth).send({ email: member.email, role: 'member' });
    await api().post('/api/workspaces/invitations/accept').set(member.auth).send({ token: tokenFromEmail(member.email, '/invitations/accept') });
    const mh = { ...member.auth, 'X-Workspace-Id': ws.id };
    const acc = (await api().post('/api/accounts').set(mh).send({ name: 'Till', type: 'cash', currency: 'GHS' })).body.data;
    const cats = (await api().get('/api/categories').set(mh)).body.data;
    const t = (await api().post('/api/transactions').set(mh).send({ type: 'income', accountId: acc.id, categoryId: cats.find((c) => c.kind === 'income').id, amount: '1', date: '2026-11-01', description: 'Sale' })).body.data;
    await api().post(`/api/transactions/${t.id}/reconcile`).set(mh).expect(200);
    await api().post(`/api/transactions/${t.id}/unreconcile`).set(mh).expect(403);
    await api().post(`/api/transactions/${t.id}/unreconcile`).set({ ...owner.auth, 'X-Workspace-Id': ws.id }).expect(200);
  });
});

describe('receipt attachments', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

  it('uploads, lists, downloads and removes a receipt', async () => {
    const s = await setup();
    const a = await s.account({ name: 'A' });
    const t = (await s.tx({ type: 'expense', accountId: a.id, categoryId: s.cat('expense', 'food'), amount: '5' })).body.data;

    const up = await api().post(`/api/transactions/${t.id}/attachments`).set(s.h).attach('file', pdf, { filename: '../../receipt.pdf', contentType: 'application/pdf' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.data).toMatchObject({ name: 'receipt.pdf', mimeType: 'application/pdf' });

    const tx = await api().get(`/api/transactions/${t.id}`).set(s.h);
    expect(tx.body.data.attachmentCount).toBe(1);

    const dl = await api().get(`/api/transactions/${t.id}/attachments/${up.body.data.id}`).set(s.h).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
    expect(Buffer.compare(dl.body, pdf)).toBe(0);

    await api().delete(`/api/transactions/${t.id}/attachments/${up.body.data.id}`).set(s.h).expect(200);
    expect((await api().get(`/api/transactions/${t.id}/attachments`).set(s.h)).body.data).toHaveLength(0);
  });

  it('rejects files that are not really images or PDFs', async () => {
    const s = await setup();
    const a = await s.account({ name: 'A' });
    const t = (await s.tx({ type: 'expense', accountId: a.id, categoryId: s.cat('expense', 'food'), amount: '5' })).body.data;
    const res = await api().post(`/api/transactions/${t.id}/attachments`).set(s.h).attach('file', Buffer.from('MZ\x90\0fake exe'), { filename: 'receipt.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(415);
  });

  it('does not serve another workspace’s receipts', async () => {
    const a = await setup();
    const b = await setup();
    const acc = await b.account({ name: 'B' });
    const t = (await b.tx({ type: 'expense', accountId: acc.id, categoryId: b.cat('expense', 'food'), amount: '5' })).body.data;
    const up = await api().post(`/api/transactions/${t.id}/attachments`).set(b.h).attach('file', pdf, 'r.pdf');
    await api().get(`/api/transactions/${t.id}/attachments/${up.body.data.id}`).set(a.h).expect(404);
  });
});
