import mongoose from 'mongoose';

const consentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['terms', 'privacy', 'marketing'], required: true },
    version: { type: String, required: true },
    granted: { type: Boolean, required: true },
    recordedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    emailVerifiedAt: { type: Date, default: null },
    defaultCurrency: { type: String, required: true, default: 'GHS' },
    locale: { type: String, default: 'en-GH' },
    timezone: { type: String, default: 'Africa/Accra' },
    lastWorkspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
    onboardingCompletedAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    // Consent history is append-only so the record shows what was agreed and when.
    consents: { type: [consentSchema], default: [] },
    failedLoginCount: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    emailVerified: Boolean(this.emailVerifiedAt),
    defaultCurrency: this.defaultCurrency,
    locale: this.locale,
    timezone: this.timezone,
    lastWorkspaceId: this.lastWorkspaceId?.toString() ?? null,
    onboardingCompleted: Boolean(this.onboardingCompletedAt),
    marketingConsent: latestConsent(this.consents, 'marketing'),
    createdAt: this.createdAt,
  };
};

function latestConsent(consents, type) {
  const entries = consents.filter((c) => c.type === type);
  return entries.length ? entries[entries.length - 1].granted : false;
}

export const User = mongoose.model('User', userSchema);
