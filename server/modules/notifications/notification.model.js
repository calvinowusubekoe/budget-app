import mongoose from 'mongoose';

/** In-app notifications. `dedupeKey` makes each alert fire once per user. */
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
    type: {
      type: String,
      enum: ['budget_warning', 'budget_exceeded', 'recurring_due', 'recurring_failed', 'recurring_created', 'susu_confirm_request', 'susu_disputed', 'susu_payout_recorded', 'subscription_activated', 'subscription_renewal_due', 'subscription_past_due', 'subscription_expired', 'payment_failed', 'payment_review', 'payment_refunded'],
      required: true,
    },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, default: '', maxlength: 500 },
    link: { type: String, default: null },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    dedupeKey: { type: String, required: true },
    readAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export const Notification = mongoose.model('Notification', notificationSchema);
