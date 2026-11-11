import Decimal from 'decimal.js';
import mongoose from 'mongoose';

/**
 * All money arithmetic goes through this module. Amounts travel as decimal
 * strings ("1250.50"), are stored as Decimal128, and are computed with
 * decimal.js. JavaScript numbers are never used for money.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });

export const AMOUNT_PATTERN = /^\d{1,13}(\.\d{1,4})?$/;
export const SIGNED_AMOUNT_PATTERN = /^-?\d{1,13}(\.\d{1,4})?$/;
export const RATE_PATTERN = /^\d{1,10}(\.\d{1,10})?$/;
export const RATE_DECIMALS = 10;

const minorCache = new Map();

/** ISO 4217 minor units: GHS 2, JPY 0, BHD 3. */
export function minorUnits(currency) {
  if (!minorCache.has(currency)) {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    minorCache.set(currency, digits);
  }
  return minorCache.get(currency);
}

/** True when the amount has no more decimal places than the currency allows. */
export function fitsCurrency(amount, currency) {
  return new D(amount).decimalPlaces() <= minorUnits(currency);
}

/** Canonical string with exactly the currency's decimal places. */
export function normalize(amount, currency) {
  return new D(amount).toFixed(minorUnits(currency), Decimal.ROUND_HALF_UP);
}

export function convert(amount, rate, toCurrency) {
  return new D(amount).times(rate).toFixed(minorUnits(toCurrency), Decimal.ROUND_HALF_UP);
}

export function invertRate(rate) {
  return new D(1).div(rate).toDecimalPlaces(RATE_DECIMALS, Decimal.ROUND_HALF_UP).toString();
}

export function normalizeRate(rate) {
  return new D(rate).toDecimalPlaces(RATE_DECIMALS, Decimal.ROUND_HALF_UP).toString();
}

export function add(...values) {
  return values.reduce((acc, v) => acc.plus(v ?? 0), new D(0));
}

export const toDecimal128 = (value) => (value == null ? null : mongoose.Types.Decimal128.fromString(String(value)));

/** Decimal128 or aggregation output to a plain decimal string. */
export function str(value) {
  if (value == null) return null;
  if (typeof value === 'object' && typeof value.toString === 'function') return value.toString();
  return String(value);
}

export function isPositive(amount) {
  return new D(amount).greaterThan(0);
}
