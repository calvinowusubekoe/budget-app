import mongoose from 'mongoose';

export const ACCOUNT_TYPES = ['cash', 'bank', 'mobile_money', 'savings', 'other'];

/**
 * A tracking account: a label for where money sits outside BudgetFlow.
 * BudgetFlow cannot see, access or move the real funds. The balance is
 * derived from the opening balance plus recorded transactions.
 */
const accountSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    currency: { type: String, required: true },
    institution: { type: String, trim: true, maxlength: 80, default: '' },
    openingBalance: { type: mongoose.Schema.Types.Decimal128, required: true },
    openingDate: { type: Date, required: true },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

accountSchema.index({ workspaceId: 1, status: 1, name: 1 });

export const Account = mongoose.model('Account', accountSchema);
