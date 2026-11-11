import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { objectId } from '../../validators/common.js';
import { ok } from '../../utils/http.js';
import * as svc from './notifications.service.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', validate({ query: Joi.object({ limit: Joi.number().integer().min(1).max(100).default(30), unreadOnly: Joi.boolean().default(false) }) }), async (req, res) => {
  const { items, unread } = await svc.listNotifications(req.user._id, req.valid.query);
  ok(res, items, { meta: { unread } });
});
notificationsRouter.post('/read-all', async (req, res) => {
  await svc.markAllRead(req.user._id);
  ok(res, { read: true });
});
notificationsRouter.post('/:notificationId/read', validate({ params: Joi.object({ notificationId: objectId.required() }) }), async (req, res) => {
  await svc.markRead(req.user._id, req.valid.params.notificationId);
  ok(res, { read: true });
});
