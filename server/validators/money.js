import Joi from 'joi';
import { AMOUNT_PATTERN, RATE_PATTERN, SIGNED_AMOUNT_PATTERN } from '../utils/money.js';

/**
 * Money is accepted only as decimal strings. A JSON number would already
 * have passed through binary floating point before we saw it.
 */
export const amount = Joi.string()
  .trim()
  .pattern(AMOUNT_PATTERN)
  .custom((v, helpers) => (/^0+(\.0+)?$/.test(v) ? helpers.error('amount.zero') : v))
  .messages({
    'string.base': 'Send amounts as text, e.g. "125.50".',
    'string.pattern.base': 'Enter an amount like 125.50.',
    'amount.zero': 'Amount must be more than zero.',
  });

export const signedAmount = Joi.string()
  .trim()
  .pattern(SIGNED_AMOUNT_PATTERN)
  .messages({ 'string.base': 'Send amounts as text, e.g. "125.50".', 'string.pattern.base': 'Enter an amount like 125.50 or -40.' });

export const rate = Joi.string()
  .trim()
  .pattern(RATE_PATTERN)
  .custom((v, helpers) => (/^0+(\.0+)?$/.test(v) ? helpers.error('rate.zero') : v))
  .messages({
    'string.base': 'Send rates as text, e.g. "15.42".',
    'string.pattern.base': 'Enter a rate like 15.42 (up to 10 decimal places).',
    'rate.zero': 'Rate must be more than zero.',
  });

/** Calendar date as YYYY-MM-DD; stored as UTC midnight so it never shifts by time zone. */
export const calendarDate = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((v, helpers) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return helpers.error('date.invalid');
    return v;
  })
  .messages({ 'string.pattern.base': 'Use a date like 2026-11-30.', 'date.invalid': 'That date does not exist.' });

export const toUtcDate = (ymd) => new Date(`${ymd}T00:00:00.000Z`);
export const toYmd = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);
