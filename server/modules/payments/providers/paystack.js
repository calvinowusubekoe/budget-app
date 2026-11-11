import crypto from 'node:crypto';
import { env } from '../../../config/env.js';
import { D, minorUnits } from '../../../utils/money.js';
import { providerRequest, providerUnavailable } from './http.js';

/**
 * Paystack adapter (https://paystack.com/docs/api/). Amounts are sent and
 * received in the currency's subunit (pesewas for GHS) as integers.
 */
const BASE = 'https://api.paystack.co';
const LABEL = 'Paystack';
const secret = () => env.payments.paystackSecret;

const toSubunits = (amount, currency) => Number(new D(amount).times(new D(10).pow(minorUnits(currency))).toFixed(0));
const fromSubunits = (value, currency) => new D(String(value)).div(new D(10).pow(minorUnits(currency))).toFixed(minorUnits(currency));

const STATUS = { success: 'success', failed: 'failed', abandoned: 'abandoned', reversed: 'reversed' };

export const paystack = {
  key: 'paystack',
  label: LABEL,
  get configured() {
    return Boolean(secret());
  },
  get testMode() {
    return secret().startsWith('sk_test_');
  },

  async initialize({ reference, amount, currency, email, callbackUrl, metadata }) {
    const r = await providerRequest(LABEL, `${BASE}/transaction/initialize`, {
      method: 'POST',
      secret: secret(),
      body: { reference, amount: toSubunits(amount, currency), currency, email, callback_url: callbackUrl, metadata },
    });
    if (!r.ok || !r.json?.status || !r.json.data?.authorization_url) throw providerUnavailable(LABEL);
    return { checkoutUrl: r.json.data.authorization_url };
  },

  /** Asks Paystack directly what happened to a payment. */
  async verify(reference) {
    const r = await providerRequest(LABEL, `${BASE}/transaction/verify/${encodeURIComponent(reference)}`, { secret: secret() });
    if (r.status === 404 || (r.json && r.json.status === false && r.status === 400)) return { reference, status: 'pending', found: false };
    if (!r.ok || !r.json?.data) throw providerUnavailable(LABEL);
    const d = r.json.data;
    return {
      found: true,
      reference: d.reference,
      status: STATUS[d.status] ?? 'pending',
      providerStatus: String(d.status),
      amount: fromSubunits(d.amount, d.currency),
      currency: d.currency,
      providerTransactionId: d.id != null ? String(d.id) : null,
      fees: d.fees != null ? fromSubunits(d.fees, d.currency) : null,
      methodType: d.channel ?? null,
      paidAt: d.paid_at ? new Date(d.paid_at) : null,
      failureReason: d.gateway_response ?? '',
    };
  },

  async fetchRefund(refundId) {
    const r = await providerRequest(LABEL, `${BASE}/refund/${encodeURIComponent(refundId)}`, { secret: secret() });
    if (!r.ok || !r.json?.data) throw providerUnavailable(LABEL);
    const d = r.json.data;
    const transactionId = typeof d.transaction === 'object' && d.transaction ? d.transaction.id : d.transaction;
    return {
      refundId: String(d.id),
      providerTransactionId: transactionId != null ? String(transactionId) : null,
      reference: d.transaction_reference ?? d.transaction?.reference ?? null,
      amount: fromSubunits(d.amount, d.currency),
      currency: d.currency,
      status: d.status === 'processed' ? 'processed' : d.status === 'failed' ? 'failed' : 'pending',
      processedAt: d.updatedAt || d.updated_at ? new Date(d.updatedAt ?? d.updated_at) : new Date(),
    };
  },

  /** x-paystack-signature is an HMAC-SHA512 of the raw body keyed with the secret key. */
  verifySignature(rawBody, headers) {
    const given = headers['x-paystack-signature'];
    if (!secret() || typeof given !== 'string' || !/^[a-f0-9]{128}$/i.test(given)) return false;
    const expected = crypto.createHmac('sha512', secret()).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given.toLowerCase(), 'hex'));
  },

  parseEvent(body) {
    const d = body?.data ?? {};
    const type = String(body?.event ?? 'unknown');
    if (type === 'charge.success') return { type: 'charge', eventId: `${type}:${d.id}`, reference: d.reference ?? null };
    if (type.startsWith('refund.')) return { type: 'refund', eventId: `${type}:${d.id ?? d.refund_reference}`, reference: d.transaction_reference ?? null, refundId: d.id != null ? String(d.id) : null };
    return { type: 'other', eventId: `${type}:${d.id ?? crypto.randomUUID()}`, reference: d.reference ?? null };
  },
};
