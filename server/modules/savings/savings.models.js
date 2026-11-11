import mongoose from 'mongoose';

const Dec = mongoose.Schema.Types.Decimal128;

/**
 * A savings target the user tracks. The amount saved is the sum of entries
 * the user records; the money itself is wherever the user keeps it.
 * BudgetFlow never holds it.
 */
const savingsGoalSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    targetAmount: { type: Dec, required: true },
    currency: { type: String, required: true },
    targetDate: { type: Date, default: null },
    contributionFrequency: { type: String, enum: ['weekly', 'monthly', 'quarterly', 'none'], default: 'monthly' },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

/** Entries are never edited; a mistake is reversed with a reason. */
const savingsEntrySchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    goalId: { type: mongoose.Schema.Types.ObjectId, ref: 'SavingsGoal', required: true },
    type: { type: String, enum: ['contribution', 'withdrawal'], required: true },
    amount: { type: Dec, required: true },
    date: { type: Date, required: true },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: ['recorded', 'reversed'], default: 'recorded' },
    reversedAt: { type: Date, default: null },
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reversalReason: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

savingsEntrySchema.index({ workspaceId: 1, goalId: 1, date: -1 });

export const SavingsGoal = mongoose.model('SavingsGoal', savingsGoalSchema);
export const SavingsEntry = mongoose.model('SavingsEntry', savingsEntrySchema);
