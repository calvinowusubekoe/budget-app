import Joi from 'joi';
import { CURRENCY_CODES } from '../utils/currencies.js';

export const objectId = Joi.string().hex().length(24);
export const currency = Joi.string().uppercase().valid(...CURRENCY_CODES);
export const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254);

/**
 * At least 10 characters with a letter and a number. Length matters far more
 * than composition rules; bcrypt truncates at 72 bytes so cap there.
 */
export const password = Joi.string()
  .min(10)
  .max(72)
  .pattern(/[A-Za-z]/, 'letter')
  .pattern(/\d/, 'number')
  .messages({
    'string.min': 'Use at least 10 characters.',
    'string.max': 'Use 72 characters or fewer.',
    'string.pattern.name': 'Include at least one {#name}.',
  });

export const personName = Joi.string().trim().min(1).max(80);
