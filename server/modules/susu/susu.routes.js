import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { singleFile } from '../../middleware/upload.js';
import { currency, objectId } from '../../validators/common.js';
import { amount, calendarDate } from '../../validators/money.js';
import { created, ok, requestContext } from '../../utils/http.js';
import { todayIn } from '../../utils/periods.js';
import { sendUpload } from '../../services/fileStorage.js';
import { LOCATION_TYPES, SUSU_FREQUENCIES } from './susu.models.js';
import * as svc from './personal.service.js';
import { idempotencyKey } from '../../utils/idempotency.js';

/*
 * Personal Susu API. Record-keeping only: there are deliberately no payment,
 * transfer, payout or wallet endpoints here, and there never will be.
 */

const location = Joi.object({ type: Joi.string().valid(...LOCATION_TYPES).required(), label: Joi.string().trim().max(80).allow('') });
const planFields = {
  name: Joi.string().trim().min(1).max(80),
  description: Joi.string().trim().max(500).allow(''),
  currency,
  targetAmount: amount.allow(null),
  contributionAmount: amount,
  frequency: Joi.string().valid(...SUSU_FREQUENCIES),
  intervalDays: Joi.number().integer().min(2).max(90).allow(null),
  startDate: calendarDate,
  targetDate: calendarDate.allow(null),
  location,
  notes: Joi.string().trim().max(1000).allow(''),
};
const planId = Joi.object({ planId: objectId.required() });
const entryParams = Joi.object({ planId: objectId.required(), entryId: objectId.required() });
const reasonBody = Joi.object({ reason: Joi.string().trim().min(3).max(300).required().messages({ 'any.required': 'Say why this entry is being cancelled.', 'string.min': 'Say why this entry is being cancelled.' }) });
const entryBody = (kind) =>
  Joi.object({
    amount: amount.required(),
    date: calendarDate.required(),
    notes: Joi.string().trim().max(500).allow(''),
    ...(kind === 'withdrawal' ? { reason: Joi.string().trim().min(2).max(200).required().messages({ 'any.required': 'Say what the money was for.' }) } : {}),
  });

const today = (req) => todayIn(req.user.timezone);
const write = requirePermission('records.write');

export const susuRouter = Router();
susuRouter.use(requireAuth, requireWorkspace('records.read'));

susuRouter.get('/summary', async (req, res) => ok(res, await svc.susuSummary(req.workspace, today(req))));

susuRouter.get('/plans', validate({ query: Joi.object({ includeClosed: Joi.boolean().default(false) }) }), async (req, res) => ok(res, await svc.listPlans(req.workspace, today(req), req.valid.query)));
susuRouter.post(
  '/plans',
  write,
  validate({
    body: Joi.object({
      ...planFields,
      name: planFields.name.required(),
      currency: currency.required(),
      contributionAmount: amount.required(),
      frequency: planFields.frequency.required(),
      startDate: calendarDate.required(),
      location: location.required(),
    }),
  }),
  async (req, res) => created(res, await svc.createPlan(req.workspace, req.valid.body, req.user, today(req), requestContext(req))),
);
susuRouter.get('/plans/:planId', validate({ params: planId }), async (req, res) => ok(res, await svc.getPlan(req.workspace, req.valid.params.planId, today(req))));
susuRouter.patch(
  '/plans/:planId',
  write,
  validate({
    params: planId,
    body: Joi.object({
      ...planFields,
      location: Joi.object({ type: Joi.string().valid(...LOCATION_TYPES), label: Joi.string().trim().max(80).allow('') }),
      status: Joi.string().valid('active', 'paused', 'completed', 'cancelled'),
      cancelReason: Joi.string().trim().max(300),
    }).min(1),
  }),
  async (req, res) => ok(res, await svc.updatePlan(req.workspace, req.valid.params.planId, req.valid.body, req.user, today(req), requestContext(req))),
);
susuRouter.get('/plans/:planId/schedule', validate({ params: planId, query: Joi.object({ limit: Joi.number().integer().min(1).max(400).default(60) }) }), async (req, res) =>
  ok(res, await svc.planSchedule(req.workspace, req.valid.params.planId, today(req), req.valid.query.limit)),
);
susuRouter.get('/plans/:planId/monthly', validate({ params: planId }), async (req, res) => ok(res, await svc.monthlySummary(req.workspace, req.valid.params.planId)));

for (const [kind, path] of [['contribution', 'contributions'], ['withdrawal', 'withdrawals']]) {
  susuRouter.get(`/plans/:planId/${path}`, validate({ params: planId }), async (req, res) => ok(res, await svc.listEntries(req.workspace, req.valid.params.planId, kind)));
  susuRouter.post(`/plans/:planId/${path}`, write, validate({ params: planId, body: entryBody(kind) }), async (req, res) =>
    created(res, await svc.addEntry(req.workspace, req.valid.params.planId, kind, req.valid.body, req.user, today(req), requestContext(req), idempotencyKey(req))),
  );
  susuRouter.post(`/plans/:planId/${path}/:entryId/cancel`, write, validate({ params: entryParams, body: reasonBody }), async (req, res) =>
    ok(res, await svc.cancelEntry(req.workspace, req.valid.params.planId, kind, req.valid.params.entryId, req.valid.body.reason, req.user, today(req), requestContext(req))),
  );
}

susuRouter.post('/plans/:planId/contributions/:entryId/attachment', write, validate({ params: entryParams }), singleFile, async (req, res) =>
  created(res, await svc.attachProof(req.workspace, req.valid.params.planId, req.valid.params.entryId, req.file, req.user, requestContext(req))),
);
susuRouter.get('/plans/:planId/contributions/:entryId/attachment', validate({ params: entryParams }), async (req, res) => {
  const { meta, data } = await svc.openProof(req.workspace, req.valid.params.planId, req.valid.params.entryId);
  sendUpload(res, meta, data);
});
