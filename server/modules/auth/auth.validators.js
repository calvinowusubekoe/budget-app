import Joi from 'joi';
import { currency, email, objectId, password, personName } from '../../validators/common.js';

export const registerSchema = {
  body: Joi.object({
    name: personName.required(),
    email: email.required(),
    password: password.required(),
    defaultCurrency: currency.default('GHS'),
    acceptTerms: Joi.boolean().valid(true).required().messages({ 'any.only': 'Accept the terms to continue.' }),
    acceptPrivacy: Joi.boolean()
      .valid(true)
      .required()
      .messages({ 'any.only': 'Accept the privacy notice to continue.' }),
    marketingConsent: Joi.boolean().default(false),
  }),
};

export const loginSchema = {
  body: Joi.object({
    email: email.required(),
    password: Joi.string().max(200).required(),
  }),
};

export const forgotPasswordSchema = { body: Joi.object({ email: email.required() }) };

export const resetPasswordSchema = {
  body: Joi.object({
    token: Joi.string().max(200).required(),
    password: password.required(),
  }),
};

export const verifyEmailSchema = { body: Joi.object({ token: Joi.string().max(200).required() }) };

export const sessionIdSchema = { params: Joi.object({ sessionId: objectId.required() }) };
