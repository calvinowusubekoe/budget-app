import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Payment, PaymentWebhookEvent } from '../modules/payments/payment.models.js';
import { reconcilePendingPayments } from '../modules/payments/payments.service.js';
import { Subscription } from '../modules/subscriptions/subscription.model.js';
import { addBillingPeriod, sweepSubscriptions } from '../modules/subscriptions/subscriptions.service.js';
import { effectivePlan } from '../modules/subscriptions/entitlements.js';
import { subscriptionsRouter } from '../modules/subscriptions/subscriptions.routes.js';
import { paymentWebhooksRouter } from '../modules/payments/webhooks.routes.js';
import { Notification } from '../modules/notifications/notification.model.js';
import { api, registerUser, tokenFromEmail } from './helpers.js';

const PAYSTACK_SECRET = 'sk_test_bfdummy'; // matches vitest.config.js
const FLW_HASH = 'test-webhook-hash-0123';
const S = '/api/subscriptions';
const DAY = 86_400_000;

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Stand-ins for the Paystack and Flutterwave APIs. Tests decide what each
 * provider "really" says about a payment; the server must take that, not
 * what a webhook body or the browser claims.
 */
let fake;
beforeEach(() => {
  fake = { paystack: new Map(), flw: new Map(), refunds: new Map(), calls: [], down: false, seq: 1000 };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(init.body) : null;
    fake.calls.push({ url, method: init.method ?? 'GET', body, auth: init.headers?.Authorization });
    if (fake.down) return json({ status: false, message: 'Service unavailable' }, 503);

    if (url === 'https://api.paystack.co/transaction/initialize') {
      fake.paystack.set(body.reference, { ...body, id: (fake.seq += 1), status: 'ongoing' });
      return json({ status: true, data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, reference: body.reference } });
    }
    let m = url.match(/^https:\/\/api\.paystack\.co\/transaction\/verify\/(.+)$/);
    if (m) {
      const tx = fake.paystack.get(decodeURIComponent(m[1]));
      if (!tx) return json({ status: false, message: 'Transaction reference not found' }, 400);
      return json({ status: true, data: { id: tx.id, reference: tx.reference, status: tx.status, amount: tx.paidAmount ?? tx.amount, currency: tx.paidCurrency ?? tx.currency, fees: 49, channel: 'mobile_money', paid_at: '2026-11-11T10:00:00.000Z', gateway_response: tx.status === 'failed' ? 'Declined' : 'Approved' } });
    }
    m = url.match(/^https:\/\/api\.paystack\.co\/refund\/(.+)$/);
    if (m) {
      const r = fake.refunds.get(m[1]);
      return r ? json({ status: true, data: r }) : json({ status: false }, 404);
    }
    if (url === 'https://api.flutterwave.com/v3/payments') {
      fake.flw.set(body.tx_ref, { ...body, id: (fake.seq += 1), status: 'pending' });
      return json({ status: 'success', data: { link: `https://checkout.flutterwave.com/pay/${body.tx_ref}` } });
    }
    m = url.match(/^https:\/\/api\.flutterwave\.com\/v3\/transactions\/verify_by_reference\?tx_ref=(.+)$/);
    if (m) {
      const tx = fake.flw.get(decodeURIComponent(m[1]));
      if (!tx) return json({ status: 'error', message: 'No transaction was found' }, 400);
      return json({ status: 'success', data: { id: tx.id, tx_ref: tx.tx_ref, status: tx.status, amount: tx.amount, currency: tx.currency, app_fee: 0.7, payment_type: 'mobilemoneygh', created_at: '2026-11-11T10:00:00.000Z' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

const paystackSig = (raw) => crypto.createHmac('sha512', PAYSTACK_SECRET).update(raw).digest('hex');
function paystackHook(event, data, { signature } = {}) {
  const raw = JSON.stringify({ event, data });
  return api().post('/api/payments/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', signature ?? paystackSig(raw)).send(raw);
}
const markPaid = (reference, extra = {}) => Object.assign(fake.paystack.get(reference), { status: 'success', ...extra });
const providerCalls = (re) => fake.calls.filter((c) => re.test(c.url)).length;

async function personal() {
  const u = await registerUser({ name: 'Efua Owner' });
  const h = { ...u.auth, 'X-Workspace-Id': u.user.lastWorkspaceId };
  return { ...u, h, ws: u.user.lastWorkspaceId };
}
const checkout = (h, body = {}, key) => {
  const r = api().post(`${S}/checkout`).set(h);
  if (key) r.set('Idempotency-Key', key);
  return r.send({ plan: 'personal_pro', billingPeriod: 'monthly', provider: 'paystack', ...body });
};
const current = async (h) => (await api().get(`${S}/current`).set(h).expect(200)).body.data;

describe('plans', () => {
  it('lists plans with configured prices as strings and the providers that are set up', async () => {
    const u = await personal();
    const res = await api().get(`${S}/plans`).set(u.auth).expect(200);
    const byKey = Object.fromEntries(res.body.data.plans.map((p) => [p.key, p]));
    expect(byKey.free.prices).toBeNull();
    expect(byKey.personal_pro.prices).toEqual({ monthly: '25.00', yearly: '250.00' });
    expect(byKey.business_pro.prices).toEqual({ monthly: '75.00', yearly: null }); // not configured → not on sale
    expect(byKey.free.limits.accounts).toBe(5);
    expect(res.body.data.providers.map((p) => p.key).sort()).toEqual(['flutterwave', 'paystack']);
    expect(res.body.data.providers.every((p) => p.testMode)).toBe(true);
  });

  it('starts every workspace on Free and enforces its limits on the server', async () => {
    const u = await personal();
    expect(await current(u.h)).toMatchObject({ plan: 'free', state: 'none', subscription: null });
    for (let i = 1; i <= 5; i += 1) await api().post('/api/accounts').set(u.h).send({ name: `A${i}`, type: 'cash', currency: 'GHS' }).expect(201);
    const res = await api().post('/api/accounts').set(u.h).send({ name: 'A6', type: 'cash', currency: 'GHS' }).expect(403);
    expect(res.body.error.code).toBe('PLAN_LIMIT');
    expect(res.body.error.message).toMatch(/Free plan includes 5 accounts/);
    expect((await current(u.h)).usage.accounts).toBe(5);
  });
});

describe('checkout', () => {
  it('creates a pending payment and a hosted checkout, without activating anything', async () => {
    const u = await personal();
    const res = await checkout(u.h).expect(201);
    expect(res.body.data.checkoutUrl).toMatch(/^https:\/\/checkout\.paystack\.com\//);
    expect(res.body.data.payment).toMatchObject({ status: 'pending', amount: '25.00', currency: 'GHS', plan: 'personal_pro' });

    const init = fake.calls.find((c) => c.url.endsWith('/transaction/initialize'));
    expect(init.body).toMatchObject({ amount: 2500, currency: 'GHS', email: u.email, reference: res.body.data.payment.reference });
    expect(init.auth).toBe(`Bearer ${PAYSTACK_SECRET}`);
    expect(init.body.callback_url).toMatch(/\/settings\/billing\?checkout=paystack$/);
    expect(await current(u.h)).toMatchObject({ plan: 'free' });
  });

  it('only sells the plan that matches the workspace type, and only at configured prices', async () => {
    const u = await personal();
    await checkout(u.h, { plan: 'business_pro' }).expect(400);
    const biz = (await api().post('/api/workspaces').set(u.auth).send({ name: 'Shop', type: 'business', baseCurrency: 'GHS', business: { legalName: 'Shop Ltd' } })).body.data;
    const res = await checkout({ ...u.auth, 'X-Workspace-Id': biz.id }, { plan: 'business_pro', billingPeriod: 'yearly' }).expect(409);
    expect(res.body.error.code).toBe('NOT_ON_SALE');
    await checkout({ ...u.auth, 'X-Workspace-Id': biz.id }, { plan: 'business_pro' }).expect(201);
  });

  it('lets only the owner buy or cancel; amounts come from server config, not the request', async () => {
    const owner = await personal();
    const biz = (await api().post('/api/workspaces').set(owner.auth).send({ name: 'Shop', type: 'business', baseCurrency: 'GHS', business: { legalName: 'Shop Ltd' } })).body.data;
    owner.h = { ...owner.auth, 'X-Workspace-Id': biz.id };
    const member = await registerUser({ name: 'Kojo Member' });
    await api().post(`/api/workspaces/${biz.id}/invitations`).set(owner.auth).send({ email: member.email, role: 'admin' }).expect(201);
    await api().post('/api/workspaces/invitations/accept').set(member.auth).send({ token: tokenFromEmail(member.email, '/invitations/accept') }).expect(200);
    const mh = { ...member.auth, 'X-Workspace-Id': biz.id };
    await checkout(mh, { plan: 'business_pro' }).expect(403);
    await api().post(`${S}/cancel`).set(mh).send({}).expect(403);
    await api().get(`${S}/history`).set(mh).expect(200); // admins can see history

    // A price in the request is ignored; the configured price is charged.
    const res = await checkout(owner.h, { plan: 'business_pro', amount: '0.01' }).expect(201);
    expect(res.body.data.payment.amount).toBe('75.00');
    expect(fake.calls.find((c) => c.url.endsWith('/transaction/initialize')).body.amount).toBe(7500);
  });

  it('reuses the checkout for a repeated Idempotency-Key', async () => {
    const u = await personal();
    const a = await checkout(u.h, {}, 'checkout-key-0001').expect(201);
    const b = await checkout(u.h, {}, 'checkout-key-0001').expect(201);
    expect(b.body.data.payment.reference).toBe(a.body.data.payment.reference);
    expect(providerCalls(/initialize/)).toBe(1);
    await checkout(u.h, { billingPeriod: 'yearly' }, 'checkout-key-0001').expect(409);
  });

  it('marks the payment failed when the provider is down, and changes nothing else', async () => {
    const u = await personal();
    fake.down = true;
    const res = await checkout(u.h).expect(502);
    expect(res.body.error.code).toBe('PROVIDER_UNAVAILABLE');
    const [p] = (await api().get(`${S}/history`).set(u.h)).body.data;
    expect(p).toMatchObject({ status: 'failed', checkoutUrl: null });
  });

  it('has no route that lets a user set a plan directly', async () => {
    const routes = subscriptionsRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
    expect(routes.sort()).toEqual(['get /current', 'get /history', 'get /plans', 'post /cancel', 'post /checkout', 'post /payments/:reference/check', 'post /resume'].sort());
    const u = await personal();
    await api().patch(`${S}/current`).set(u.h).send({ plan: 'personal_pro' }).expect(404);
  });
});

describe('verification', () => {
  it('ignores what the browser says: "check payment" asks the provider', async () => {
    const u = await personal();
    const ref = (await checkout(u.h).expect(201)).body.data.payment.reference;
    // Still open at the provider: nothing changes.
    let res = await api().post(`${S}/payments/${ref}/check`).set(u.h).send({ status: 'success' }).expect(200);
    expect(res.body.data.status).toBe('pending');
    expect((await current(u.h)).plan).toBe('free');

    markPaid(ref);
    res = await api().post(`${S}/payments/${ref}/check`).set(u.h).expect(200);
    expect(res.body.data).toMatchObject({ status: 'succeeded', fees: '0.49', methodType: 'mobile_money', reconciliationStatus: 'matched' });
    const cur = await current(u.h);
    expect(cur).toMatchObject({ plan: 'personal_pro', state: 'active', subscription: { status: 'active', billingPeriod: 'monthly', amount: '25.00' } });
    const start = new Date(cur.subscription.currentPeriodStart);
    expect(new Date(cur.subscription.currentPeriodEnd).getTime()).toBe(addBillingPeriod(start, 'monthly').getTime());

    // Limits are lifted.
    for (let i = 1; i <= 6; i += 1) await api().post('/api/accounts').set(u.h).send({ name: `A${i}`, type: 'cash', currency: 'GHS' }).expect(201);
    expect(await Notification.countDocuments({ type: 'subscription_activated' })).toBe(1);
  });

  it('rejects webhooks with a bad signature', async () => {
    const u = await personal();
    const ref = (await checkout(u.h)).body.data.payment.reference;
    markPaid(ref);
    await paystackHook('charge.success', { id: 1, reference: ref, status: 'success', amount: 2500 }, { signature: 'a'.repeat(128) }).expect(401);
    await api().post('/api/payments/webhooks/paystack').set('Content-Type', 'application/json').send('{}').expect(401);
    expect((await current(u.h)).plan).toBe('free');
    expect(await PaymentWebhookEvent.countDocuments()).toBe(0);
  });

  it('activates once from a signed webhook, re-verified with the provider; duplicates are ignored', async () => {
    const u = await personal();
    const ref = (await checkout(u.h)).body.data.payment.reference;
    markPaid(ref);
    const id = fake.paystack.get(ref).id;
    const first = await paystackHook('charge.success', { id, reference: ref, status: 'success', amount: 2500 }).expect(200);
    expect(first.body.data.duplicate).toBe(false);
    const end1 = (await current(u.h)).subscription.currentPeriodEnd;

    const again = await paystackHook('charge.success', { id, reference: ref, status: 'success', amount: 2500 }).expect(200);
    expect(again.body.data.duplicate).toBe(true);
    expect(providerCalls(/transaction\/verify/)).toBe(1);
    expect((await current(u.h)).subscription.currentPeriodEnd).toBe(end1);

    const p = await Payment.findOne({ reference: ref });
    expect(p.verification.webhookVerifiedAt).toBeTruthy();
    expect(p.verification.apiVerifiedAt).toBeTruthy();
    expect(p.providerTransactionId).toBe(String(id));
  });

  it("doesn't trust the webhook body: a payment the provider says is short goes to review", async () => {
    const u = await personal();
    const ref = (await checkout(u.h)).body.data.payment.reference;
    markPaid(ref, { paidAmount: 100 }); // the provider really received GHS 1.00
    await paystackHook('charge.success', { id: 5, reference: ref, status: 'success', amount: 2500 }).expect(200);
    const [p] = (await api().get(`${S}/history`).set(u.h)).body.data;
    expect(p).toMatchObject({ status: 'review', reconciliationStatus: 'mismatch' });
    expect((await current(u.h)).plan).toBe('free');
    expect(await Notification.countDocuments({ type: 'payment_review' })).toBe(1);
  });

  it('rejects a payment in the wrong currency', async () => {
    const u = await personal();
    const ref = (await checkout(u.h)).body.data.payment.reference;
    markPaid(ref, { paidCurrency: 'NGN' });
    await api().post(`${S}/payments/${ref}/check`).set(u.h).expect(200);
    expect((await current(u.h)).plan).toBe('free');
  });

  it('fails the webhook (so the provider retries) when verification is unavailable, then succeeds on retry', async () => {
    const u = await personal();
    const ref = (await checkout(u.h)).body.data.payment.reference;
    markPaid(ref);
    fake.down = true;
    await paystackHook('charge.success', { id: 7, reference: ref }).expect(502);
    expect((await current(u.h)).plan).toBe('free');
    fake.down = false;
    const retry = await paystackHook('charge.success', { id: 7, reference: ref }).expect(200);
    expect(retry.body.data.duplicate).toBe(false);
    expect((await current(u.h)).plan).toBe('personal_pro');
    expect((await PaymentWebhookEvent.findOne()).attempts).toBe(2);
  });

  it('records failed payments and allows another attempt', async () => {
    const u = await personal();
    const ref = (await checkout(u.h)).body.data.payment.reference;
    fake.paystack.get(ref).status = 'failed';
    const res = await api().post(`${S}/payments/${ref}/check`).set(u.h).expect(200);
    expect(res.body.data).toMatchObject({ status: 'failed', failureReason: 'Declined' });
    expect(await Notification.countDocuments({ type: 'payment_failed' })).toBe(1);
    await checkout(u.h).expect(201);
  });

  it('ignores signed webhooks for payments BudgetFlow did not start', async () => {
    await paystackHook('charge.success', { id: 99, reference: 'someone-elses-ref' }).expect(200);
    expect(await Payment.countDocuments()).toBe(0);
    expect(await Subscription.countDocuments()).toBe(0);
  });

  it('extends from the end of the paid period on early renewal', async () => {
    const u = await personal();
    const r1 = (await checkout(u.h)).body.data.payment.reference;
    markPaid(r1);
    await api().post(`${S}/payments/${r1}/check`).set(u.h).expect(200);
    const end1 = new Date((await current(u.h)).subscription.currentPeriodEnd);

    const r2 = (await checkout(u.h, { billingPeriod: 'yearly' })).body.data.payment.reference;
    markPaid(r2, { amount: 25000 });
    await api().post(`${S}/payments/${r2}/check`).set(u.h).expect(200);
    const sub = (await current(u.h)).subscription;
    expect(new Date(sub.currentPeriodEnd).getTime()).toBe(addBillingPeriod(end1, 'yearly').getTime());
    expect(sub.billingPeriod).toBe('yearly');
    const history = (await api().get(`${S}/history`).set(u.h)).body.data;
    expect(history.map((p) => p.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('settles payments whose webhook never arrived', async () => {
    const u = await personal();
    const ref = (await checkout(u.h)).body.data.payment.reference;
    markPaid(ref);
    expect(await reconcilePendingPayments(new Date())).toBe(0); // too recent to chase
    expect(await reconcilePendingPayments(new Date(Date.now() + 11 * 60_000))).toBe(1);
    expect((await current(u.h)).plan).toBe('personal_pro');
  });

  it('closes checkouts that were never finished after a day', async () => {
    const u = await personal();
    const ref = (await checkout(u.h)).body.data.payment.reference;
    await reconcilePendingPayments(new Date(Date.now() + 25 * 60 * 60_000));
    expect((await Payment.findOne({ reference: ref })).status).toBe('abandoned');
  });
});

describe('Flutterwave', () => {
  it('checks the verif-hash header, then verifies with Flutterwave before activating', async () => {
    const u = await personal();
    const res = await checkout(u.h, { provider: 'flutterwave' }).expect(201);
    const ref = res.body.data.payment.reference;
    expect(res.body.data.checkoutUrl).toMatch(/flutterwave/);
    const init = fake.calls.find((c) => c.url.endsWith('/v3/payments'));
    expect(init.body).toMatchObject({ tx_ref: ref, amount: 25, currency: 'GHS' });

    const tx = fake.flw.get(ref);
    tx.status = 'successful';
    const raw = JSON.stringify({ event: 'charge.completed', data: { id: tx.id, tx_ref: ref, status: 'successful', amount: 25 } });
    await api().post('/api/payments/webhooks/flutterwave').set('Content-Type', 'application/json').set('verif-hash', 'wrong-hash-value-000').send(raw).expect(401);
    expect((await current(u.h)).plan).toBe('free');
    await api().post('/api/payments/webhooks/flutterwave').set('Content-Type', 'application/json').set('verif-hash', FLW_HASH).send(raw).expect(200);
    const cur = await current(u.h);
    expect(cur).toMatchObject({ plan: 'personal_pro', subscription: { provider: 'flutterwave' } });
    const [p] = (await api().get(`${S}/history`).set(u.h)).body.data;
    expect(p).toMatchObject({ status: 'succeeded', fees: '0.70', methodType: 'mobilemoneygh' });
  });
});

describe('cancellation, expiry and refunds', () => {
  async function paid() {
    const u = await personal();
    const ref = (await checkout(u.h)).body.data.payment.reference;
    markPaid(ref);
    await api().post(`${S}/payments/${ref}/check`).set(u.h).expect(200);
    const sub = await Subscription.findOne({ workspaceId: u.ws });
    return { ...u, ref, sub, end: sub.currentPeriodEnd };
  }

  it('cancels at the end of the paid period, and can be kept before then', async () => {
    const u = await paid();
    let res = await api().post(`${S}/cancel`).set(u.h).send({ reason: 'Trying it out' }).expect(200);
    expect(res.body.data).toMatchObject({ cancelAtPeriodEnd: true, status: 'active', renewalDate: null });
    expect((await current(u.h)).state).toBe('ending');
    res = await api().post(`${S}/resume`).set(u.h).expect(200);
    expect(res.body.data.cancelAtPeriodEnd).toBe(false);

    await api().post(`${S}/cancel`).set(u.h).send({}).expect(200);
    await sweepSubscriptions(new Date(u.end.getTime() + 1000));
    expect((await Subscription.findById(u.sub._id)).status).toBe('cancelled');
    expect((await current(u.h)).plan).toBe('free');
    await api().post(`${S}/resume`).set(u.h).expect(409);
  });

  it('gives a grace period after the paid period ends, then moves to Free', async () => {
    const u = await paid();
    const sub = (await Subscription.findById(u.sub._id)).toObject();
    expect(effectivePlan(sub, new Date(u.end.getTime() + DAY)).state).toBe('grace');
    expect(effectivePlan(sub, new Date(u.end.getTime() + 4 * DAY)).plan).toBe('free');

    await sweepSubscriptions(new Date(u.end.getTime() + DAY));
    expect((await Subscription.findById(u.sub._id)).status).toBe('past_due');
    expect(await Notification.countDocuments({ type: 'subscription_past_due' })).toBe(1);
    await sweepSubscriptions(new Date(u.end.getTime() + 4 * DAY));
    expect((await Subscription.findById(u.sub._id)).status).toBe('expired');
    expect(await Notification.countDocuments({ type: 'subscription_expired' })).toBe(1);
  });

  it('reminds owners before the plan ends, once', async () => {
    const u = await paid();
    const soon = new Date(u.end.getTime() - 3 * DAY);
    await sweepSubscriptions(soon);
    await sweepSubscriptions(soon);
    expect(await Notification.countDocuments({ type: 'subscription_renewal_due' })).toBe(1);
  });

  it('a verified full refund removes the period that payment bought', async () => {
    const u = await paid();
    const p = await Payment.findOne({ reference: u.ref });
    fake.refunds.set('rf1', { id: 'rf1', transaction: Number(p.providerTransactionId), amount: 2500, currency: 'GHS', status: 'processed', updatedAt: '2026-11-12T00:00:00Z' });
    await paystackHook('refund.processed', { id: 'rf1', transaction_reference: u.ref, status: 'processed', amount: 2500 }).expect(200);
    const after = await Payment.findById(p._id);
    expect(after.status).toBe('refunded');
    expect(after.refunds).toHaveLength(1);
    const cur = await current(u.h);
    expect(cur.plan).toBe('free');
    expect(cur.subscription).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' });
  });

  it('a partial refund is recorded but keeps the plan', async () => {
    const u = await paid();
    const p = await Payment.findOne({ reference: u.ref });
    fake.refunds.set('rf2', { id: 'rf2', transaction: Number(p.providerTransactionId), amount: 1000, currency: 'GHS', status: 'processed' });
    await paystackHook('refund.processed', { id: 'rf2', transaction_reference: u.ref }).expect(200);
    const [h] = (await api().get(`${S}/history`).set(u.h)).body.data;
    expect(h).toMatchObject({ status: 'partially_refunded', refunds: [{ amount: '10.00', status: 'processed' }] });
    expect((await current(u.h)).plan).toBe('personal_pro');
  });
});

describe('guardrails', () => {
  it('webhooks exist for the two subscription providers only', () => {
    const routes = paymentWebhooksRouter.stack.filter((l) => l.route).map((l) => l.route.path);
    expect(routes.sort()).toEqual(['/flutterwave', '/paystack']);
  });

  it('payment and subscription code never reaches into Susu, wallets or payouts', async () => {
    for (const dir of ['modules/payments', 'modules/payments/providers', 'modules/subscriptions']) {
      for (const f of await fs.readdir(path.resolve(dir))) {
        if (!f.endsWith('.js')) continue;
        const text = await fs.readFile(path.join(dir, f), 'utf8');
        expect(text, f).not.toMatch(/wallet|payout|disburse/i);
        // Only the Free-plan counter may read Susu data (to count plans), and only the model.
        const susuImports = [...text.matchAll(/from ['"]([^'"]*susu[^'"]*)['"]/g)].map((m) => m[1]);
        expect(susuImports, f).toEqual(f === 'entitlements.js' ? ['../susu/susu.models.js'] : []);
      }
    }
  });
});
