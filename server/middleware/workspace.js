import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { Workspace } from '../modules/workspaces/workspace.model.js';
import { WorkspaceMember } from '../modules/workspaces/workspaceMember.model.js';
import { can } from '../modules/workspaces/permissions.js';

/**
 * Resolves the workspace from :workspaceId or the X-Workspace-Id header,
 * confirms an active membership, and enforces the named permission. Every
 * workspace-scoped route must pass through this; data queries then filter on
 * req.workspace._id so one workspace can never read another's records.
 *
 * Non-members get 404 rather than 403 so workspace IDs cannot be probed.
 */
export function requireWorkspace(permission = 'workspace.read') {
  return async (req, _res, next) => {
    const id = req.params.workspaceId ?? req.get('x-workspace-id');
    if (!id || !mongoose.isValidObjectId(id)) {
      return next(ApiError.badRequest('Choose a workspace first.'));
    }

    const membership = await WorkspaceMember.findOne({ workspaceId: id, userId: req.user._id, status: 'active' });
    if (!membership) return next(ApiError.notFound('Workspace not found.'));

    const workspace = await Workspace.findById(id);
    if (!workspace) return next(ApiError.notFound('Workspace not found.'));
    if (workspace.status === 'archived' && permission !== 'workspace.read') {
      return next(ApiError.forbidden('This workspace is archived and read-only.'));
    }
    if (!can(membership.role, permission)) return next(ApiError.forbidden());

    req.workspace = workspace;
    req.membership = membership;
    next();
  };
}

/** Narrower check after requireWorkspace has loaded the membership. */
export function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.membership) return next(new Error('requirePermission used without requireWorkspace'));
    if (req.workspace.status === 'archived' && permission !== 'records.read') {
      return next(ApiError.forbidden('This workspace is archived and read-only.'));
    }
    if (!can(req.membership.role, permission)) return next(ApiError.forbidden());
    next();
  };
}
