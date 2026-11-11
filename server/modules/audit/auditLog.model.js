import mongoose from 'mongoose';

/**
 * Append-only audit trail. There is deliberately no update or delete API;
 * application code only ever inserts.
 */
const auditLogSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ workspaceId: 1, createdAt: -1 });

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne']) {
  auditLogSchema.pre(op, function blockMutation() {
    throw new Error('Audit log entries are immutable.');
  });
}

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
