import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { normalizeRate } from '../../utils/money.js';

/**
 * Pluggable exchange-rate providers. Only the one named by
 * EXCHANGE_RATE_PROVIDER is used; the default is "none" (manual rates only).
 * Providers return { rate, effectiveDate, provider }. No user data is sent.
 */
export const providers = {
  open_er_api: {
    label: 'ExchangeRate-API (open access)',
    async fetchRate(from, to, fetchImpl = fetch) {
      const res = await fetchImpl(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`provider HTTP ${res.status}`);
      const body = await res.json();
      const value = body?.rates?.[to];
      if (body?.result !== 'success' || typeof value !== 'number' || !(value > 0)) {
        throw new Error('provider has no rate for this pair');
      }
      const updated = body.time_last_update_unix ? new Date(body.time_last_update_unix * 1000) : new Date();
      // The provider publishes a JSON number; String() gives its shortest exact decimal form.
      return { rate: normalizeRate(String(value)), effectiveDate: updated, provider: 'open_er_api' };
    },
  },
};

export function activeProvider() {
  return env.exchangeRateProvider === 'none' ? null : { key: env.exchangeRateProvider, ...providers[env.exchangeRateProvider] };
}

export async function fetchProviderRate(from, to, fetchImpl) {
  const provider = activeProvider();
  if (!provider) {
    throw new ApiError(503, 'PROVIDER_DISABLED', 'Automatic exchange rates are turned off. Enter the rate manually.');
  }
  try {
    return await provider.fetchRate(from, to, fetchImpl);
  } catch {
    throw new ApiError(502, 'PROVIDER_UNAVAILABLE', `Couldn’t get a ${from}→${to} rate from ${provider.label}. Enter the rate manually.`);
  }
}

export function providerLabel(key) {
  return providers[key]?.label ?? key;
}
