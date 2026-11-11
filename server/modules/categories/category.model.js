import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    kind: { type: String, enum: ['income', 'expense'], required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Case-insensitive uniqueness within a workspace and kind.
    nameKey: { type: String, required: true },
    icon: { type: String, default: 'tag', maxlength: 40 },
    // Set for built-in categories so they can be recognised after renaming.
    systemKey: { type: String, default: null },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

categorySchema.index({ workspaceId: 1, kind: 1, nameKey: 1 }, { unique: true });

export const Category = mongoose.model('Category', categorySchema);
