import { Router } from 'express';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { calendarDate } from '../../validators/money.js';
import { ApiError } from '../../utils/ApiError.js';
import { ok, requestContext } from '../../utils/http.js';
import { addMonths, daysBetween, todayIn } from '../../utils/periods.js';
import { can } from '../workspaces/permissions.js';
import * as svc from './ai.service.js';

/** Optional AI assistant. Read-only: no route here changes financial records. */
export const aiRouter = Router();
aiRouter.use(requireAuth);

aiRouter.post('/consent', async (req, res) => {
  await svc.giveConsent(req.user, requestContext(req));
  ok(res, { consented: true });
});
aiRouter.delete('/consent', async (req, res) => {
  await svc.withdrawConsent(req.user, requestContext(req));
  ok(res, { consented: false });
});

aiRouter.use(requireWorkspace('records.read'));
aiRouter.get('/status', async (req, res) => ok(res, await svc.aiStatus(req.workspace, req.user)));
aiRouter.patch('/workspace', requirePermission('workspace.update'), validate({ body: Joi.object({ enabled: Joi.boolean().required() }) }), async (req, res) =>
  ok(res, await svc.setWorkspaceAi(req.workspace, req.valid.body.enabled, req.user, requestContext(req))),
);

const askLimiter = rateLimit({
  windowMs: 60_000,
  limit: 8,
  keyGenerator: (req) => String(req.user._id),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: (_req, res) => res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'That’s a lot of questions at once. Wait a minute and try again.' } }),
});

const turn = Joi.object({ role: Joi.string().valid('user', 'assistant').required(), content: Joi.string().trim().min(1).max(4000).required() });

aiRouter.post(
  '/ask',
  askLimiter,
  validate({
    body: Joi.object({
      question: Joi.string().trim().min(2).max(1000).required(),
      history: Joi.array().items(turn).max(8).default([]),
      from: calendarDate,
      to: calendarDate,
    }),
  }),
  async (req, res) => {
    const today = todayIn(req.user.timezone);
    const { question, history } = req.valid.body;
    // Default: the current month and the two before it.
    const to = req.valid.body.to ?? today;
    const from = req.valid.body.from ?? `${addMonths(to, -2).slice(0, 7)}-01`;
    if (from > to || daysBetween(from, to) > 3660) throw ApiError.badRequest('Choose a range of up to ten years, start before end.');
    if (history.length && history[0].role !== 'user') throw ApiError.badRequest('The conversation must start with a question.');
    ok(res, await svc.ask(req.workspace, req.user, { question, history, from, to }, today, { includeSubscriptions: can(req.membership.role, 'workspace.update') }, requestContext(req)));
  },
);
