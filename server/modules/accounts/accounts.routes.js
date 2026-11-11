import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { currency, objectId } from '../../validators/common.js';
import { calendarDate, signedAmount } from '../../validators/money.js';
import { created, ok, requestContext } from '../../utils/http.js';
import { ACCOUNT_TYPES } from './account.model.js';
import * as svc from './accounts.service.js';

const fields = {
  name: Joi.string().trim().min(1).max(80),
  type: Joi.string().valid(...ACCOUNT_TYPES),
  currency,
  institution: Joi.string().trim().max(80).allow(''),
  openingBalance: signedAmount,
  openingDate: calendarDate,
  notes: Joi.string().trim().max(500).allow(''),
};
const today = () => new Date().toISOString().slice(0, 10);

const listSchema = { query: Joi.object({ includeArchived: Joi.boolean().default(false) }) };
const idSchema = { params: Joi.object({ accountId: objectId.required() }) };
const createSchema = {
  body: Joi.object({
    ...fields,
    name: fields.name.required(),
    type: fields.type.required(),
    currency: currency.required(),
    openingBalance: signedAmount.default('0'),
    openingDate: calendarDate.default(today),
  }),
};
const updateSchema = { ...idSchema, body: Joi.object({ ...fields, status: Joi.string().valid('active', 'archived') }).min(1) };

export const accountsRouter = Router();
accountsRouter.use(requireAuth, requireWorkspace('records.read'));

accountsRouter.get('/', validate(listSchema), async (req, res) => {
  const accounts = await svc.listAccounts(req.workspace._id, req.valid.query);
  ok(res, accounts, { meta: { totals: svc.totalsByCurrency(accounts) } });
});
accountsRouter.get('/:accountId', validate(idSchema), async (req, res) => ok(res, await svc.getAccount(req.workspace._id, req.valid.params.accountId)));
accountsRouter.post('/', requirePermission('records.write'), validate(createSchema), async (req, res) =>
  created(res, await svc.createAccount(req.workspace, req.valid.body, req.user, requestContext(req))),
);
accountsRouter.patch('/:accountId', requirePermission('records.write'), validate(updateSchema), async (req, res) =>
  ok(res, await svc.updateAccount(req.workspace, req.valid.params.accountId, req.valid.body, req.user, requestContext(req))),
);
accountsRouter.delete('/:accountId', requirePermission('records.write'), validate(idSchema), async (req, res) => {
  await svc.deleteAccount(req.workspace, req.valid.params.accountId, req.user, requestContext(req));
  ok(res, { deleted: true });
});
