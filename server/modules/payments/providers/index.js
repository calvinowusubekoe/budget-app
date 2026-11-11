import { paystack } from './paystack.js';
import { flutterwave } from './flutterwave.js';

/**
 * Replaceable provider adapters. Each exposes the same shape:
 *   initialize, verify, verifySignature, parseEvent (and optionally fetchRefund).
 * A provider is offered only when its credentials are configured.
 */
export const PROVIDERS = { paystack, flutterwave };

export const getProvider = (key) => PROVIDERS[key] ?? null;
export const configuredProviders = () => Object.values(PROVIDERS).filter((p) => p.configured);
