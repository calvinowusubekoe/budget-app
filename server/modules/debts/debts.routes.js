import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { currency, objectId } from '../../validators/common.js';
import { amount, calendarDate } from '../../validators/money.js';
import { created, ok, requestContext } from '../../utils/http.js';
import { todayIn } from '../../utils/periods.js';
import * as svc from './debts.service.js';

const percent = Joi.string().trim().pattern(/^\d{1,3}(\.\d{1,4})?$/).messages({ 'string.pattern.base': 'Enter a yearly rate like 24 or 18.5.' });
const fields = {
  name: Joi.string().trim().min(1).max(80),
  direction: Joi.string().valid('i_owe', 'owed_to_me'),
  counterparty: Joi.string().trim().max(80).allow(''),
  principal: amount,
  currency,
  interestRate: percent.allow(null, ''),
  startDate: calendarDate,
  dueDate: calendarDate.allow(null),
  minimumPayment: amount.allow(null),
  paymentFrequency: Joi.string().valid('weekly', 'monthly', 'quarterly', 'none'),
  notes: Joi.string().trim().max(1000).allow(''),
};
const debtId = Joi.object({ debtId: objectId.required() });
const today = (req) => todayIn(req.user.timezone);
const write = requirePermission('records.write');

export const debtsRouter = Router();
debtsRouter.use(requireAuth, requireWorkspace('records.read'));

debtsRouter.get('/', validate({ query: Joi.object({ includeArchived: Joi.boolean().default(false) }) }), async (req, res) =>
  ok(res, await svc.listDebts(req.workspace, today(req), req.valid.query)),
);
debtsRouter.post(
  '/',
  write,
  validate({ body: Joi.object({ ...fields, name: fields.name.required(), direction: fields.direction.required(), principal: amount.required(), currency: currency.required(), startDate: calendarDate.required() }) }),
  async (req, res) => created(res, await svc.createDebt(req.workspace, req.valid.body, req.user, today(req), requestContext(req))),
);
debtsRouter.get('/:debtId', validate({ params: debtId }), async (req, res) => ok(res, await svc.getDebt(req.workspace, req.valid.params.debtId, today(req))));
debtsRouter.patch('/:debtId', write, validate({ params: debtId, body: Joi.object({ ...fields, direction: Joi.forbidden(), status: Joi.string().valid('active', 'archived') }).min(1) }), async (req, res) =>
  ok(res, await svc.updateDebt(req.workspace, req.valid.params.debtId, req.valid.body, req.user, today(req), requestContext(req))),
);
debtsRouter.get('/:debtId/payments', validate({ params: debtId }), async (req, res) => ok(res, await svc.listPayments(req.workspace, req.valid.params.debtId)));
debtsRouter.post(
  '/:debtId/payments',
  write,
  validate({ params: debtId, body: Joi.object({ type: Joi.string().valid('payment', 'charge').default('payment'), amount: amount.required(), date: calendarDate.required(), notes: Joi.string().trim().max(500).allow('') }) }),
  async (req, res) => created(res, await svc.addPayment(req.workspace, req.valid.params.debtId, req.valid.body, req.user, today(req), requestContext(req))),
);
debtsRouter.post(
  '/:debtId/payments/:paymentId/reverse',
  write,
  validate({ params: Joi.object({ debtId: objectId.required(), paymentId: objectId.required() }), body: Joi.object({ reason: Joi.string().trim().min(3).max(300).required().messages({ 'any.required': 'Say why this entry is being reversed.', 'string.min': 'Say why this entry is being reversed.' }) }) }),
  async (req, res) => ok(res, await svc.reversePayment(req.workspace, req.valid.params.debtId, req.valid.params.paymentId, req.valid.body.reason, req.user, today(req), requestContext(req))),
);
