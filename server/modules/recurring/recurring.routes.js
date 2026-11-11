import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { objectId } from '../../validators/common.js';
import { amount, calendarDate } from '../../validators/money.js';
import { created, ok, requestContext } from '../../utils/http.js';
import * as svc from './recurring.service.js';

const schedule = {
  frequency: Joi.string().valid('daily', 'weekly', 'monthly', 'quarterly', 'yearly'),
  interval: Joi.number().integer().min(1).max(12),
  endDate: calendarDate.allow(null),
  mode: Joi.string().valid('auto', 'remind'),
};
const template = {
  accountId: objectId,
  categoryId: objectId.allow(null),
  toAccountId: objectId.allow(null),
  amount,
  toAmount: amount.allow(null),
  description: Joi.string().trim().min(1).max(140),
  payee: Joi.string().trim().max(80).allow(''),
  notes: Joi.string().trim().max(2000).allow(''),
};

const createSchema = {
  body: Joi.alternatives().try(
    Joi.object({ fromTransactionId: objectId.required(), ...schedule, frequency: schedule.frequency.required() }),
    Joi.object({
      ...template,
      ...schedule,
      type: Joi.string().valid('income', 'expense', 'transfer').required(),
      accountId: objectId.required(),
      amount: amount.required(),
      description: template.description.required(),
      startDate: calendarDate.required(),
      frequency: schedule.frequency.required(),
    }),
  ),
};
const idSchema = { params: Joi.object({ recurringId: objectId.required() }) };
const occurrenceSchema = { ...idSchema, body: Joi.object({ date: calendarDate.required() }) };

const write = requirePermission('records.write');

export const recurringRouter = Router();
recurringRouter.use(requireAuth, requireWorkspace('records.read'));

recurringRouter.get('/', validate({ query: Joi.object({ includeEnded: Joi.boolean().default(false) }) }), async (req, res) => ok(res, await svc.listSchedules(req.workspace, req.valid.query)));
recurringRouter.post('/', write, validate(createSchema), async (req, res) => created(res, await svc.createSchedule(req.workspace, req.valid.body, req.user, requestContext(req))));
recurringRouter.patch(
  '/:recurringId',
  write,
  validate({ ...idSchema, body: Joi.object({ ...template, mode: schedule.mode, endDate: schedule.endDate, status: Joi.string().valid('active', 'paused', 'ended') }).min(1) }),
  async (req, res) => ok(res, await svc.updateSchedule(req.workspace, req.valid.params.recurringId, req.valid.body, req.user, requestContext(req))),
);
recurringRouter.post('/:recurringId/skip', write, validate(idSchema), async (req, res) => ok(res, await svc.skipNext(req.workspace, req.valid.params.recurringId, req.user, requestContext(req))));
recurringRouter.post('/:recurringId/confirm', write, validate(occurrenceSchema), async (req, res) =>
  created(res, await svc.confirmOccurrence(req.workspace, req.valid.params.recurringId, req.valid.body.date, req.user, requestContext(req))),
);
recurringRouter.post('/:recurringId/dismiss', write, validate(occurrenceSchema), async (req, res) => {
  await svc.dismissOccurrence(req.workspace, req.valid.params.recurringId, req.valid.body.date, req.user, requestContext(req));
  ok(res, { dismissed: true });
});
