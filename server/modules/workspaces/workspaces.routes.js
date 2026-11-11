import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import * as c from './workspaces.controller.js';
import * as v from './workspaces.validators.js';

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

workspacesRouter.get('/', c.list);
workspacesRouter.post('/', validate(v.createWorkspaceSchema), c.create);
workspacesRouter.post('/invitations/accept', validate(v.acceptInvitationSchema), c.acceptInvitation);

workspacesRouter.get('/:workspaceId', validate(v.workspaceParamSchema), requireWorkspace('workspace.read'), c.get);
workspacesRouter.patch('/:workspaceId', validate(v.updateWorkspaceSchema), requireWorkspace('workspace.update'), c.update);

workspacesRouter.get('/:workspaceId/members', validate(v.workspaceParamSchema), requireWorkspace('members.read'), c.members);
workspacesRouter.patch(
  '/:workspaceId/members/:memberId',
  validate(v.updateMemberSchema),
  requireWorkspace('members.manage'),
  c.updateMember,
);
// Permission is resolved in the service: members may remove themselves.
workspacesRouter.delete(
  '/:workspaceId/members/:memberId',
  validate(v.memberParamSchema),
  requireWorkspace('members.read'),
  c.removeMember,
);

workspacesRouter.get(
  '/:workspaceId/invitations',
  validate(v.workspaceParamSchema),
  requireWorkspace('invitations.manage'),
  c.invitations,
);
workspacesRouter.post(
  '/:workspaceId/invitations',
  validate(v.createInvitationSchema),
  requireWorkspace('invitations.manage'),
  c.invite,
);
workspacesRouter.delete(
  '/:workspaceId/invitations/:invitationId',
  validate(v.invitationParamSchema),
  requireWorkspace('invitations.manage'),
  c.revokeInvitation,
);

workspacesRouter.get('/:workspaceId/audit', validate(v.auditQuerySchema), requireWorkspace('audit.read'), c.audit);
