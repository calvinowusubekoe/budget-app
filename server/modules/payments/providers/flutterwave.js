import crypto from 'node:crypto';
import { env } from '../../../config/env.js';
import { D, minorUnits } from '../../../utils/money.js';
import { providerRequest, providerUnavailable } from './http.js';

/**
 * Flutterwave v3 adapter (https://developer.flutterwave.com/docs).
 * Flutterwave takes amounts in major units as a JSON number. The amount is a
 * validated decimal string with at most 2 places, so Number() gives the same
 * value on the wire; responses are read back into decimals for comparison.
 */
const BASE = 'https://api.flutterwave.com/v3';
const LABEL = 'Flutterwave';
const secret = () => env.payments.flutterwaveSecret;
const hash = () => env.payments.flutterwaveHash;
const fixed = (value, currency) => new D(String(value)).toFixed(minorUnits(currency));

const STATUS = { successful: 'success', failed: 'failed', cancelled: 'abandoned' };

export const flutterwave = {
  key: 'flutterwave',
  label: LABEL,
  get configured() {
    return Boolean(secret() && hash());
  },
  get testMode() {
    return secret().startsWith('FLWSECK_TEST');
  },

  async initialize({ reference, amount, currency, email, name, callbackUrl, metadata }) {
    const r = await providerRequest(LABEL, `${BASE}/payments`, {
      method: 'POST',
      secret: secret(),
      body: {
        tx_ref: reference,
        amount: Number(amount),
        currency,
        redirect_url: callbackUrl,
        customer: { email, name },
        meta: metadata,
        customizations: { title: 'BudgetFlow subscription' },
      },
    });
    if (!r.ok || r.json?.status !== 'success' || !r.json.data?.link) throw providerUnavailable(LABEL);
    return { checkoutUrl: r.json.data.link };
  },

  async verify(reference) {
    const r = await providerRequest(LABEL, `${BASE}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, { secret: secret() });
    if (r.status === 404 || (r.status === 400 && r.json?.status === 'error')) return { reference, status: 'pending', found: false };
    if (!r.ok || !r.json?.data) throw providerUnavailable(LABEL);
    const d = r.json.data;
    return {
      found: true,
      reference: d.tx_ref,
      status: STATUS[d.status] ?? 'pending',
      providerStatus: String(d.status),
      amount: fixed(d.amount, d.currency),
      currency: d.currency,
      providerTransactionId: d.id != null ? String(d.id) : null,
      fees: d.app_fee != null ? fixed(d.app_fee, d.currency) : null,
      methodType: d.payment_type ?? null,
      paidAt: d.created_at ? new Date(d.created_at) : null,
      failureReason: d.processor_response ?? '',
    };
  },

  /** Flutterwave sends the secret hash set in its dashboard as the verif-hash header. */
  verifySignature(_rawBody, headers) {
    const given = headers['verif-hash'];
    if (!hash() || typeof given !== 'string') return false;
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(hash()).digest();
    return crypto.timingSafeEqual(a, b);
  },

  parseEvent(body) {
    const d = body?.data ?? {};
    const type = String(body?.event ?? body?.['event.type'] ?? 'unknown');
    if (type === 'charge.completed') return { type: 'charge', eventId: `${type}:${d.id}:${d.status}`, reference: d.tx_ref ?? null };
    return { type: 'other', eventId: `${type}:${d.id ?? crypto.randomUUID()}`, reference: d.tx_ref ?? null };
  },
};

