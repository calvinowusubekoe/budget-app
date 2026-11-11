import mongoose from 'mongoose';

const Dec = mongoose.Schema.Types.Decimal128;
const Id = mongoose.Schema.Types.ObjectId;

/*
 * Practical business bookkeeping: customers, suppliers, invoices and bills.
 * Not certified accounting or tax software. Payments recorded against a
 * document create ordinary income/expense transactions in a tracking account;
 * BudgetFlow never collects or pays the money itself.
 */

const contactFields = {
  workspaceId: { type: Id, ref: 'Workspace', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
  phone: { type: String, trim: true, maxlength: 30, default: '' },
  address: { type: String, trim: true, maxlength: 300, default: '' },
  taxId: { type: String, trim: true, maxlength: 40, default: '' },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  createdBy: { type: Id, ref: 'User', required: true },
};

const lineSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 200 },
    quantity: { type: Dec, required: true },
    unitPrice: { type: Dec, required: true },
    // Percentage, e.g. 15 for 15%. Optional; BudgetFlow doesn't apply tax rules.
    taxRate: { type: Dec, default: null },
    amount: { type: Dec, required: true },
    tax: { type: Dec, required: true },
  },
  { _id: false },
);

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Dec, required: true },
    date: { type: Date, required: true },
    accountId: { type: Id, ref: 'Account', required: true },
    transactionId: { type: Id, ref: 'Transaction', required: true },
    recordedBy: { type: Id, ref: 'User', required: true },
    // Removing a payment soft-deletes its transaction; the entry stays for history.
    removedAt: { type: Date, default: null },
    removedBy: { type: Id, ref: 'User', default: null },
    removeReason: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const documentFields = {
  workspaceId: { type: Id, ref: 'Workspace', required: true },
  number: { type: String, required: true },
  issueDate: { type: Date, required: true },
  dueDate: { type: Date, required: true },
  currency: { type: String, required: true },
  lines: { type: [lineSchema], validate: (v) => v.length > 0 },
  subtotal: { type: Dec, required: true },
  taxTotal: { type: Dec, required: true },
  total: { type: Dec, required: true },
  payments: { type: [paymentSchema], default: [] },
  // draft: editable, not yet counted as owed. issued: sent/received and owed. void: withdrawn.
  status: { type: String, enum: ['draft', 'issued', 'void'], default: 'draft' },
  issuedAt: { type: Date, default: null },
  voidedAt: { type: Date, default: null },
  voidReason: { type: String, default: '' },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  terms: { type: String, trim: true, maxlength: 1000, default: '' },
  createdBy: { type: Id, ref: 'User', required: true },
};

const invoiceSchema = new mongoose.Schema({ ...documentFields, customerId: { type: Id, ref: 'Customer', required: true } }, { timestamps: true });
invoiceSchema.index({ workspaceId: 1, number: 1 }, { unique: true });
invoiceSchema.index({ workspaceId: 1, customerId: 1 });

const billSchema = new mongoose.Schema(
  {
    ...documentFields,
    supplierId: { type: Id, ref: 'Supplier', required: true },
    // The supplier's own invoice number, as printed on their paperwork.
    reference: { type: String, trim: true, maxlength: 60, default: '' },
  },
  { timestamps: true },
);
billSchema.index({ workspaceId: 1, number: 1 }, { unique: true });
billSchema.index({ workspaceId: 1, supplierId: 1 });

/** Atomic per-workspace sequences for document numbers. */
const counterSchema = new mongoose.Schema({ workspaceId: { type: Id, required: true }, key: { type: String, required: true }, seq: { type: Number, default: 0 } });
counterSchema.index({ workspaceId: 1, key: 1 }, { unique: true });

export const Customer = mongoose.model('Customer', new mongoose.Schema(contactFields, { timestamps: true }));
export const Supplier = mongoose.model('Supplier', new mongoose.Schema(contactFields, { timestamps: true }));
export const Invoice = mongoose.model('Invoice', invoiceSchema);
export const Bill = mongoose.model('Bill', billSchema);
export const Counter = mongoose.model('Counter', counterSchema);

export async function nextNumber(workspaceId, key, prefix) {
  const c = await Counter.findOneAndUpdate({ workspaceId, key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return `${prefix}${String(c.seq).padStart(4, '0')}`;
}
