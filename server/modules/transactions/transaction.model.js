import mongoose from 'mongoose';

const Dec = mongoose.Schema.Types.Decimal128;

export const RATE_SOURCES = ['same', 'entered', 'manual', 'provider'];
export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

/**
 * Snapshot of the conversion used when the record was saved. It is never
 * recalculated from today's rates.
 *  same:     already in the reporting currency (rate 1)
 *  entered:  rate typed in for this transaction
 *  manual:   taken from the workspace's manual rate table
 *  provider: taken from an automatic rate provider
 * `estimated` marks rates that were inverted or are dated before the transaction.
 */
const reportingSchema = new mongoose.Schema(
  {
    currency: { type: String, required: true },
    rate: { type: Dec, required: true },
    amount: { type: Dec, required: true },
    source: { type: String, enum: RATE_SOURCES, required: true },
    estimated: { type: Boolean, default: false },
    rateDate: { type: Date, default: null },
    provider: { type: String, default: null },
  },
  { _id: false },
);

const transactionSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    // Transfers move money between tracking accounts; they are never income or expense.
    type: { type: String, enum: ['income', 'expense', 'transfer'], required: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    amount: { type: Dec, required: true },
    currency: { type: String, required: true },
    toAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    toAmount: { type: Dec, default: null },
    toCurrency: { type: String, default: null },
    date: { type: Date, required: true },
    description: { type: String, trim: true, maxlength: 140, required: true },
    payee: { type: String, trim: true, maxlength: 80, default: '' },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    reporting: { type: reportingSchema, required: true },
    recurrence: {
      isRecurring: { type: Boolean, default: false },
      frequency: { type: String, enum: [...FREQUENCIES, null], default: null },
    },
    // reconciled = checked against a statement; locked against edits and deletion.
    status: { type: String, enum: ['recorded', 'reconciled'], default: 'recorded' },
    reconciledAt: { type: Date, default: null },
    reconciledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    attachmentCount: { type: Number, default: 0 },
    // Set when created by (or turned into) a recurring schedule.
    recurringId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecurringTransaction', default: null },
    // Set when this transaction records a payment on an invoice or bill. It is then managed from that document.
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    billId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bill', default: null },
    // Client-generated key so a retried or offline-queued create is saved once.
    clientRef: { type: String, default: undefined },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);

transactionSchema.index({ workspaceId: 1, deletedAt: 1, date: -1, _id: -1 });
transactionSchema.index({ workspaceId: 1, accountId: 1, date: -1 });
transactionSchema.index({ workspaceId: 1, toAccountId: 1 }, { partialFilterExpression: { toAccountId: { $type: 'objectId' } } });
transactionSchema.index({ workspaceId: 1, categoryId: 1, date: -1 });
transactionSchema.index({ workspaceId: 1, clientRef: 1 }, { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } });

export const Transaction = mongoose.model('Transaction', transactionSchema);
