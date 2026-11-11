import mongoose from 'mongoose';
import { SUSU_FREQUENCIES } from './susu.models.js';

const Dec = mongoose.Schema.Types.Decimal128;
const Id = mongoose.Schema.Types.ObjectId;

/*
 * Group Susu is record-keeping only. Members and organisers collect and pay
 * out among themselves, outside Kontaa. Nothing here holds, pools, moves
 * or pays out money; "payout" records describe payouts that already happened.
 * See docs/susu-business-rules.md.
 *
 * Groups live outside workspaces: their members are different people with
 * their own accounts, so access is governed by group membership and roles.
 */

export const GROUP_ROLES = ['organizer', 'assistant', 'member'];
export const RECORD_STATUSES = ['recorded', 'confirmed', 'disputed', 'cancelled'];

const eventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['recorded', 'corrected', 'confirmed', 'disputed', 'cancelled', 'proof_attached'], required: true },
    actorId: { type: Id, ref: 'User', required: true },
    reason: { type: String, default: '' },
    changes: { type: mongoose.Schema.Types.Mixed, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const susuGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    currency: { type: String, required: true },
    contributionAmount: { type: Dec, required: true },
    frequency: { type: String, enum: SUSU_FREQUENCIES, required: true },
    intervalDays: { type: Number, min: 2, max: 90, default: null },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    // fixed_order: members' positions; random: shuffled once when cycles are generated (and logged); manual: organiser picks each recipient.
    rotationMethod: { type: String, enum: ['fixed_order', 'random', 'manual'], default: 'fixed_order' },
    collectionSchedule: { type: String, trim: true, maxlength: 300, default: '' },
    maxMembers: { type: Number, min: 2, max: 200, default: 30 },
    // What assistant organisers may do. Organisers can always do everything.
    assistantPermissions: {
      manageMembers: { type: Boolean, default: false },
      manageCycles: { type: Boolean, default: false },
      recordContributions: { type: Boolean, default: true },
      recordPayouts: { type: Boolean, default: false },
    },
    status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' },
    cancelReason: { type: String, default: '' },
    createdBy: { type: Id, ref: 'User', required: true },
  },
  { timestamps: true },
);

const susuGroupMemberSchema = new mongoose.Schema(
  {
    groupId: { type: Id, ref: 'SusuGroup', required: true, index: true },
    // Null for people added by name who don't (yet) have a Kontaa account.
    userId: { type: Id, ref: 'User', default: null },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    // Visible only to organisers and assistants allowed to manage members.
    contact: {
      phone: { type: String, trim: true, maxlength: 30, default: '' },
      email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    },
    role: { type: String, enum: GROUP_ROLES, required: true },
    status: { type: String, enum: ['invited', 'active', 'suspended', 'removed'], required: true },
    rotationPosition: { type: Number, default: null },
    joinedAt: { type: Date, default: null },
    addedBy: { type: Id, ref: 'User', required: true },
  },
  { timestamps: true },
);
susuGroupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } });

const susuInvitationSchema = new mongoose.Schema(
  {
    groupId: { type: Id, ref: 'SusuGroup', required: true, index: true },
    memberId: { type: Id, ref: 'SusuGroupMember', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: Id, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/** One round of the rotation: everyone listed contributes, one recipient collects. */
const susuCycleSchema = new mongoose.Schema(
  {
    groupId: { type: Id, ref: 'SusuGroup', required: true, index: true },
    number: { type: Number, required: true },
    dueDate: { type: Date, required: true },
    recipientMemberId: { type: Id, ref: 'SusuGroupMember', required: true },
    // Snapshot at creation: who is expected to contribute, and how much each.
    contributorMemberIds: [{ type: Id, ref: 'SusuGroupMember' }],
    expectedPerMember: { type: Dec, required: true },
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    cancelReason: { type: String, default: '' },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    createdBy: { type: Id, ref: 'User', required: true },
  },
  { timestamps: true },
);
susuCycleSchema.index({ groupId: 1, number: 1 });

const recordFields = {
  groupId: { type: Id, ref: 'SusuGroup', required: true, index: true },
  cycleId: { type: Id, ref: 'SusuCycle', required: true },
  currency: { type: String, required: true },
  notes: { type: String, trim: true, maxlength: 500, default: '' },
  status: { type: String, enum: RECORD_STATUSES, default: 'recorded' },
  recordedBy: { type: Id, ref: 'User', required: true },
  // Full history of what happened to this record, in order.
  events: { type: [eventSchema], default: [] },
  // A screenshot or receipt of the payment made outside Kontaa. Evidence for members, not proof Kontaa checked.
  attachment: {
    type: new mongoose.Schema(
      { storageKey: String, originalName: String, mimeType: String, size: Number, sha256: String, uploadedBy: { type: Id, ref: 'User' }, uploadedAt: Date },
      { _id: false },
    ),
    default: null,
  },
};

/** A contribution the member says they made outside Kontaa. A record, not proof of payment. */
const susuGroupContributionSchema = new mongoose.Schema(
  {
    ...recordFields,
    memberId: { type: Id, ref: 'SusuGroupMember', required: true },
    amount: { type: Dec, required: true },
    date: { type: Date, required: true },
    // Idempotency-Key from the client (offline drafts replay with the same key).
    clientRef: { type: String, default: undefined },
  },
  { timestamps: true },
);
susuGroupContributionSchema.index({ groupId: 1, cycleId: 1, memberId: 1 });
susuGroupContributionSchema.index({ recordedBy: 1, clientRef: 1 }, { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } });

/** A payout that happened outside Kontaa. "Confirmed" means the recipient acknowledged it. */
const susuPayoutSchema = new mongoose.Schema(
  {
    ...recordFields,
    recipientMemberId: { type: Id, ref: 'SusuGroupMember', required: true },
    expectedAmount: { type: Dec, required: true },
    actualAmount: { type: Dec, required: true },
    payoutDate: { type: Date, required: true },
    // Free text such as "Cash at meeting" or an external MoMo reference. Kontaa doesn't verify it.
    confirmationDetails: { type: String, trim: true, maxlength: 200, default: '' },
  },
  { timestamps: true },
);
susuPayoutSchema.index({ groupId: 1, cycleId: 1 });

/** Append-only activity history for a group. */
const susuActivitySchema = new mongoose.Schema(
  {
    groupId: { type: Id, ref: 'SusuGroup', required: true },
    actorId: { type: Id, ref: 'User', default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Id, default: null },
    // The member a record is about, so members can see entries that concern them.
    memberId: { type: Id, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
susuActivitySchema.index({ groupId: 1, createdAt: -1 });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne']) {
  susuActivitySchema.pre(op, function blockMutation() {
    throw new Error('Susu activity entries are immutable.');
  });
}

export const SusuGroup = mongoose.model('SusuGroup', susuGroupSchema);
export const SusuGroupMember = mongoose.model('SusuGroupMember', susuGroupMemberSchema);
export const SusuInvitation = mongoose.model('SusuInvitation', susuInvitationSchema);
export const SusuCycle = mongoose.model('SusuCycle', susuCycleSchema);
export const SusuGroupContribution = mongoose.model('SusuGroupContribution', susuGroupContributionSchema);
export const SusuPayout = mongoose.model('SusuPayout', susuPayoutSchema);
export const SusuActivityLog = mongoose.model('SusuActivityLog', susuActivitySchema);
