import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { objectId } from '../../validators/common.js';
import { created, ok, requestContext } from '../../utils/http.js';
import * as svc from './categories.service.js';

const kind = Joi.string().valid('income', 'expense');
const icon = Joi.string().max(40).pattern(/^[a-z0-9-]+$/);

const listSchema = { query: Joi.object({ kind, includeArchived: Joi.boolean().default(false) }) };
const createSchema = { body: Joi.object({ kind: kind.required(), name: Joi.string().trim().min(1).max(60).required(), icon }) };
const updateSchema = {
  params: Joi.object({ categoryId: objectId.required() }),
  body: Joi.object({ name: Joi.string().trim().min(1).max(60), icon, archived: Joi.boolean() }).min(1),
};

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth, requireWorkspace('records.read'));
categoriesRouter.get('/', validate(listSchema), async (req, res) => ok(res, await svc.listCategories(req.workspace._id, req.valid.query)));
categoriesRouter.post('/', requirePermission('records.write'), validate(createSchema), async (req, res) =>
  created(res, await svc.createCategory(req.workspace, req.valid.body, req.user, requestContext(req))),
);
categoriesRouter.patch('/:categoryId', requirePermission('records.write'), validate(updateSchema), async (req, res) =>
  ok(res, await svc.updateCategory(req.workspace, req.valid.params.categoryId, req.valid.body, req.user, requestContext(req))),
);
