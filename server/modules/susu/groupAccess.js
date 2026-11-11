import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { SusuActivityLog, SusuGroup, SusuGroupMember } from './group.models.js';

/**
 * Group permissions. Organisers can do everything. Assistants get the
 * capabilities the group's settings grant them. Members can view the group
 * and act on records about themselves (confirm or dispute).
 */
export const CAPABILITIES = ['manageSettings', 'manageMembers', 'manageCycles', 'recordContributions', 'recordPayouts', 'viewAllRecords', 'viewContacts', 'cancelConfirmed'];

export function groupCan(group, membership, capability) {
  if (!CAPABILITIES.includes(capability)) throw new Error(`Unknown group capability: ${capability}`);
  if (!membership || membership.status !== 'active') return false;
  if (membership.role === 'organizer') return true;
  if (membership.role === 'assistant') {
    const p = group.assistantPermissions ?? {};
    switch (capability) {
      case 'manageMembers':
      case 'viewContacts':
        return Boolean(p.manageMembers);
      case 'manageCycles':
        return Boolean(p.manageCycles);
      case 'recordContributions':
        return Boolean(p.recordContributions);
      case 'recordPayouts':
        return Boolean(p.recordPayouts);
      case 'viewAllRecords':
        return true;
      default:
        return false; // manageSettings, cancelConfirmed: organisers only
    }
  }
  return false;
}

export function capabilitiesFor(group, membership) {
  return CAPABILITIES.filter((c) => groupCan(group, membership, c));
}

/**
 * Loads the group and the caller's membership. People who aren't active or
 * suspended members get 404, so group IDs can't be probed. Suspended members
 * can still view, but every capability check fails for them.
 */
export function loadGroup() {
  return async (req, _res, next) => {
    const id = req.params.groupId;
    if (!mongoose.isValidObjectId(id)) return next(ApiError.notFound('Group not found.'));
    const [group, membership] = await Promise.all([
      SusuGroup.findById(id),
      SusuGroupMember.findOne({ groupId: id, userId: req.user._id, status: { $in: ['active', 'suspended'] } }),
    ]);
    if (!group || !membership) return next(ApiError.notFound('Group not found.'));
    req.group = group;
    req.groupMember = membership;
    next();
  };
}

export function requireCapability(capability) {
  return (req, _res, next) => {
    if (!groupCan(req.group, req.groupMember, capability)) {
      return next(ApiError.forbidden(req.groupMember.status === 'suspended' ? 'Your membership is suspended, so you can only view this group.' : 'Only the group’s organisers can do that.'));
    }
    if (req.group.status !== 'active' && capability !== 'viewAllRecords' && capability !== 'viewContacts') {
      return next(ApiError.forbidden(`This group is ${req.group.status} and read-only.`));
    }
    next();
  };
}

export async function logActivity(group, { actorId = null, action, entityType, entityId = null, memberId = null, metadata = {} }) {
  return SusuActivityLog.create({ groupId: group._id, actorId, action, entityType, entityId, memberId, metadata });
}
