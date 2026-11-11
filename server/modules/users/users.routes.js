import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as c from './users.controller.js';
import * as v from './users.validators.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);
usersRouter.get('/me', c.me);
usersRouter.patch('/me', validate(v.updateProfileSchema), c.updateProfile);
usersRouter.post('/me/password', validate(v.changePasswordSchema), c.changePassword);
usersRouter.get('/me/export', c.exportProfile);
