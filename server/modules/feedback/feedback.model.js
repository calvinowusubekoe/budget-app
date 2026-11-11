import mongoose from 'mongoose';

/** Feedback from people testing Kontaa. Read by the admins listed in ADMIN_EMAILS. */
const feedbackSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Copied at the time, so the inbox still shows who sent it if the account (e.g. the demo) is later reset.
    fromName: { type: String, default: '' },
    fromEmail: { type: String, default: '' },
    category: { type: String, enum: ['bug', 'idea', 'confusing', 'praise', 'other'], required: true },
    message: { type: String, required: true, maxlength: 4000 },
    rating: { type: Number, min: 1, max: 5, default: null },
    page: { type: String, maxlength: 200, default: '' },
    workspaceType: { type: String, enum: ['personal', 'business', null], default: null },
    userAgent: { type: String, maxlength: 300, default: '' },
    viewport: { type: String, maxlength: 20, default: '' },
    status: { type: String, enum: ['new', 'seen', 'done'], default: 'new' },
    adminNote: { type: String, maxlength: 1000, default: '' },
  },
  { timestamps: true },
);
feedbackSchema.index({ status: 1, createdAt: -1 });

export const Feedback = mongoose.model('Feedback', feedbackSchema);
