import mongoose from 'mongoose';

/**
 * One row per signed-in device. The refresh secret is stored only as a
 * SHA-256 hash and rotated on every refresh. Presenting the previous secret
 * after rotation is treated as token theft and revokes the session.
 */
const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true },
    previousTokenHash: { type: String, default: null },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { timestamps: true },
);

// Expired sessions are removed by MongoDB a day after they lapse.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

sessionSchema.methods.isActive = function isActive(now = new Date()) {
  return !this.revokedAt && this.expiresAt > now;
};

export const Session = mongoose.model('Session', sessionSchema);
