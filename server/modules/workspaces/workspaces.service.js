import { runAtomic } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { recordAudit } from '../audit/audit.service.js';
import { emails, sendMail } from '../../services/mailer.js';
import { User } from '../users/user.model.js';
import { Workspace } from './workspace.model.js';
import { WorkspaceMember } from './workspaceMember.model.js';
import { WorkspaceInvitation } from './workspaceInvitation.model.js';
import { assignableRoles, permissionsFor } from './permissions.js';
import { Transaction } from '../transactions/transaction.model.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Low-level creation used by both registration and the create endpoint. */
export async function createWorkspaceRecords(input, user, session = null) {
  const [workspace] = await Workspace.create(
    [{ name: input.name, type: input.type, baseCurrency: input.baseCurrency, ownerId: user._id, business: input.business }],
    { session },
  );
  const [membership] = await WorkspaceMember.create(
    [{ workspaceId: workspace._id, userId: user._id, role: 'owner' }],
    { session },
  );
  return { workspace, membership };
}

export function presentWorkspace(workspace, membership) {
  return { ...workspace.toPublic(), role: membership.role, permissions: permissionsFor(membership.role) };
}

export async function listForUser(userId) {
  const memberships = await WorkspaceMember.find({ userId, status: 'active' }).lean();
  const workspaces = await Workspace.find({ _id: { $in: memberships.map((m) => m.workspaceId) } }).sort({ createdAt: 1 });
  const byId = new Map(memberships.map((m) => [m.workspaceId.toString(), m]));
  return workspaces.map((w) => presentWorkspace(w, byId.get(w._id.toString())));
}

export async function createWorkspace(input, user, ctx) {
  const { workspace, membership } = await runAtomic((session) => createWorkspaceRecords(input, user, session));
  await recordAudit({
    workspaceId: workspace._id,
    actorId: user._id,
    action: 'workspace.created',
    entityType: 'Workspace',
    entityId: workspace._id,
    metadata: { type: workspace.type, baseCurrency: workspace.baseCurrency },
    ctx,
  });
  return presentWorkspace(workspace, membership);
}

export async function updateWorkspace(workspace, membership, changes, actor, ctx) {
  const before = { name: workspace.name, baseCurrency: workspace.baseCurrency };
  if (changes.business && workspace.type !== 'business') {
    throw ApiError.badRequest('Business details only apply to business workspaces.');
  }
  if (changes.baseCurrency && changes.baseCurrency !== workspace.baseCurrency) {
    // Each transaction stores its amount converted to this currency at the time.
    // Changing it would mix currencies in totals or require silently re-converting history.
    if (await Transaction.exists({ workspaceId: workspace._id })) {
      throw ApiError.conflict(
        `This workspace already has records reported in ${workspace.baseCurrency}, so the reporting currency is locked. Create a new workspace to report in ${changes.baseCurrency}.`,
        'REPORTING_CURRENCY_LOCKED',
      );
    }
  }
  if (changes.name) workspace.name = changes.name;
  if (changes.baseCurrency) workspace.baseCurrency = changes.baseCurrency;
  if (changes.business) Object.assign(workspace.business, changes.business);
  await workspace.save();
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: 'workspace.updated',
    entityType: 'Workspace',
    entityId: workspace._id,
    metadata: { before, after: { name: workspace.name, baseCurrency: workspace.baseCurrency } },
    ctx,
  });
  return presentWorkspace(workspace, membership);
}

export async function listMembers(workspaceId) {
  const members = await WorkspaceMember.find({ workspaceId, status: 'active' })
    .populate('userId', 'name email')
    .sort({ joinedAt: 1 })
    .lean();
  return members.map((m) => ({
    id: m._id.toString(),
    userId: m.userId._id.toString(),
    name: m.userId.name,
    email: m.userId.email,
    role: m.role,
    joinedAt: m.joinedAt,
  }));
}

async function findMember(workspaceId, memberId) {
  const member = await WorkspaceMember.findOne({ _id: memberId, workspaceId, status: 'active' });
  if (!member) throw ApiError.notFound('Member not found.');
  return member;
}

export async function changeMemberRole(workspace, actorMembership, memberId, role, actor, ctx) {
  const member = await findMember(workspace._id, memberId);
  if (member.role === 'owner') throw ApiError.forbidden('The owner’s role cannot be changed.');
  if (member.userId.equals(actor._id)) throw ApiError.forbidden('You cannot change your own role.');
  const allowed = assignableRoles(actorMembership.role);
  if (!allowed.includes(role) || !allowed.includes(member.role)) {
    throw ApiError.forbidden('Only the workspace owner can grant or change admin access.');
  }
  const from = member.role;
  member.role = role;
  await member.save();
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: 'member.role_changed',
    entityType: 'WorkspaceMember',
    entityId: member._id,
    metadata: { from, to: role, userId: member.userId.toString() },
    ctx,
  });
  return member;
}

/** Admins and owners remove others; anyone except the owner can leave. */
export async function removeMember(workspace, actorMembership, memberId, actor, ctx) {
  const member = await findMember(workspace._id, memberId);
  const self = member.userId.equals(actor._id);
  if (member.role === 'owner') throw ApiError.forbidden('The owner cannot be removed from their workspace.');
  if (!self) {
    if (!['owner', 'admin'].includes(actorMembership.role)) throw ApiError.forbidden();
    if (actorMembership.role === 'admin' && member.role === 'admin') {
      throw ApiError.forbidden('Only the owner can remove an admin.');
    }
  }
  member.status = 'removed';
  member.removedAt = new Date();
  await member.save();
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: self ? 'member.left' : 'member.removed',
    entityType: 'WorkspaceMember',
    entityId: member._id,
    metadata: { userId: member.userId.toString(), role: member.role },
    ctx,
  });
}

export async function createInvitation(workspace, actorMembership, { email, role }, actor, ctx) {
  if (workspace.type !== 'business') {
    throw ApiError.badRequest('Personal workspaces are private. Create a business workspace to invite a team.');
  }
  if (!assignableRoles(actorMembership.role).includes(role)) {
    throw ApiError.forbidden('Only the workspace owner can invite admins.');
  }
  const existingUser = await User.findOne({ email }).select('_id');
  if (existingUser && (await WorkspaceMember.exists({ workspaceId: workspace._id, userId: existingUser._id, status: 'active' }))) {
    throw ApiError.conflict('This person is already a member of the workspace.', 'ALREADY_MEMBER');
  }
  // A fresh invite replaces any pending one for the same address.
  await WorkspaceInvitation.updateMany(
    { workspaceId: workspace._id, email, acceptedAt: null, revokedAt: null },
    { revokedAt: new Date() },
  );
  const token = randomToken();
  const invitation = await WorkspaceInvitation.create({
    workspaceId: workspace._id,
    email,
    role,
    tokenHash: sha256(token),
    invitedBy: actor._id,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  await sendMail(emails.workspaceInvite({ email, inviterName: actor.name, workspaceName: workspace.name, role, token }));
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: 'invitation.created',
    entityType: 'WorkspaceInvitation',
    entityId: invitation._id,
    metadata: { email, role },
    ctx,
  });
  return presentInvitation(invitation);
}

export function presentInvitation(inv) {
  return {
    id: inv._id.toString(),
    email: inv.email,
    role: inv.role,
    status: inv.status(),
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
  };
}

export async function listInvitations(workspaceId) {
  const rows = await WorkspaceInvitation.find({ workspaceId, acceptedAt: null, revokedAt: null }).sort({ createdAt: -1 });
  return rows.map(presentInvitation);
}

export async function revokeInvitation(workspace, invitationId, actor, ctx) {
  const inv = await WorkspaceInvitation.findOne({ _id: invitationId, workspaceId: workspace._id, acceptedAt: null, revokedAt: null });
  if (!inv) throw ApiError.notFound('Invitation not found.');
  inv.revokedAt = new Date();
  await inv.save();
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: 'invitation.revoked',
    entityType: 'WorkspaceInvitation',
    entityId: inv._id,
    metadata: { email: inv.email },
    ctx,
  });
}

/** The signed-in account must own the invited email address. */
export async function acceptInvitation(token, user, ctx) {
  const inv = await WorkspaceInvitation.findOne({ tokenHash: sha256(token) });
  if (!inv || inv.status() !== 'pending') {
    throw ApiError.badRequest('This invitation is invalid, expired or already used.');
  }
  if (inv.email !== user.email) {
    throw ApiError.forbidden(`This invitation was sent to a different email address. Sign in with that account to accept it.`);
  }
  const workspace = await Workspace.findById(inv.workspaceId);
  if (!workspace || workspace.status !== 'active') throw ApiError.badRequest('This workspace is no longer available.');

  const membership = await runAtomic(async (session) => {
    const claimed = await WorkspaceInvitation.findOneAndUpdate(
      { _id: inv._id, acceptedAt: null, revokedAt: null },
      { acceptedAt: new Date(), acceptedBy: user._id },
      { session, returnDocument: 'after' },
    );
    if (!claimed) throw ApiError.badRequest('This invitation was already used.');
    return WorkspaceMember.findOneAndUpdate(
      { workspaceId: workspace._id, userId: user._id },
      { role: inv.role, status: 'active', invitedBy: inv.invitedBy, joinedAt: new Date(), removedAt: null },
      { upsert: true, session, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  });

  await recordAudit({
    workspaceId: workspace._id,
    actorId: user._id,
    action: 'invitation.accepted',
    entityType: 'WorkspaceInvitation',
    entityId: inv._id,
    metadata: { role: inv.role },
    ctx,
  });
  return presentWorkspace(workspace, membership);
}
