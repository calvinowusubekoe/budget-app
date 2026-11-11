import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { objectId } from '../../validators/common.js';
import { amount } from '../../validators/money.js';
import { created, ok, requestContext } from '../../utils/http.js';
import { todayIn } from '../../utils/periods.js';
import * as svc from './budgets.service.js';

const fields = {
  name: Joi.string().trim().min(1).max(80),
  scope: Joi.string().valid('all', 'categories'),
  categoryIds: Joi.array().items(objectId).max(50).unique(),
  amount,
  alertAt: Joi.number().integer().min(1).max(100),
  notes: Joi.string().trim().max(500).allow(''),
};
const idSchema = { params: Joi.object({ budgetId: objectId.required() }) };
const createSchema = {
  body: Joi.object({ ...fields, name: fields.name.required(), period: Joi.string().valid('weekly', 'monthly', 'yearly').required(), scope: fields.scope.required(), amount: amount.required() }),
};
const updateSchema = {
  ...idSchema,
  body: Joi.object({ ...fields, status: Joi.string().valid('active', 'paused', 'archived'), period: Joi.forbidden().messages({ 'any.unknown': 'The period can’t change. Create a new budget instead.' }) }).min(1),
};

// Periods are evaluated in the signed-in user's own calendar.
const today = (req) => todayIn(req.user.timezone);

export const budgetsRouter = Router();
budgetsRouter.use(requireAuth, requireWorkspace('records.read'));

budgetsRouter.get('/', validate({ query: Joi.object({ includeArchived: Joi.boolean().default(false) }) }), async (req, res) =>
  ok(res, await svc.listBudgets(req.workspace, today(req), req.valid.query)),
);
budgetsRouter.post('/', requirePermission('records.write'), validate(createSchema), async (req, res) =>
  created(res, await svc.createBudget(req.workspace, req.valid.body, req.user, today(req), requestContext(req))),
);
budgetsRouter.get('/:budgetId', validate(idSchema), async (req, res) => ok(res, await svc.getBudget(req.workspace, req.valid.params.budgetId, today(req))));
budgetsRouter.get('/:budgetId/history', validate({ ...idSchema, query: Joi.object({ periods: Joi.number().integer().min(1).max(24).default(6) }) }), async (req, res) =>
  ok(res, await svc.budgetHistory(req.workspace, req.valid.params.budgetId, today(req), req.valid.query.periods)),
);
budgetsRouter.patch('/:budgetId', requirePermission('records.write'), validate(updateSchema), async (req, res) =>
  ok(res, await svc.updateBudget(req.workspace, req.valid.params.budgetId, req.valid.body, req.user, today(req), requestContext(req))),
);
// Budgets are archived, not destroyed, so history stays comparable.
budgetsRouter.delete('/:budgetId', requirePermission('records.write'), validate(idSchema), async (req, res) =>
  ok(res, await svc.updateBudget(req.workspace, req.valid.params.budgetId, { status: 'archived' }, req.user, today(req), requestContext(req))),
);
