import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimiters.js';
import * as c from './auth.controller.js';
import * as v from './auth.validators.js';

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate(v.registerSchema), c.register);
authRouter.post('/login', authLimiter, validate(v.loginSchema), c.login);
authRouter.post('/refresh', c.refresh);
authRouter.post('/logout', c.logout);
authRouter.post('/logout-all', requireAuth, c.logoutAll);
authRouter.post('/forgot-password', authLimiter, validate(v.forgotPasswordSchema), c.forgotPassword);
authRouter.post('/reset-password', authLimiter, validate(v.resetPasswordSchema), c.resetPassword);
authRouter.post('/verify-email', authLimiter, validate(v.verifyEmailSchema), c.verifyEmail);
authRouter.post('/resend-verification', authLimiter, requireAuth, c.resendVerification);
authRouter.get('/me', requireAuth, c.me);
authRouter.get('/sessions', requireAuth, c.sessions);
authRouter.delete('/sessions/:sessionId', requireAuth, validate(v.sessionIdSchema), c.revokeSessionById);
