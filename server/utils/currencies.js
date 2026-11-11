/**
 * ISO 4217 codes supported by the runtime's Intl data. No hardcoded list to
 * drift out of date; the client receives the same list from /api/meta.
 */
export const CURRENCY_CODES = Object.freeze(
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('currency')
    : ['GHS', 'USD', 'EUR', 'GBP', 'NGN', 'CAD'],
);

const SET = new Set(CURRENCY_CODES);
export const isCurrency = (code) => SET.has(code);

/** Featured first in pickers; everything else follows alphabetically. */
export const FEATURED_CURRENCIES = Object.freeze(['GHS', 'USD', 'EUR', 'GBP', 'NGN', 'CAD']);
