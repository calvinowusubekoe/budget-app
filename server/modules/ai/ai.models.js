import mongoose from 'mongoose';

/**
 * A user's consent to send their financial summaries to the AI provider.
 * Withdrawing deletes the record; the assistant then refuses until consent
 * is given again.
 */
const aiConsentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    version: { type: String, required: true },
    consentedAt: { type: Date, required: true },
  },
  { timestamps: false },
);

/**
 * One row per question, for plan limits and cost monitoring. The question
 * and answer text are never stored.
 */
const aiUsageSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    model: { type: String, required: true },
    feature: { type: String, enum: ['ask', 'scan'], default: 'ask' },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    outcome: { type: String, enum: ['answered', 'refused', 'error'], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
aiUsageSchema.index({ workspaceId: 1, createdAt: -1 });
aiUsageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });

// Bumped when what's sent changes; everyone is asked again. 2026-11-11.2 added receipt images.
export const AI_CONSENT_VERSION = '2026-11-11.2';
export const AiConsent = mongoose.model('AiConsent', aiConsentSchema);
export const AiUsage = mongoose.model('AiUsage', aiUsageSchema);
