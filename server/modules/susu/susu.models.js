import mongoose from 'mongoose';

const Dec = mongoose.Schema.Types.Decimal128;

/*
 * Personal Susu is record-keeping only. Kontaa never collects, holds,
 * pools, moves or pays out Susu money; these records describe savings the
 * user keeps themselves or with a collector. See docs/susu-business-rules.md.
 */

export const LOCATION_TYPES = ['home_box', 'envelope', 'safe', 'collector', 'other'];
export const SUSU_FREQUENCIES = ['daily', 'weekly', 'monthly', 'custom'];

const attachmentSchema = new mongoose.Schema(
  {
    storageKey: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
  },
  { _id: false },
);

const susuPlanSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    currency: { type: String, required: true },
    targetAmount: { type: Dec, default: null },
    // The planned contribution per period. Changes are appended so past periods keep their expectation.
    contributionAmounts: [
      {
        _id: false,
        amount: { type: Dec, required: true },
        effectiveFrom: { type: Date, required: true },
      },
    ],
    frequency: { type: String, enum: SUSU_FREQUENCIES, required: true },
    // For custom frequency: a contribution every N days.
    intervalDays: { type: Number, min: 2, max: 90, default: null },
    startDate: { type: Date, required: true },
    targetDate: { type: Date, default: null },
    location: {
      type: { type: String, enum: LOCATION_TYPES, required: true },
      label: { type: String, trim: true, maxlength: 80, default: '' },
    },
    status: { type: String, enum: ['active', 'paused', 'completed', 'cancelled'], default: 'active' },
    // Periods due inside a pause are not counted as missed.
    pauses: [{ _id: false, from: { type: Date, required: true }, to: { type: Date, default: null } }],
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

const entryFields = {
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SusuPlan', required: true },
  amount: { type: Dec, required: true },
  currency: { type: String, required: true },
  date: { type: Date, required: true },
  notes: { type: String, trim: true, maxlength: 500, default: '' },
  // Entries are never edited or deleted; a mistake is cancelled with a reason.
  status: { type: String, enum: ['recorded', 'cancelled'], default: 'recorded' },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelReason: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Idempotency-Key from the client (offline drafts replay with the same key).
  clientRef: { type: String, default: undefined },
};

const susuContributionSchema = new mongoose.Schema(
  { ...entryFields, attachment: { type: attachmentSchema, default: null } },
  { timestamps: true },
);
susuContributionSchema.index({ workspaceId: 1, planId: 1, date: 1 });
susuContributionSchema.index({ createdBy: 1, clientRef: 1 }, { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } });

const susuWithdrawalSchema = new mongoose.Schema(
  { ...entryFields, reason: { type: String, trim: true, maxlength: 200, required: true } },
  { timestamps: true },
);
susuWithdrawalSchema.index({ workspaceId: 1, planId: 1, date: 1 });
susuWithdrawalSchema.index({ createdBy: 1, clientRef: 1 }, { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } });

export const SusuPlan = mongoose.model('SusuPlan', susuPlanSchema);
export const SusuContribution = mongoose.model('SusuContribution', susuContributionSchema);
export const SusuWithdrawal = mongoose.model('SusuWithdrawal', susuWithdrawalSchema);
