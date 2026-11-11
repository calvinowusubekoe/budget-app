import mongoose from 'mongoose';

/**
 * Payments for BudgetFlow subscriptions only. Nothing else in BudgetFlow
 * takes money, and Susu never does.
 *
 * Card details are never seen or stored: checkout happens on the provider's
 * hosted page. We keep the payment method type ("card", "mobile_money") when
 * the provider reports it, and nothing more about the instrument.
 */
const refundSchema = new mongoose.Schema(
  {
    providerRefundId: { type: String, required: true },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    status: { type: String, enum: ['processed', 'pending', 'failed'], required: true },
    processedAt: { type: Date, default: null },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } },
);

const paymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
    provider: { type: String, enum: ['paystack', 'flutterwave'], required: true },
    reference: { type: String, required: true, unique: true }, // ours, sent to the provider
    providerTransactionId: { type: String, default: undefined }, // theirs, once known
    idempotencyKey: { type: String, default: undefined },
    plan: { type: String, enum: ['personal_pro', 'business_pro'], required: true },
    billingPeriod: { type: String, enum: ['monthly', 'yearly'], required: true },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed', 'abandoned', 'review', 'refunded', 'partially_refunded'],
      default: 'pending',
    },
    failureReason: { type: String, default: '' },
    checkoutUrl: { type: String, default: null },
    methodType: { type: String, default: null },
    paidAt: { type: Date, default: null },
    fees: { type: mongoose.Schema.Types.Decimal128, default: null },
    coverage: { start: { type: Date, default: null }, end: { type: Date, default: null } },
    verification: {
      webhookVerifiedAt: { type: Date, default: null },
      apiVerifiedAt: { type: Date, default: null },
      lastCheckedAt: { type: Date, default: null },
      providerStatus: { type: String, default: null },
      checks: { type: Number, default: 0 },
    },
    reconciliationStatus: { type: String, enum: ['unreconciled', 'matched', 'mismatch'], default: 'unreconciled' },
    reconciliationNote: { type: String, default: '' },
    refunds: { type: [refundSchema], default: [] },
  },
  { timestamps: true },
);

paymentSchema.index({ workspaceId: 1, createdAt: -1 });
paymentSchema.index({ userId: 1 });
paymentSchema.index({ status: 1, createdAt: 1 });
paymentSchema.index(
  { provider: 1, providerTransactionId: 1 },
  { unique: true, partialFilterExpression: { providerTransactionId: { $type: 'string' } } },
);
paymentSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

/**
 * Every webhook delivery we accepted (valid signature). The unique
 * (provider, eventId) index is the duplicate-delivery guard. We keep a small
 * summary rather than the raw payload, which carries customer details.
 */
const webhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['paystack', 'flutterwave'], required: true },
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    reference: { type: String, default: null },
    payloadHash: { type: String, required: true },
    signatureVerified: { type: Boolean, required: true },
    processedAt: { type: Date, default: null },
    outcome: { type: String, default: null },
    error: { type: String, default: null },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ reference: 1 });

export const Payment = mongoose.model('Payment', paymentSchema);
export const PaymentWebhookEvent = mongoose.model('PaymentWebhookEvent', webhookEventSchema);
