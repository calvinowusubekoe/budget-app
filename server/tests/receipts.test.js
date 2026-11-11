import { afterEach, describe, expect, it } from 'vitest';
import { setAiClient } from '../modules/ai/ai.client.js';
import { AiUsage } from '../modules/ai/ai.models.js';
import { Transaction } from '../modules/transactions/transaction.model.js';
import { addDays, todayIn } from '../utils/periods.js';
import { api, registerUser, tokenFromEmail } from './helpers.js';

const TODAY = todayIn('Africa/Accra');
// Smallest files that pass the content check: a PNG signature, and a PDF header.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake image body')]);
const PDF = Buffer.from('%PDF-1.4\n%fake\n');

function fakeReader(reading, extra = {}) {
  const calls = [];
  setAiClient({
    beta: {
      messages: {
        create: async (req) => {
          calls.push(req);
          return { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reading) }], usage: { input_tokens: 1500, output_tokens: 120 }, ...extra };
        },
      },
    },
  });
  return calls;
}
afterEach(() => setAiClient(null));

const reading = (over = {}) => ({
  isFinancialDocument: true,
  documentKind: 'mobile_money',
  type: 'expense',
  amount: '1,250.50',
  currency: 'GHS',
  date: TODAY,
  counterparty: 'Melcom Accra Mall',
  description: 'Chest freezer',
  reference: 'MP241111.1530.C12345',
  fees: '12.51',
  suggestedCategory: 'Housing',
  warnings: [],
  ...over,
});

async function personal() {
  const u = await registerUser({ name: 'Ama Owner' });
  const h = { ...u.auth, 'X-Workspace-Id': u.user.lastWorkspaceId };
  await api().post('/api/ai/consent').set(u.auth).expect(200);
  return { ...u, h };
}
const scan = (h, file = PNG, name = 'momo.png') => api().post('/api/ai/receipts/scan').set(h).attach('file', file, name);

describe('receipt scanning', () => {
  it('sends the image to the model and returns a checked draft, saving nothing', async () => {
    const s = await personal();
    const calls = fakeReader(reading());
    const before = await Transaction.countDocuments();
    const res = await scan(s.h).expect(200);
    expect(res.body.data).toMatchObject({
      kind: 'ai_suggestion',
      draft: { type: 'expense', amount: '1250.50', currency: 'GHS', date: TODAY, counterparty: 'Melcom Accra Mall', reference: 'MP241111.1530.C12345', fees: '12.51', categoryName: 'Housing' },
      possibleDuplicates: [],
    });
    expect(res.body.data.draft.categoryId).toMatch(/^[a-f0-9]{24}$/);
    expect(await Transaction.countDocuments()).toBe(before);

    const req = calls[0];
    expect(req.tools).toBeUndefined();
    expect(req.output_config.format.type).toBe('json_schema');
    expect(req.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
    expect(req.messages[0].content[1].text).toContain('"Housing"');
    expect(await AiUsage.countDocuments({ feature: 'scan' })).toBe(1);
  });

  it('sends PDFs as documents', async () => {
    const s = await personal();
    const calls = fakeReader(reading());
    await scan(s.h, PDF, 'receipt.pdf').expect(200);
    expect(calls[0].messages[0].content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
  });

  it('drops anything that fails the normal rules instead of fixing it', async () => {
    const s = await personal();
    fakeReader(reading({ amount: '12.345', currency: 'CEDIS', date: addDays(TODAY, 3), suggestedCategory: 'Not a real category', type: 'refund' }));
    const { draft, warnings } = (await scan(s.h).expect(200)).body.data;
    expect(draft).toMatchObject({ amount: null, currency: null, date: null, categoryId: null, type: null });
    expect(warnings.join(' ')).toMatch(/amount couldn’t be read/);
    expect(warnings.join(' ')).toMatch(/in the future/);
    expect(warnings.join(' ')).toMatch(/currency "CEDIS"/);
  });

  it('warns when the image is not a receipt', async () => {
    const s = await personal();
    fakeReader(reading({ isFinancialDocument: false, amount: null, warnings: ['It is a photo of a cat.'] }));
    const { warnings } = (await scan(s.h).expect(200)).body.data;
    expect(warnings[0]).toMatch(/doesn’t look like a receipt/);
    expect(warnings).toContain('It is a photo of a cat.');
  });

  it('points out a transaction that may already be recorded', async () => {
    const s = await personal();
    const acc = (await api().post('/api/accounts').set(s.h).send({ name: 'MoMo', type: 'mobile_money', currency: 'GHS' })).body.data;
    const cats = (await api().get('/api/categories').set(s.h)).body.data;
    await api().post('/api/transactions').set(s.h).send({ type: 'expense', accountId: acc.id, categoryId: cats.find((c) => c.kind === 'expense').id, amount: '1250.50', date: TODAY, description: 'Freezer' }).expect(201);
    fakeReader(reading());
    const { possibleDuplicates } = (await scan(s.h).expect(200)).body.data;
    expect(possibleDuplicates).toEqual([expect.objectContaining({ description: 'Freezer', amount: '1250.50' })]);
  });

  it('needs AI consent, a readable file, and stays within the plan', async () => {
    const s = await personal();
    fakeReader(reading());
    await api().delete('/api/ai/consent').set(s.auth).expect(200);
    expect((await scan(s.h).expect(403)).body.error.code).toBe('AI_CONSENT_REQUIRED');
    await api().post('/api/ai/consent').set(s.auth).expect(200);
    await scan(s.h, Buffer.from('MZ\x90 not an image'), 'x.png').expect(415);
    const ws = s.user.lastWorkspaceId;
    await AiUsage.insertMany(Array.from({ length: 10 }, () => ({ workspaceId: ws, userId: s.user.id, model: 'x', feature: 'scan', outcome: 'answered' })));
    expect((await scan(s.h).expect(403)).body.error.code).toBe('PLAN_LIMIT');
    // Scans and questions have separate allowances.
    const status = (await api().get('/api/ai/status').set(s.h)).body.data;
    expect(status).toMatchObject({ usage: { used: 0, limit: 20 }, scans: { used: 10, limit: 10 } });
  });

  it('is unavailable without the AI provider, and asks people to agree again after the consent change', async () => {
    const s = await registerUser();
    const h = { ...s.auth, 'X-Workspace-Id': s.user.lastWorkspaceId };
    expect((await scan(h).expect(409)).body.error.code).toBe('AI_NOT_CONFIGURED');
  });

  it('turns a refusal into a plain message', async () => {
    const s = await personal();
    fakeReader({}, { stop_reason: 'refusal', content: [] });
    expect((await scan(s.h).expect(422)).body.error.code).toBe('SCAN_REFUSED');
  });
});

describe('receipts on invoice payments', () => {
  it('counts receipts attached to a payment’s linked transaction', async () => {
    const u = await registerUser({ name: 'Kwame Owner' });
    const ws = (await api().post('/api/workspaces').set(u.auth).send({ name: 'Shop', type: 'business', baseCurrency: 'GHS', business: { legalName: 'Shop Ltd' } })).body.data;
    const h = { ...u.auth, 'X-Workspace-Id': ws.id };
    const bank = (await api().post('/api/accounts').set(h).send({ name: 'Bank', type: 'bank', currency: 'GHS' })).body.data;
    const customer = (await api().post('/api/business/customers').set(h).send({ name: 'Osu Builders' })).body.data;
    const inv = (await api().post('/api/business/invoices').set(h).send({ partyId: customer.id, issueDate: TODAY, dueDate: addDays(TODAY, 7), lines: [{ description: 'Bags', quantity: '1', unitPrice: '100' }], issue: true }).expect(201)).body.data;
    const paid = (await api().post(`/api/business/invoices/${inv.id}/payments`).set(h).send({ amount: '40', date: TODAY, accountId: bank.id }).expect(201)).body.data;
    const payment = paid.payments[0];
    expect(payment.receiptCount).toBe(0);
    await api().post(`/api/transactions/${payment.transactionId}/attachments`).set(h).attach('file', PNG, 'momo-receipt.png').expect(201);
    const again = (await api().get(`/api/business/invoices/${inv.id}`).set(h)).body.data;
    expect(again.payments[0].receiptCount).toBe(1);
  });
});

describe('proof on Group Susu records', () => {
  const G = '/api/susu/groups';
  async function group() {
    const org = await registerUser({ name: 'Abena Organiser' });
    const kofi = await registerUser({ name: 'Kofi Mensah' });
    const esi = await registerUser({ name: 'Esi Boateng' });
    const g = (await api().post(G).set(org.auth).send({ name: 'Makola Susu', currency: 'GHS', contributionAmount: '100', frequency: 'weekly', startDate: addDays(TODAY, -14) }).expect(201)).body.data;
    for (const [u, name] of [[kofi, 'Kofi'], [esi, 'Esi']]) {
      await api().post(`${G}/${g.id}/invitations`).set(org.auth).send({ email: u.email, displayName: name }).expect(201);
      await api().post(`/api/susu/invitations/${tokenFromEmail(u.email, '/susu/invitations/accept')}/accept`).set(u.auth).expect(200);
    }
    const members = (await api().get(`${G}/${g.id}/members`).set(org.auth)).body.data;
    const id = (n) => members.find((m) => m.displayName.startsWith(n)).id;
    const cycles = (await api().post(`${G}/${g.id}/cycles`).set(org.auth).send({ generate: true }).expect(201)).body.data;
    return { org, kofi, esi, g, id, cycles };
  }

  it('lets the member or a manager add a screenshot, records it, and keeps it private like the record', async () => {
    const s = await group();
    const rec = (await api().post(`${G}/${s.g.id}/cycles/${s.cycles[0].id}/contributions`).set(s.org.auth).send({ memberId: s.id('Kofi'), amount: '100', date: TODAY }).expect(201)).body.data;
    expect(rec.proof).toBeNull();

    // Esi isn't the member, the recorder or a manager.
    await api().post(`${G}/${s.g.id}/contributions/${rec.id}/proof`).set(s.esi.auth).attach('file', PNG, 'x.png').expect(403);
    const up = await api().post(`${G}/${s.g.id}/contributions/${rec.id}/proof`).set(s.kofi.auth).attach('file', PNG, 'momo.png').expect(200);
    expect(up.body.data.proof).toMatchObject({ name: 'momo.png', mimeType: 'image/png' });
    expect(up.body.data.events.at(-1).type).toBe('proof_attached');

    const file = await api().get(`${G}/${s.g.id}/contributions/${rec.id}/proof`).set(s.org.auth).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['content-security-policy']).toMatch(/sandbox/);
    await api().get(`${G}/${s.g.id}/contributions/${rec.id}/proof`).set(s.kofi.auth).expect(200);
    // Members only see their own contributions, so not the proof either.
    await api().get(`${G}/${s.g.id}/contributions/${rec.id}/proof`).set(s.esi.auth).expect(404);
    const outsider = await registerUser();
    await api().get(`${G}/${s.g.id}/contributions/${rec.id}/proof`).set(outsider.auth).expect(404);

    const activity = (await api().get(`${G}/${s.g.id}/activity`).set(s.org.auth)).body.data;
    expect(activity.some((a) => a.action === 'contribution.proof_attached')).toBe(true);
  });

  it('adds proof to payouts, visible to every member', async () => {
    const s = await group();
    const cycle = s.cycles[0];
    const payout = (await api().post(`${G}/${s.g.id}/cycles/${cycle.id}/payouts`).set(s.org.auth).send({ actualAmount: '300', payoutDate: TODAY, confirmationDetails: 'MoMo ref 123' }).expect(201)).body.data;
    await api().post(`${G}/${s.g.id}/payouts/${payout.id}/proof`).set(s.org.auth).attach('file', PDF, 'transfer.pdf').expect(200);
    await api().get(`${G}/${s.g.id}/payouts/${payout.id}/proof`).set(s.esi.auth).expect(200);
  });
});
