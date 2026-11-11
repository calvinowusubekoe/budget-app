import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { created, ok, requestContext } from '../../utils/http.js';
import { configuredProviders } from '../payments/providers/index.js';
import * as payments from '../payments/payments.service.js';
import { BILLING_PERIODS, PAID_PLANS, listPlans } from './plans.js';
import * as svc from './subscriptions.service.js';

/**
 * Kontaa's own plans. There is deliberately no route that sets a plan,
 * status or period: those change only when the payments service applies a
 * provider-verified payment.
 */
export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireAuth);

subscriptionsRouter.get('/plans', (_req, res) =>
  ok(res, {
    plans: listPlans(),
    providers: configuredProviders().map((p) => ({ key: p.key, label: p.label, testMode: p.testMode })),
  }),
);

subscriptionsRouter.use(requireWorkspace('workspace.read'));
const owner = requirePermission('billing.manage');

subscriptionsRouter.get('/current', async (req, res) => ok(res, await svc.currentFor(req.workspace)));

subscriptionsRouter.post(
  '/checkout',
  owner,
  validate({
    body: Joi.object({
      plan: Joi.string().valid(...PAID_PLANS).required(),
      billingPeriod: Joi.string().valid(...BILLING_PERIODS).required(),
      provider: Joi.string().valid('paystack', 'flutterwave').required(),
    }),
  }),
  async (req, res) => {
    const key = req.get('idempotency-key');
    if (key !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw ApiError.badRequest('Idempotency-Key must be 8–100 letters, numbers, dashes or underscores.');
    created(res, await payments.startCheckout(req.workspace, req.valid.body, req.user, key, requestContext(req)));
  },
);

subscriptionsRouter.post('/payments/:reference/check', owner, validate({ params: Joi.object({ reference: Joi.string().pattern(/^bf-[a-f0-9]{24}$/).required() }) }), async (req, res) =>
  ok(res, await payments.checkPayment(req.workspace, req.valid.params.reference)),
);

subscriptionsRouter.post('/cancel', owner, validate({ body: Joi.object({ reason: Joi.string().trim().max(300).allow('') }) }), async (req, res) =>
  ok(res, await svc.cancelSubscription(req.workspace, req.valid.body, req.user, requestContext(req))),
);

subscriptionsRouter.post('/resume', owner, async (req, res) => ok(res, await svc.resumeSubscription(req.workspace, req.user, requestContext(req))));

subscriptionsRouter.get('/history', requirePermission('workspace.update'), async (req, res) => ok(res, await payments.listPayments(req.workspace)));
