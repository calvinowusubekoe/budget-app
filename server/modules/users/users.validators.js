import Joi from 'joi';
import { currency, objectId, password, personName } from '../../validators/common.js';

export const updateProfileSchema = {
  body: Joi.object({
    name: personName,
    defaultCurrency: currency,
    locale: Joi.string().max(20).pattern(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/),
    timezone: Joi.string().max(60),
    lastWorkspaceId: objectId,
    onboardingCompleted: Joi.boolean().valid(true),
    marketingConsent: Joi.boolean(),
  }).min(1),
};

export const changePasswordSchema = {
  body: Joi.object({ currentPassword: Joi.string().max(200).required(), newPassword: password.required() }),
};
