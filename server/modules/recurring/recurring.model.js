import mongoose from 'mongoose';

const Dec = mongoose.Schema.Types.Decimal128;

/**
 * A schedule that produces transactions. Occurrence n falls on
 * occurrence(anchorDate, frequency, interval, n); `occurrencesDone` counts
 * how many have been handled (created, sent for confirmation or skipped).
 */
const recurringSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    template: {
      type: { type: String, enum: ['income', 'expense', 'transfer'], required: true },
      accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
      categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
      toAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
      amount: { type: Dec, required: true },
      toAmount: { type: Dec, default: null },
      description: { type: String, required: true, maxlength: 140 },
      payee: { type: String, default: '', maxlength: 80 },
      notes: { type: String, default: '', maxlength: 2000 },
    },
    frequency: { type: String, enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'], required: true },
    interval: { type: Number, min: 1, max: 12, default: 1 },
    anchorDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    // auto: create on the day. remind: notify and wait for the user to confirm.
    mode: { type: String, enum: ['auto', 'remind'], default: 'auto' },
    status: { type: String, enum: ['active', 'paused', 'ended'], default: 'active' },
    occurrencesDone: { type: Number, default: 0 },
    nextRunDate: { type: Date, default: null },
    // Remind mode: dates awaiting confirmation.
    pending: [{ type: Date }],
    lastRunAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    timezone: { type: String, default: 'Africa/Accra' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

recurringSchema.index({ status: 1, nextRunDate: 1 });

export const RecurringTransaction = mongoose.model('RecurringTransaction', recurringSchema);
