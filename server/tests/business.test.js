import { describe, expect, it } from 'vitest';
import { computeLines } from '../modules/business/lines.js';
import { money } from '../modules/business/pdf.js';
import { addDays, todayIn } from '../utils/periods.js';
import { api, registerUser } from './helpers.js';

const TODAY = todayIn('Africa/Accra');
const B = '/api/business';

async function setup() {
  const u = await registerUser({ name: 'Kwame Owner' });
  const ws = (await api().post('/api/workspaces').set(u.auth).send({ name: 'Kwame Hardware', type: 'business', baseCurrency: 'GHS', business: { legalName: 'Kwame Hardware Ltd' } })).body.data;
  const h = { ...u.auth, 'X-Workspace-Id': ws.id };
  const bank = (await api().post('/api/accounts').set(h).send({ name: 'Business current', type: 'bank', currency: 'GHS', openingBalance: '1000' })).body.data;
  const customer = (await api().post(`${B}/customers`).set(h).send({ name: 'Osu Builders', email: 'accounts@osu.example' }).expect(201)).body.data;
  const supplier = (await api().post(`${B}/suppliers`).set(h).send({ name: 'Tema Cement' }).expect(201)).body.data;
  const invoice = (body = {}) =>
    api()
      .post(`${B}/invoices`)
      .set(h)
      .send({ partyId: customer.id, issueDate: TODAY, dueDate: addDays(TODAY, 14), lines: [{ description: 'Cement bags', quantity: '10', unitPrice: '95.50', taxRate: '15' }, { description: 'Delivery', quantity: '1', unitPrice: '50' }], ...body });
  return { ...u, ws, h, bank, customer, supplier, invoice };
}

describe('line maths', () => {
  it('rounds each line, then totals the rounded lines', () => {
    const r = computeLines([{ description: 'a', quantity: '3', unitPrice: '0.333', taxRate: null }], 'BHD');
    expect(r).toMatchObject({ subtotal: '0.999', total: '0.999' });
    const t = computeLines(
      [
        { description: 'a', quantity: '2.5', unitPrice: '10.01', taxRate: '12.5' },
        { description: 'b', quantity: '1', unitPrice: '0.05', taxRate: '15' },
      ],
      'GHS',
    );
    // 25.025 → 25.03; tax 3.12875 → 3.13. 0.05 tax 0.0075 → 0.01.
    expect(t.lines.map((l) => [l.amount, l.tax])).toEqual([
      ['25.03', '3.13'],
      ['0.05', '0.01'],
    ]);
    expect(t).toMatchObject({ subtotal: '25.08', taxTotal: '3.14', total: '28.22' });
  });

  it('formats PDF amounts with codes and grouping, without floats', () => {
    expect(money('1234567.50', 'GHS')).toBe('GHS 1,234,567.50');
    expect(money('-12.00', 'USD')).toBe('-USD 12.00');
  });
});

describe('business workspaces only', () => {
  it('refuses business tools in a personal workspace', async () => {
    const u = await registerUser();
    const h = { ...u.auth, 'X-Workspace-Id': u.user.lastWorkspaceId };
    await api().get(`${B}/invoices`).set(h).expect(400);
    await api().get(`/api/analytics/business?from=${TODAY}&to=${TODAY}`).set(h).expect(400);
  });
});

describe('invoices', () => {
  it('numbers invoices per workspace and computes totals on the server', async () => {
    const s = await setup();
    const a = (await s.invoice().expect(201)).body.data;
    const b = (await s.invoice().expect(201)).body.data;
    expect([a.number, b.number]).toEqual(['INV-0001', 'INV-0002']);
    // 10 × 95.50 = 955.00, tax 143.25; + 50.00 → subtotal 1005.00, tax 143.25, total 1148.25
    expect(a).toMatchObject({ subtotal: '1005.00', taxTotal: '143.25', total: '1148.25', status: 'draft', displayStatus: 'draft', balance: '1148.25' });

    const preview = await api().post(`${B}/documents/preview`).set(s.h).send({ lines: [{ description: 'x', quantity: '3', unitPrice: '33.33', taxRate: '2.5' }] }).expect(200);
    expect(preview.body.data).toMatchObject({ subtotal: '99.99', taxTotal: '2.50', total: '102.49' });
  });

  it('records payments as real income in an account, and tracks the balance to paid', async () => {
    const s = await setup();
    const inv = (await s.invoice({ issue: true })).body.data;
    expect(inv.displayStatus).toBe('open');

    const p1 = await api().post(`${B}/invoices/${inv.id}/payments`).set(s.h).send({ amount: '500', date: TODAY, accountId: s.bank.id }).expect(201);
    expect(p1.body.data).toMatchObject({ paid: '500.00', balance: '648.25', displayStatus: 'partially_paid' });
    await api().post(`${B}/invoices/${inv.id}/payments`).set(s.h).send({ amount: '648.26', date: TODAY, accountId: s.bank.id }).expect(422);
    const p2 = await api().post(`${B}/invoices/${inv.id}/payments`).set(s.h).send({ amount: '648.25', date: TODAY, accountId: s.bank.id }).expect(201);
    expect(p2.body.data).toMatchObject({ balance: '0.00', displayStatus: 'paid' });

    // The bank account and the income totals reflect what was received.
    expect((await api().get(`/api/accounts/${s.bank.id}`).set(s.h)).body.data.balance).toBe('2148.25');
    const sum = (await api().get(`/api/transactions/summary?from=${TODAY}&to=${TODAY}`).set(s.h)).body.data;
    expect(sum.income).toBe('1148.25');
    expect(sum.incomeByCategory[0].name).toBe('Business revenue');
    const txs = (await api().get('/api/transactions?type=income').set(s.h)).body.data;
    expect(txs[0]).toMatchObject({ invoiceId: inv.id, description: 'Invoice INV-0001, Osu Builders' });
  });

  it('keeps linked transactions in step: they can only change through the invoice', async () => {
    const s = await setup();
    const inv = (await s.invoice({ issue: true })).body.data;
    const paid = (await api().post(`${B}/invoices/${inv.id}/payments`).set(s.h).send({ amount: '100', date: TODAY, accountId: s.bank.id })).body.data;
    const txId = paid.payments[0].transactionId;
    await api().patch(`/api/transactions/${txId}`).set(s.h).send({ amount: '1' }).expect(409);
    await api().delete(`/api/transactions/${txId}`).set(s.h).send({}).expect(409);

    // Contents lock once paid; void needs payments removed first.
    await api().patch(`${B}/invoices/${inv.id}`).set(s.h).send({ notes: 'x' }).expect(409);
    await api().post(`${B}/invoices/${inv.id}/void`).set(s.h).send({ reason: 'Customer cancelled' }).expect(409);

    const removed = await api().delete(`${B}/invoices/${inv.id}/payments/${paid.payments[0].id}`).set(s.h).send({ reason: 'Cheque bounced' }).expect(200);
    expect(removed.body.data).toMatchObject({ paid: '0.00', displayStatus: 'open' });
    expect(removed.body.data.payments[0]).toMatchObject({ removed: true, removeReason: 'Cheque bounced' });
    expect((await api().get(`/api/accounts/${s.bank.id}`).set(s.h)).body.data.balance).toBe('1000.00');
    await api().get(`/api/transactions/${txId}`).set(s.h).expect(404);

    await api().post(`${B}/invoices/${inv.id}/void`).set(s.h).send({ reason: 'Customer cancelled' }).expect(200);
    await api().post(`${B}/invoices/${inv.id}/payments`).set(s.h).send({ amount: '1', date: TODAY, accountId: s.bank.id }).expect(400);
  });

  it('won’t take payments on drafts, into other currencies, or into other workspaces’ accounts', async () => {
    const s = await setup();
    const other = await setup();
    const draft = (await s.invoice()).body.data;
    await api().post(`${B}/invoices/${draft.id}/payments`).set(s.h).send({ amount: '1', date: TODAY, accountId: s.bank.id }).expect(400);
    await api().post(`${B}/invoices/${draft.id}/issue`).set(s.h).expect(200);
    const usd = (await api().post('/api/accounts').set(s.h).send({ name: 'USD', type: 'bank', currency: 'USD' })).body.data;
    await api().post(`${B}/invoices/${draft.id}/payments`).set(s.h).send({ amount: '1', date: TODAY, accountId: usd.id }).expect(422);
    await api().post(`${B}/invoices/${draft.id}/payments`).set(s.h).send({ amount: '1', date: TODAY, accountId: other.bank.id }).expect(422);
    await api().get(`${B}/invoices/${draft.id}`).set(other.h).expect(404);
  });

  it('flags overdue invoices and edits drafts freely', async () => {
    const s = await setup();
    const inv = (await s.invoice({ issueDate: addDays(TODAY, -40), dueDate: addDays(TODAY, -10), issue: true })).body.data;
    expect(inv).toMatchObject({ displayStatus: 'overdue', daysOverdue: 10 });
    const draft = (await s.invoice()).body.data;
    const edited = await api().patch(`${B}/invoices/${draft.id}`).set(s.h).send({ lines: [{ description: 'Paint', quantity: '4', unitPrice: '120' }] }).expect(200);
    expect(edited.body.data).toMatchObject({ total: '480.00', taxTotal: '0.00' });
    await s.invoice({ dueDate: addDays(TODAY, -1) }).expect(422);
    const list = (await api().get(`${B}/invoices?status=overdue`).set(s.h)).body.data;
    expect(list.map((i) => i.number)).toEqual([inv.number]);
  });

  it('renders a PDF', async () => {
    const s = await setup();
    const inv = (await s.invoice({ issue: true })).body.data;
    const res = await api()
      .get(`${B}/invoices/${inv.id}/pdf`)
      .set(s.h)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('bills', () => {
  it('records bill payments as expenses', async () => {
    const s = await setup();
    const bill = (
      await api()
        .post(`${B}/bills`)
        .set(s.h)
        .send({ partyId: s.supplier.id, reference: 'TC-8812', issueDate: TODAY, dueDate: addDays(TODAY, 30), lines: [{ description: 'Cement, 40 bags', quantity: '40', unitPrice: '80' }], issue: true })
        .expect(201)
    ).body.data;
    expect(bill).toMatchObject({ number: 'BILL-0001', reference: 'TC-8812', total: '3200.00' });
    await api().post(`${B}/bills/${bill.id}/payments`).set(s.h).send({ amount: '800', date: TODAY, accountId: s.bank.id }).expect(201);
    expect((await api().get(`/api/accounts/${s.bank.id}`).set(s.h)).body.data.balance).toBe('200.00');
    const sum = (await api().get(`/api/transactions/summary?from=${TODAY}&to=${TODAY}`).set(s.h)).body.data;
    expect(sum.expenseByCategory[0]).toMatchObject({ name: 'Business expenses', amount: '800.00' });
  });
});

describe('contacts', () => {
  it('shows what each customer owes and only archives contacts with history', async () => {
    const s = await setup();
    const inv = (await s.invoice({ issue: true })).body.data;
    await api().post(`${B}/invoices/${inv.id}/payments`).set(s.h).send({ amount: '148.25', date: TODAY, accountId: s.bank.id });
    const customers = (await api().get(`${B}/customers`).set(s.h)).body.data;
    expect(customers[0].outstanding).toEqual([{ currency: 'GHS', amount: '1000.00' }]);
    await api().delete(`${B}/customers/${s.customer.id}`).set(s.h).expect(409);
    await api().patch(`${B}/customers/${s.customer.id}`).set(s.h).send({ status: 'archived' }).expect(200);
    await s.invoice().expect(422); // archived customers can't get new invoices
    const fresh = (await api().post(`${B}/suppliers`).set(s.h).send({ name: 'Unused' })).body.data;
    await api().delete(`${B}/suppliers/${fresh.id}`).set(s.h).expect(200);
  });
});

describe('reports', () => {
  it('profit and loss on a cash basis, compared with the previous period', async () => {
    const s = await setup();
    const inv = (await s.invoice({ issue: true })).body.data;
    await api().post(`${B}/invoices/${inv.id}/payments`).set(s.h).send({ amount: '1148.25', date: TODAY, accountId: s.bank.id });
    const cats = (await api().get('/api/categories?kind=expense').set(s.h)).body.data;
    await api().post('/api/transactions').set(s.h).send({ type: 'expense', accountId: s.bank.id, categoryId: cats.find((c) => c.systemKey === 'utilities').id, amount: '148.25', date: TODAY, description: 'ECG' });
    // An unpaid invoice doesn't count as income on a cash basis.
    await s.invoice({ issue: true });

    const pl = (await api().get(`${B}/reports/profit-loss?from=${TODAY}&to=${TODAY}`).set(s.h).expect(200)).body.data;
    expect(pl).toMatchObject({ basis: 'cash', currency: 'GHS', netProfit: '1000.00', margin: '87.1', income: { total: '1148.25' }, expenses: { total: '148.25' }, previous: { income: '0.00' } });
    expect(pl.note).toMatch(/Not a certified/);
    const csv = await api().get(`${B}/reports/profit-loss?from=${TODAY}&to=${TODAY}&format=csv`).set(s.h).expect(200);
    expect(csv.text).toContain('Net profit,,1000.00');
    const pdf = await api().get(`${B}/reports/profit-loss?from=${TODAY}&to=${TODAY}&format=pdf`).set(s.h).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('cash flow by month and receivables by age', async () => {
    const s = await setup();
    const old = (await s.invoice({ issueDate: addDays(TODAY, -80), dueDate: addDays(TODAY, -45), issue: true })).body.data;
    await s.invoice({ issue: true });
    await api().post(`${B}/invoices/${old.id}/payments`).set(s.h).send({ amount: '148.25', date: TODAY, accountId: s.bank.id });

    const ar = (await api().get(`${B}/reports/receivables`).set(s.h)).body.data;
    expect(ar.totals[0]).toMatchObject({ currency: 'GHS', total: '2148.25', current: '1148.25', d31_60: '1000.00', count: 2 });
    expect(ar.items[0]).toMatchObject({ number: old.number, daysOverdue: 45, bucket: 'd31_60' });

    const from = `${TODAY.slice(0, 7)}-01`;
    const cf = (await api().get(`${B}/reports/cash-flow?from=${from}&to=${TODAY}`).set(s.h)).body.data;
    expect(cf.months).toHaveLength(1);
    expect(cf.months[0]).toMatchObject({ inflow: '148.25', outflow: '0.00', net: '148.25' });

    const overview = (await api().get(`/api/analytics/business?from=${from}&to=${TODAY}`).set(s.h)).body.data;
    expect(overview).toMatchObject({ overdueInvoices: 1 });
  });

  it('viewers can read but not create', async () => {
    const s = await setup();
    const viewer = await registerUser();
    await api().post(`/api/workspaces/${s.ws.id}/invitations`).set(s.auth).send({ email: viewer.email, role: 'viewer' });
    const { tokenFromEmail } = await import('./helpers.js');
    await api().post('/api/workspaces/invitations/accept').set(viewer.auth).send({ token: tokenFromEmail(viewer.email, '/invitations/accept') });
    const vh = { ...viewer.auth, 'X-Workspace-Id': s.ws.id };
    await api().get(`${B}/customers`).set(vh).expect(200);
    await api().post(`${B}/customers`).set(vh).send({ name: 'x' }).expect(403);
  });
});
