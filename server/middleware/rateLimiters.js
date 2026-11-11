import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const handler = (_req, res) =>
  res.status(429).json({
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Wait a few minutes and try again.' },
  });

const base = { standardHeaders: 'draft-7', legacyHeaders: false, handler, skip: () => env.isTest };

export const apiLimiter = rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 600 });

/** Credential endpoints: login, register, password reset. */
export const authLimiter = rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 20 });
export const webhookLimiter = rateLimit({ ...base, windowMs: 60 * 1000, limit: 300 });
