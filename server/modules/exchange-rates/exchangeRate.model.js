import mongoose from 'mongoose';

/**
 * A workspace's rate table: 1 unit of `from` = `rate` units of `to`, valid
 * from `effectiveDate`. Transactions copy the rate they used into their own
 * snapshot, so editing this table never changes historical records.
 */
const exchangeRateSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    rate: { type: mongoose.Schema.Types.Decimal128, required: true },
    effectiveDate: { type: Date, required: true },
    source: { type: String, enum: ['manual', 'provider'], required: true },
    provider: { type: String, default: null },
    fetchedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

exchangeRateSchema.index({ workspaceId: 1, from: 1, to: 1, effectiveDate: -1 });
exchangeRateSchema.index({ workspaceId: 1, from: 1, to: 1, effectiveDate: 1, source: 1 }, { unique: true });

export const ExchangeRate = mongoose.model('ExchangeRate', exchangeRateSchema);
