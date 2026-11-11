import mongoose from 'mongoose';

const workspaceInvitationSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ['admin', 'member', 'viewer'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

workspaceInvitationSchema.index({ workspaceId: 1, email: 1 });

workspaceInvitationSchema.methods.status = function status(now = new Date()) {
  if (this.acceptedAt) return 'accepted';
  if (this.revokedAt) return 'revoked';
  if (this.expiresAt <= now) return 'expired';
  return 'pending';
};

export const WorkspaceInvitation = mongoose.model('WorkspaceInvitation', workspaceInvitationSchema);
