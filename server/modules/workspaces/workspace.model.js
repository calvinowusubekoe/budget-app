import mongoose from 'mongoose';

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: ['personal', 'business'], required: true },
    // Reporting currency for this workspace's summaries.
    baseCurrency: { type: String, required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Owners and admins can switch the AI assistant off for everyone in the workspace.
    aiAssistantEnabled: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    business: {
      legalName: { type: String, trim: true, maxlength: 160, default: '' },
      industry: { type: String, trim: true, maxlength: 80, default: '' },
      country: { type: String, trim: true, maxlength: 2, default: 'GH' },
    },
  },
  { timestamps: true },
);

workspaceSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    type: this.type,
    baseCurrency: this.baseCurrency,
    ownerId: this.ownerId.toString(),
    status: this.status,
    business: this.type === 'business' ? this.business : undefined,
    aiAssistantEnabled: this.aiAssistantEnabled !== false,
    createdAt: this.createdAt,
  };
};

export const Workspace = mongoose.model('Workspace', workspaceSchema);
