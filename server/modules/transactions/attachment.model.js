import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true },
    originalName: { type: String, required: true, maxlength: 200 },
    mimeType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    storageKey: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

attachmentSchema.index({ workspaceId: 1, transactionId: 1 });

export const Attachment = mongoose.model('Attachment', attachmentSchema);
