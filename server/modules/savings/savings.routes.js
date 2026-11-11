import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { currency, objectId } from '../../validators/common.js';
import { amount, calendarDate } from '../../validators/money.js';
import { created, ok, requestContext } from '../../utils/http.js';
import { todayIn } from '../../utils/periods.js';
import * as svc from './savings.service.js';

const fields = {
  name: Joi.string().trim().min(1).max(80),
  description: Joi.string().trim().max(500).allow(''),
  targetAmount: amount,
  currency,
  targetDate: calendarDate.allow(null),
  contributionFrequency: Joi.string().valid('weekly', 'monthly', 'quarterly', 'none'),
  notes: Joi.string().trim().max(1000).allow(''),
};
const goalId = Joi.object({ goalId: objectId.required() });
const today = (req) => todayIn(req.user.timezone);
const write = requirePermission('records.write');

export const savingsRouter = Router();
savingsRouter.use(requireAuth, requireWorkspace('records.read'));

savingsRouter.get('/', validate({ query: Joi.object({ includeArchived: Joi.boolean().default(false) }) }), async (req, res) =>
  ok(res, await svc.listGoals(req.workspace, today(req), req.valid.query)),
);
savingsRouter.post('/', write, validate({ body: Joi.object({ ...fields, name: fields.name.required(), targetAmount: amount.required(), currency: currency.required() }) }), async (req, res) =>
  created(res, await svc.createGoal(req.workspace, req.valid.body, req.user, today(req), requestContext(req))),
);
savingsRouter.get('/:goalId', validate({ params: goalId }), async (req, res) => ok(res, await svc.getGoal(req.workspace, req.valid.params.goalId, today(req))));
savingsRouter.patch('/:goalId', write, validate({ params: goalId, body: Joi.object({ ...fields, status: Joi.string().valid('active', 'archived') }).min(1) }), async (req, res) =>
  ok(res, await svc.updateGoal(req.workspace, req.valid.params.goalId, req.valid.body, req.user, today(req), requestContext(req))),
);
savingsRouter.get('/:goalId/entries', validate({ params: goalId }), async (req, res) => ok(res, await svc.listEntries(req.workspace, req.valid.params.goalId)));
savingsRouter.get('/:goalId/trend', validate({ params: goalId }), async (req, res) => ok(res, await svc.monthlyTrend(req.workspace, req.valid.params.goalId, today(req))));
savingsRouter.post(
  '/:goalId/entries',
  write,
  validate({
    params: goalId,
    body: Joi.object({ type: Joi.string().valid('contribution', 'withdrawal').required(), amount: amount.required(), date: calendarDate.required(), notes: Joi.string().trim().max(500).allow('') }),
  }),
  async (req, res) => created(res, await svc.addEntry(req.workspace, req.valid.params.goalId, req.valid.body, req.user, today(req), requestContext(req))),
);
savingsRouter.post(
  '/:goalId/entries/:entryId/reverse',
  write,
  validate({ params: Joi.object({ goalId: objectId.required(), entryId: objectId.required() }), body: Joi.object({ reason: Joi.string().trim().min(3).max(300).required().messages({ 'any.required': 'Say why this entry is being reversed.', 'string.min': 'Say why this entry is being reversed.' }) }) }),
  async (req, res) => ok(res, await svc.reverseEntry(req.workspace, req.valid.params.goalId, req.valid.params.entryId, req.valid.body.reason, req.user, today(req), requestContext(req))),
);
