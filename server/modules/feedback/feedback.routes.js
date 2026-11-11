import { Router } from 'express';
import Joi from 'joi';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { objectId } from '../../validators/common.js';
import { ApiError } from '../../utils/ApiError.js';
import { created, ok } from '../../utils/http.js';
import { User } from '../users/user.model.js';
import { Workspace } from '../workspaces/workspace.model.js';
import { WorkspaceMember } from '../workspaces/workspaceMember.model.js';
import { Feedback } from './feedback.model.js';

export const feedbackRouter = Router();
feedbackRouter.use(requireAuth);

const isAdmin = (user) => env.adminEmails.includes(String(user.email).toLowerCase());
function requireAdmin(req, _res, next) {
  // Non-admins get 404, so the inbox can't be discovered.
  if (!isAdmin(req.user)) return next(ApiError.notFound());
  next();
}

const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => String(req.user._id),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: (_req, res) => res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Thanks! That’s a lot of feedback for one hour. Try again a little later.' } }),
});

feedbackRouter.post(
  '/',
  sendLimiter,
  validate({
    body: Joi.object({
      category: Joi.string().valid('bug', 'idea', 'confusing', 'praise', 'other').required(),
      message: Joi.string().trim().min(3).max(4000).required(),
      rating: Joi.number().integer().min(1).max(5).allow(null),
      page: Joi.string().trim().max(200).allow(''),
      viewport: Joi.string().trim().max(20).allow(''),
    }),
  }),
  async (req, res) => {
    // Only the workspace *type* is kept, and only if the sender belongs to it.
    let workspaceType = null;
    const wsId = req.get('x-workspace-id');
    if (wsId && mongoose.isValidObjectId(wsId) && (await WorkspaceMember.exists({ workspaceId: wsId, userId: req.user._id, status: 'active' }))) {
      workspaceType = (await Workspace.findById(wsId).select('type').lean())?.type ?? null;
    }
    const f = await Feedback.create({ ...req.valid.body, userId: req.user._id, fromName: req.user.name, fromEmail: req.user.email, workspaceType, userAgent: req.get('user-agent')?.slice(0, 300) ?? '' });
    created(res, { id: String(f._id), received: true });
  },
);

feedbackRouter.get('/', requireAdmin, validate({ query: Joi.object({ status: Joi.string().valid('new', 'seen', 'done') }) }), async (req, res) => {
  const rows = await Feedback.find(req.valid.query.status ? { status: req.valid.query.status } : {}).sort({ createdAt: -1 }).limit(500).lean();
  const users = new Map((await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select('name email').lean()).map((u) => [String(u._id), u]));
  ok(
    res,
    rows.map((r) => ({
      id: String(r._id),
      category: r.category,
      message: r.message,
      rating: r.rating,
      page: r.page,
      workspaceType: r.workspaceType,
      userAgent: r.userAgent,
      viewport: r.viewport,
      status: r.status,
      adminNote: r.adminNote,
      createdAt: r.createdAt,
      from: users.get(String(r.userId)) ? { name: users.get(String(r.userId)).name, email: users.get(String(r.userId)).email } : r.fromEmail ? { name: r.fromName, email: r.fromEmail } : null,
    })),
    { meta: { counts: Object.fromEntries((await Feedback.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])).map((c) => [c._id, c.n])) } },
  );
});

feedbackRouter.patch(
  '/:feedbackId',
  requireAdmin,
  validate({ params: Joi.object({ feedbackId: objectId.required() }), body: Joi.object({ status: Joi.string().valid('new', 'seen', 'done'), adminNote: Joi.string().trim().max(1000).allow('') }).min(1) }),
  async (req, res) => {
    const f = await Feedback.findByIdAndUpdate(req.valid.params.feedbackId, { $set: req.valid.body }, { new: true });
    if (!f) throw ApiError.notFound('Feedback not found.');
    ok(res, { id: String(f._id), status: f.status, adminNote: f.adminNote });
  },
);
