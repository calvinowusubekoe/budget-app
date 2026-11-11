/**
 * Workspace role model. The backend is the only authority; the client gets
 * the resolved permission list for display purposes only.
 */
export const ROLES = Object.freeze(['owner', 'admin', 'member', 'viewer']);

export const PERMISSIONS = Object.freeze({
  'workspace.read': ['owner', 'admin', 'member', 'viewer'],
  'workspace.update': ['owner', 'admin'],
  'workspace.archive': ['owner'],
  'members.read': ['owner', 'admin', 'member', 'viewer'],
  'members.manage': ['owner', 'admin'],
  'invitations.manage': ['owner', 'admin'],
  'audit.read': ['owner', 'admin'],
  'records.read': ['owner', 'admin', 'member', 'viewer'],
  'records.write': ['owner', 'admin', 'member'],
  'billing.manage': ['owner'],
});

export function can(role, permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) throw new Error(`Unknown permission: ${permission}`);
  return allowed.includes(role);
}

export function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter((p) => PERMISSIONS[p].includes(role));
}

/** Roles a given actor may assign to others. Only owners create admins. */
export function assignableRoles(actorRole) {
  if (actorRole === 'owner') return ['admin', 'member', 'viewer'];
  if (actorRole === 'admin') return ['member', 'viewer'];
  return [];
}
