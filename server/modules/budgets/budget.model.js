import mongoose from 'mongoose';

/**
 * A spending limit per period, in the workspace's reporting currency.
 * Amount changes are appended to `amounts` with the period they start from,
 * so past periods are always compared with the limit that applied then.
 */
const amountSchema = new mongoose.Schema(
  {
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    effectiveFrom: { type: Date, required: true },
  },
  { _id: false },
);

const budgetSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    period: { type: String, enum: ['weekly', 'monthly', 'yearly'], required: true },
    // all = every expense in the workspace; categories = only the listed ones
    scope: { type: String, enum: ['all', 'categories'], required: true },
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    currency: { type: String, required: true },
    amounts: { type: [amountSchema], validate: (v) => v.length > 0 },
    alertAt: { type: Number, min: 1, max: 100, default: 80 },
    status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active' },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

export const Budget = mongoose.model('Budget', budgetSchema);
