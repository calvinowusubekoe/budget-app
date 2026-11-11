import { AuditLog } from './auditLog.model.js';

/**
 * Records an audit entry. Callers pass the request context so IP and user
 * agent are captured; metadata must never include secrets or tokens.
 */
export async function recordAudit({ workspaceId = null, actorId = null, action, entityType, entityId = null, metadata = {}, ctx = {} }) {
  return AuditLog.create({
    workspaceId,
    actorId,
    action,
    entityType,
    entityId,
    metadata,
    ip: ctx.ip ?? '',
    userAgent: ctx.userAgent ?? '',
  });
}

export async function listAudit(workspaceId, { limit = 50, before, entityType, entityId } = {}) {
  const query = { workspaceId };
  if (before) query.createdAt = { $lt: before };
  if (entityType) query.entityType = entityType;
  if (entityId) query.entityId = entityId;
  const rows = await AuditLog.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('actorId', 'name email')
    .lean();
  return rows.map((r) => ({
    id: r._id.toString(),
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId?.toString() ?? null,
    metadata: r.metadata,
    actor: r.actorId ? { id: r.actorId._id.toString(), name: r.actorId.name } : null,
    createdAt: r.createdAt,
  }));
}
