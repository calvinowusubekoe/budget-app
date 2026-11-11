import mongoose from 'mongoose';

const Dec = mongoose.Schema.Types.Decimal128;

/**
 * A loan or credit the user tracks, either money they owe (i_owe) or money owed
 * to them (owed_to_me). Payments recorded here are a separate ledger; they
 * don't move account balances or count as spending.
 */
const debtSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    direction: { type: String, enum: ['i_owe', 'owed_to_me'], required: true },
    counterparty: { type: String, trim: true, maxlength: 80, default: '' },
    principal: { type: Dec, required: true },
    currency: { type: String, required: true },
    // Annual percentage, for reference only. Interest is recorded as charges, never calculated silently.
    interestRate: { type: Dec, default: null },
    startDate: { type: Date, required: true },
    dueDate: { type: Date, default: null },
    minimumPayment: { type: Dec, default: null },
    paymentFrequency: { type: String, enum: ['weekly', 'monthly', 'quarterly', 'none'], default: 'monthly' },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: ['active', 'paid_off', 'archived'], default: 'active' },
    paidOffAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

/** payment: reduces the balance. charge: interest, fees or extra borrowing; increases it. */
const debtPaymentSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    debtId: { type: mongoose.Schema.Types.ObjectId, ref: 'Debt', required: true },
    type: { type: String, enum: ['payment', 'charge'], required: true },
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

debtPaymentSchema.index({ workspaceId: 1, debtId: 1, date: -1 });

export const Debt = mongoose.model('Debt', debtSchema);
export const DebtPayment = mongoose.model('DebtPayment', debtPaymentSchema);
