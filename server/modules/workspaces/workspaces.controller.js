import { ok, created, requestContext } from '../../utils/http.js';
import { listAudit } from '../audit/audit.service.js';
import * as svc from './workspaces.service.js';

export async function list(req, res) {
  ok(res, await svc.listForUser(req.user._id));
}

export async function create(req, res) {
  created(res, await svc.createWorkspace(req.valid.body, req.user, requestContext(req)));
}

export async function get(req, res) {
  ok(res, svc.presentWorkspace(req.workspace, req.membership));
}

export async function update(req, res) {
  ok(res, await svc.updateWorkspace(req.workspace, req.membership, req.valid.body, req.user, requestContext(req)));
}

export async function members(req, res) {
  ok(res, await svc.listMembers(req.workspace._id));
}

export async function updateMember(req, res) {
  const { memberId } = req.valid.params;
  await svc.changeMemberRole(req.workspace, req.membership, memberId, req.valid.body.role, req.user, requestContext(req));
  ok(res, await svc.listMembers(req.workspace._id));
}

export async function removeMember(req, res) {
  await svc.removeMember(req.workspace, req.membership, req.valid.params.memberId, req.user, requestContext(req));
  ok(res, { removed: true });
}

export async function invitations(req, res) {
  ok(res, await svc.listInvitations(req.workspace._id));
}

export async function invite(req, res) {
  created(res, await svc.createInvitation(req.workspace, req.membership, req.valid.body, req.user, requestContext(req)));
}

export async function revokeInvitation(req, res) {
  await svc.revokeInvitation(req.workspace, req.valid.params.invitationId, req.user, requestContext(req));
  ok(res, { revoked: true });
}

export async function acceptInvitation(req, res) {
  ok(res, await svc.acceptInvitation(req.valid.body.token, req.user, requestContext(req)));
}

export async function audit(req, res) {
  ok(res, await listAudit(req.workspace._id, req.valid.query));
}
