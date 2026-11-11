import mongoose from 'mongoose';

/**
 * One subscription per workspace. Only the payments service changes plan,
 * status or period dates, and only after a payment the provider has confirmed.
 * No route lets a user write these fields.
 *
 * Kontaa doesn't keep saved cards, so nothing is charged automatically:
 * a renewal is another verified payment that extends currentPeriodEnd.
 */
const subscriptionSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // who bought it
    plan: { type: String, enum: ['personal_pro', 'business_pro'], required: true },
    billingPeriod: { type: String, enum: ['monthly', 'yearly'], required: true },
    status: { type: String, enum: ['active', 'past_due', 'cancelled', 'expired'], required: true },
    startedAt: { type: Date, required: true },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: '', maxlength: 300 },
    endedAt: { type: Date, default: null },
    provider: { type: String, enum: ['paystack', 'flutterwave'], required: true },
    providerReference: { type: String, default: null }, // provider transaction id of the latest payment
    lastPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    currency: { type: String, required: true },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    paymentStatus: { type: String, enum: ['paid', 'refunded', 'partially_refunded'], default: 'paid' },
  },
  { timestamps: true },
);

subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });

export const Subscription = mongoose.model('Subscription', subscriptionSchema);
