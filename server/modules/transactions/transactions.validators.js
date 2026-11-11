import Joi from 'joi';
import { objectId } from '../../validators/common.js';
import { amount, calendarDate, rate } from '../../validators/money.js';
import { FREQUENCIES } from './transaction.model.js';

const recurrence = Joi.object({
  isRecurring: Joi.boolean().required(),
  frequency: Joi.string().valid(...FREQUENCIES).allow(null),
});

const editable = {
  type: Joi.string().valid('income', 'expense', 'transfer'),
  accountId: objectId,
  categoryId: objectId.allow(null),
  toAccountId: objectId.allow(null),
  amount,
  toAmount: amount.allow(null),
  // Rate typed for this one transaction: 1 unit of its currency in the reporting currency.
  exchangeRate: rate,
  date: calendarDate,
  description: Joi.string().trim().min(1).max(140),
  payee: Joi.string().trim().max(80).allow(''),
  notes: Joi.string().trim().max(2000).allow(''),
  recurrence,
};

export const createSchema = {
  body: Joi.object({
    ...editable,
    type: editable.type.required(),
    accountId: objectId.required(),
    amount: amount.required(),
    date: calendarDate.required(),
    description: editable.description.required(),
  }),
};

export const idSchema = { params: Joi.object({ transactionId: objectId.required() }) };

export const updateSchema = {
  ...idSchema,
  body: Joi.object({ ...editable, version: Joi.number().integer().min(0) }).min(1),
};

export const deleteSchema = { ...idSchema, body: Joi.object({ reason: Joi.string().trim().max(300).allow('') }) };

const filters = {
  type: Joi.string().valid('income', 'expense', 'transfer'),
  accountId: objectId,
  categoryId: objectId,
  status: Joi.string().valid('recorded', 'reconciled'),
  from: calendarDate,
  to: calendarDate,
  q: Joi.string().trim().max(100).allow(''),
  recurring: Joi.boolean(),
};

export const listSchema = {
  query: Joi.object({ ...filters, page: Joi.number().integer().min(1).default(1), limit: Joi.number().integer().min(1).max(100).default(25) }),
};
export const exportSchema = { query: Joi.object(filters) };
export const summarySchema = { query: Joi.object({ from: calendarDate, to: calendarDate, accountId: objectId }) };

export const attachmentParamSchema = {
  params: Joi.object({ transactionId: objectId.required(), attachmentId: objectId.required() }),
};

/** Idempotency keys: opaque client-generated strings, e.g. a UUID. */
export const idempotencyKey = Joi.string().max(100).pattern(/^[A-Za-z0-9_-]{8,100}$/);
