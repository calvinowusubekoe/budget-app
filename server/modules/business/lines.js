import Decimal from 'decimal.js';
import { ApiError } from '../../utils/ApiError.js';
import { D, fitsCurrency, minorUnits, normalize } from '../../utils/money.js';

/**
 * Line maths for invoices and bills, all in decimal:
 *   amount = quantity × unit price, rounded half-up to the currency
 *   tax    = amount × rate / 100, rounded the same way, per line
 *   totals = sums of the rounded lines, so the printed lines always add up
 */

export const QTY_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;
export const RATE_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

export function computeLines(lines, currency) {
  const dp = minorUnits(currency);
  let subtotal = new D(0);
  let taxTotal = new D(0);
  const out = lines.map((l, i) => {
    if (!fitsCurrency(l.unitPrice, currency)) {
      throw ApiError.validation([{ location: 'body', field: `lines.${i}.unitPrice`, message: `${currency} prices have at most ${dp} decimal places.` }]);
    }
    if (l.taxRate && new D(l.taxRate).greaterThan(100)) {
      throw ApiError.validation([{ location: 'body', field: `lines.${i}.taxRate`, message: 'A tax rate can’t be more than 100%.' }]);
    }
    const amount = new D(l.quantity).times(l.unitPrice).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
    const tax = l.taxRate ? amount.times(l.taxRate).div(100).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP) : new D(0);
    subtotal = subtotal.plus(amount);
    taxTotal = taxTotal.plus(tax);
    return {
      description: l.description,
      quantity: new D(l.quantity).toString(),
      unitPrice: normalize(l.unitPrice, currency),
      taxRate: l.taxRate ? new D(l.taxRate).toString() : null,
      amount: amount.toFixed(dp),
      tax: tax.toFixed(dp),
    };
  });
  return { lines: out, subtotal: subtotal.toFixed(dp), taxTotal: taxTotal.toFixed(dp), total: subtotal.plus(taxTotal).toFixed(dp) };
}
