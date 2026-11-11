import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/ApiError.js';
import { logger } from '../../../utils/logger.js';

export const providerUnavailable = (label) =>
  new ApiError(502, 'PROVIDER_UNAVAILABLE', `${label} didn't respond properly. No money has moved from BudgetFlow's side; try again in a minute.`);

/**
 * JSON call to a payment provider with a timeout. Secret keys go in the
 * Authorization header only and are never logged.
 */
export async function providerRequest(label, url, { method = 'GET', secret, body } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(env.payments.timeoutMs),
    });
  } catch (err) {
    logger.warn(`${label} request failed: ${err.name}`);
    throw providerUnavailable(label);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    // fall through with json = null
  }
  return { status: res.status, ok: res.ok, json };
}
