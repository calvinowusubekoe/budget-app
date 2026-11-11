import Joi from 'joi';
import { currency, email, objectId } from '../../validators/common.js';

const workspaceId = Joi.object({ workspaceId: objectId.required() });

const business = Joi.object({
  legalName: Joi.string().trim().max(160).allow(''),
  industry: Joi.string().trim().max(80).allow(''),
  country: Joi.string().trim().uppercase().length(2),
});

export const createWorkspaceSchema = {
  body: Joi.object({
    name: Joi.string().trim().min(1).max(80).required(),
    type: Joi.string().valid('personal', 'business').required(),
    baseCurrency: currency.required(),
    business: business.when('type', { is: 'business', otherwise: Joi.forbidden() }),
  }),
};

export const updateWorkspaceSchema = {
  params: workspaceId,
  body: Joi.object({
    name: Joi.string().trim().min(1).max(80),
    baseCurrency: currency,
    business,
  }).min(1),
};

export const workspaceParamSchema = { params: workspaceId };

export const memberParamSchema = {
  params: Joi.object({ workspaceId: objectId.required(), memberId: objectId.required() }),
};

export const updateMemberSchema = {
  ...memberParamSchema,
  body: Joi.object({ role: Joi.string().valid('admin', 'member', 'viewer').required() }),
};

export const createInvitationSchema = {
  params: workspaceId,
  body: Joi.object({ email: email.required(), role: Joi.string().valid('admin', 'member', 'viewer').required() }),
};

export const invitationParamSchema = {
  params: Joi.object({ workspaceId: objectId.required(), invitationId: objectId.required() }),
};

export const acceptInvitationSchema = { body: Joi.object({ token: Joi.string().max(200).required() }) };

export const auditQuerySchema = {
  params: workspaceId,
  query: Joi.object({ limit: Joi.number().integer().min(1).max(200).default(50), before: Joi.date().iso() }),
};
