import crypto from 'node:crypto';
import { ApiError } from '../../utils/ApiError.js';
import { fitsCurrency, minorUnits, normalize, str, toDecimal128, D } from '../../utils/money.js';
import { parse } from '../../utils/periods.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { toYmd } from '../../validators/money.js';
import { emails, sendMail } from '../../services/mailer.js';
import { User } from '../users/user.model.js';
import { SusuCycle, SusuGroup, SusuGroupContribution, SusuGroupMember, SusuInvitation, SusuPayout } from './group.models.js';
import { capabilitiesFor, groupCan, logActivity } from './groupAccess.js';
import { dueDate } from './schedule.js';

const fieldError = (field, message) => ApiError.validation([{ location: 'body', field, message }]);
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function assertFits(value, currency, field) {
  if (!fitsCurrency(value, currency)) throw fieldError(field, `${currency} amounts have at most ${minorUnits(currency)} decimal places.`);
}

const scheduleShape = (g) => ({ startDate: toYmd(g.startDate), frequency: g.frequency, intervalDays: g.intervalDays });

/* ---------------- presentation ---------------- */

export function presentGroup(g, membership, extra = {}) {
  return {
    id: String(g._id),
    name: g.name,
    description: g.description,
    currency: g.currency,
    contributionAmount: normalize(str(g.contributionAmount), g.currency),
    frequency: g.frequency,
    intervalDays: g.intervalDays,
    startDate: toYmd(g.startDate),
    endDate: toYmd(g.endDate),
    rotationMethod: g.rotationMethod,
    collectionSchedule: g.collectionSchedule,
    maxMembers: g.maxMembers,
    assistantPermissions: g.assistantPermissions,
    status: g.status,
    cancelReason: g.cancelReason,
    me: membership ? { memberId: String(membership._id), role: membership.role, status: membership.status, capabilities: capabilitiesFor(g, membership) } : null,
    createdAt: g.createdAt,
    ...extra,
  };
}

export function presentMember(m, { showContact = false } = {}) {
  return {
    id: String(m._id),
    displayName: m.displayName,
    role: m.role,
    status: m.status,
    registered: Boolean(m.userId),
    rotationPosition: m.rotationPosition,
    joinedAt: m.joinedAt,
    // Contact details are personal data; only organisers (and permitted assistants) see them.
    contact: showContact ? { phone: m.contact?.phone ?? '', email: m.contact?.email ?? '' } : undefined,
  };
}

/* ---------------- groups ---------------- */

export async function listMyGroups(user) {
  const memberships = await SusuGroupMember.find({ userId: user._id, status: { $in: ['active', 'suspended'] } }).lean();
  const groups = await SusuGroup.find({ _id: { $in: memberships.map((m) => m.groupId) } }).sort({ status: 1, createdAt: -1 });
  const byGroup = new Map(memberships.map((m) => [String(m.groupId), m]));
  const counts = await SusuGroupMember.aggregate([
    { $match: { groupId: { $in: groups.map((g) => g._id) }, status: 'active' } },
    { $group: { _id: '$groupId', n: { $sum: 1 } } },
  ]);
  const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
  return groups.map((g) => presentGroup(g, byGroup.get(String(g._id)), { memberCount: countBy.get(String(g._id)) ?? 0 }));
}

function checkSchedule(input) {
  if (input.frequency === 'custom' && !input.intervalDays) throw fieldError('intervalDays', 'Say how many days between contributions.');
  if (input.endDate && input.startDate && input.endDate <= input.startDate) throw fieldError('endDate', 'The end date must be after the start date.');
}

export async function createGroup(user, input) {
  checkSchedule(input);
  assertFits(input.contributionAmount, input.currency, 'contributionAmount');
  const group = await SusuGroup.create({
    name: input.name,
    description: input.description ?? '',
    currency: input.currency,
    contributionAmount: toDecimal128(normalize(input.contributionAmount, input.currency)),
    frequency: input.frequency,
    intervalDays: input.frequency === 'custom' ? input.intervalDays : null,
    startDate: parse(input.startDate),
    endDate: input.endDate ? parse(input.endDate) : null,
    rotationMethod: input.rotationMethod ?? 'fixed_order',
    collectionSchedule: input.collectionSchedule ?? '',
    maxMembers: input.maxMembers ?? 30,
    assistantPermissions: input.assistantPermissions,
    createdBy: user._id,
  });
  const me = await SusuGroupMember.create({
    groupId: group._id,
    userId: user._id,
    displayName: input.organizerName ?? user.name,
    contact: { email: user.email },
    role: 'organizer',
    status: 'active',
    rotationPosition: 1,
    joinedAt: new Date(),
    addedBy: user._id,
  });
  await logActivity(group, { actorId: user._id, action: 'group.created', entityType: 'SusuGroup', entityId: group._id, metadata: { name: group.name, contributionAmount: str(group.contributionAmount), currency: group.currency, frequency: group.frequency } });
  return presentGroup(group, me, { memberCount: 1 });
}

export async function getGroup(group, membership) {
  const memberCount = await SusuGroupMember.countDocuments({ groupId: group._id, status: 'active' });
  return presentGroup(group, membership, { memberCount });
}

/**
 * Settings changes. The contribution amount and schedule lock once cycles
 * exist, since cycles already snapshot what each member owes.
 */
export async function updateGroup(group, membership, changes, user) {
  const hasCycles = await SusuCycle.exists({ groupId: group._id, status: 'active' });
  const before = { name: group.name, contributionAmount: str(group.contributionAmount), frequency: group.frequency, status: group.status, assistantPermissions: { ...group.assistantPermissions } };
  const scheduleKeys = ['currency', 'frequency', 'intervalDays', 'startDate'];
  if (scheduleKeys.some((k) => changes[k] !== undefined) && hasCycles) {
    throw ApiError.conflict('Cycles already exist, so the currency and schedule can’t change.', 'SCHEDULE_LOCKED');
  }
  if (changes.contributionAmount) {
    assertFits(changes.contributionAmount, changes.currency ?? group.currency, 'contributionAmount');
    // Applies to cycles created from now on; existing cycles keep their snapshot.
    group.contributionAmount = toDecimal128(normalize(changes.contributionAmount, changes.currency ?? group.currency));
  }
  if (scheduleKeys.some((k) => changes[k] !== undefined)) {
    const merged = { frequency: changes.frequency ?? group.frequency, intervalDays: changes.intervalDays ?? group.intervalDays, startDate: changes.startDate ?? toYmd(group.startDate) };
    checkSchedule(merged);
    group.frequency = merged.frequency;
    group.intervalDays = merged.frequency === 'custom' ? merged.intervalDays : null;
    group.startDate = parse(merged.startDate);
    if (changes.currency) group.currency = changes.currency;
  }
  if (changes.endDate !== undefined) group.endDate = changes.endDate ? parse(changes.endDate) : null;
  if (changes.assistantPermissions) group.assistantPermissions = { ...group.assistantPermissions, ...changes.assistantPermissions };
  for (const k of ['name', 'description', 'rotationMethod', 'collectionSchedule', 'maxMembers']) if (changes[k] !== undefined) group[k] = changes[k];
  if (changes.status && changes.status !== group.status) {
    if (changes.status === 'cancelled') {
      if (!changes.cancelReason || changes.cancelReason.trim().length < 3) throw fieldError('cancelReason', 'Say why the group is being cancelled.');
      group.cancelReason = changes.cancelReason.trim();
    }
    group.status = changes.status;
  }
  group.markModified('assistantPermissions');
  await group.save();
  const after = { name: group.name, contributionAmount: str(group.contributionAmount), frequency: group.frequency, status: group.status, assistantPermissions: { ...group.assistantPermissions } };
  await logActivity(group, { actorId: user._id, action: changes.status && changes.status !== before.status ? `group.${changes.status}` : 'group.settings_changed', entityType: 'SusuGroup', entityId: group._id, metadata: { before, after, reason: changes.cancelReason ?? '' } });
  return getGroup(group, membership);
}

/* ---------------- members ---------------- */

export async function listMembers(group, membership) {
  const showContact = groupCan(group, membership, 'viewContacts');
  const rows = await SusuGroupMember.find({ groupId: group._id, status: { $ne: 'removed' } }).sort({ rotationPosition: 1, createdAt: 1 });
  return rows.map((m) => presentMember(m, { showContact }));
}

async function nextPosition(groupId) {
  const last = await SusuGroupMember.findOne({ groupId, rotationPosition: { $ne: null } }).sort({ rotationPosition: -1 });
  return (last?.rotationPosition ?? 0) + 1;
}

async function assertRoom(group) {
  const n = await SusuGroupMember.countDocuments({ groupId: group._id, status: { $in: ['active', 'invited'] } });
  if (n >= group.maxMembers) throw ApiError.conflict(`This group is full (${group.maxMembers} members).`, 'GROUP_FULL');
}

/** Adds someone by name, e.g. a member without a smartphone. They can be invited to link an account later. */
export async function addMember(group, input, user) {
  await assertRoom(group);
  const member = await SusuGroupMember.create({
    groupId: group._id,
    displayName: input.displayName,
    contact: { phone: input.phone ?? '', email: input.email ?? '' },
    role: input.role ?? 'member',
    status: 'active',
    rotationPosition: await nextPosition(group._id),
    joinedAt: new Date(),
    addedBy: user._id,
  });
  await logActivity(group, { actorId: user._id, action: 'member.added', entityType: 'SusuGroupMember', entityId: member._id, memberId: member._id, metadata: { displayName: member.displayName, role: member.role, registered: false } });
  return presentMember(member, { showContact: true });
}

/**
 * Invites by email. Either creates a new member place (status invited) or
 * links an existing name-only member to an account.
 */
export async function inviteMember(group, input, user) {
  let member;
  if (input.memberId) {
    member = await SusuGroupMember.findOne({ _id: input.memberId, groupId: group._id, status: { $ne: 'removed' } });
    if (!member) throw ApiError.notFound('Member not found.');
    if (member.userId) throw ApiError.conflict('This member already has an account linked.', 'ALREADY_LINKED');
  } else {
    await assertRoom(group);
    const existingUser = await User.findOne({ email: input.email }).select('_id');
    if (existingUser && (await SusuGroupMember.exists({ groupId: group._id, userId: existingUser._id, status: { $ne: 'removed' } }))) {
      throw ApiError.conflict('This person is already in the group.', 'ALREADY_MEMBER');
    }
    member = await SusuGroupMember.create({
      groupId: group._id,
      displayName: input.displayName,
      contact: { email: input.email, phone: input.phone ?? '' },
      role: input.role ?? 'member',
      status: 'invited',
      rotationPosition: await nextPosition(group._id),
      addedBy: user._id,
    });
  }
  await SusuInvitation.updateMany({ memberId: member._id, acceptedAt: null, revokedAt: null }, { revokedAt: new Date() });
  const token = randomToken();
  await SusuInvitation.create({ groupId: group._id, memberId: member._id, email: input.email, tokenHash: sha256(token), invitedBy: user._id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
  await sendMail(emails.susuInvite({ email: input.email, inviterName: user.name, groupName: group.name, token }));
  await logActivity(group, { actorId: user._id, action: 'member.invited', entityType: 'SusuGroupMember', entityId: member._id, memberId: member._id, metadata: { displayName: member.displayName, role: member.role } });
  return presentMember(member, { showContact: true });
}

async function liveInvitation(token) {
  const inv = await SusuInvitation.findOne({ tokenHash: sha256(String(token)) });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) {
    throw ApiError.badRequest('This invitation is invalid, expired or already used.');
  }
  return inv;
}

/** Enough for the accept screen: no member list, no money. */
export async function previewInvitation(token) {
  const inv = await liveInvitation(token);
  const group = await SusuGroup.findById(inv.groupId);
  const inviter = await User.findById(inv.invitedBy).select('name');
  return { groupName: group?.name, inviterName: inviter?.name, currency: group?.currency, contributionAmount: group ? normalize(str(group.contributionAmount), group.currency) : null, frequency: group?.frequency, email: inv.email };
}

export async function acceptInvitation(token, user) {
  const inv = await liveInvitation(token);
  if (inv.email !== user.email) throw ApiError.forbidden('This invitation was sent to a different email address. Sign in with that account to accept it.');
  const group = await SusuGroup.findById(inv.groupId);
  if (!group || group.status !== 'active') throw ApiError.badRequest('This group is no longer active.');
  if (await SusuGroupMember.exists({ groupId: group._id, userId: user._id, status: { $ne: 'removed' }, _id: { $ne: inv.memberId } })) {
    throw ApiError.conflict('You are already in this group.', 'ALREADY_MEMBER');
  }
  const claimed = await SusuInvitation.findOneAndUpdate({ _id: inv._id, acceptedAt: null, revokedAt: null }, { acceptedAt: new Date() }, { returnDocument: 'after' });
  if (!claimed) throw ApiError.badRequest('This invitation was already used.');
  const member = await SusuGroupMember.findById(inv.memberId);
  member.userId = user._id;
  if (member.status === 'invited') member.status = 'active';
  member.joinedAt = member.joinedAt ?? new Date();
  await member.save();
  await logActivity(group, { actorId: user._id, action: 'member.joined', entityType: 'SusuGroupMember', entityId: member._id, memberId: member._id, metadata: { displayName: member.displayName } });
  return getGroup(group, member);
}

async function hasRecords(memberId) {
  const [c, p, r] = await Promise.all([
    SusuGroupContribution.exists({ memberId }),
    SusuPayout.exists({ recipientMemberId: memberId }),
    SusuCycle.exists({ recipientMemberId: memberId, status: 'active' }),
  ]);
  return Boolean(c || p || r);
}

/**
 * Edits a member: name, contact, rotation position, role (organisers only)
 * and status. Members with records can't be removed, only suspended, so the
 * group's history stays intact.
 */
export async function updateMember(group, membership, memberId, changes, user) {
  const member = await SusuGroupMember.findOne({ _id: memberId, groupId: group._id, status: { $ne: 'removed' } });
  if (!member) throw ApiError.notFound('Member not found.');
  const before = presentMember(member, { showContact: true });

  if (changes.role && changes.role !== member.role) {
    if (membership.role !== 'organizer') throw ApiError.forbidden('Only an organiser can change roles.');
    if (member.role === 'organizer' && (await SusuGroupMember.countDocuments({ groupId: group._id, role: 'organizer', status: 'active' })) <= 1) {
      throw ApiError.conflict('A group needs at least one organiser. Make someone else an organiser first.', 'LAST_ORGANIZER');
    }
    member.role = changes.role;
  }
  if (changes.status && changes.status !== member.status) {
    if (member.role === 'organizer' && changes.status !== 'active' && (await SusuGroupMember.countDocuments({ groupId: group._id, role: 'organizer', status: 'active' })) <= 1) {
      throw ApiError.conflict('A group needs at least one active organiser.', 'LAST_ORGANIZER');
    }
    if (changes.status === 'removed' && (await hasRecords(member._id))) {
      throw ApiError.conflict('This member has contribution, payout or rotation records, so they can only be suspended.', 'HAS_RECORDS');
    }
    if (changes.status === 'active' && member.status === 'invited') throw ApiError.badRequest('Invited members become active when they accept.');
    member.status = changes.status;
  }
  if (changes.displayName) member.displayName = changes.displayName;
  if (changes.phone !== undefined) member.contact.phone = changes.phone;
  if (changes.email !== undefined && !member.userId) member.contact.email = changes.email;
  if (changes.rotationPosition !== undefined) member.rotationPosition = changes.rotationPosition;
  await member.save();

  const after = presentMember(member, { showContact: true });
  const action = changes.role && changes.role !== before.role ? 'member.role_changed' : changes.status && changes.status !== before.status ? `member.${changes.status}` : 'member.updated';
  // Contact details stay out of the activity log.
  const strip = ({ contact: _c, ...rest }) => rest;
  await logActivity(group, { actorId: user._id, action, entityType: 'SusuGroupMember', entityId: member._id, memberId: member._id, metadata: { before: strip(before), after: strip(after) } });
  return after;
}

/* ---------------- cycles ---------------- */

export function presentCycle(c, membersById) {
  const n = c.contributorMemberIds.length;
  const per = str(c.expectedPerMember);
  const cur = c.currency;
  return {
    id: String(c._id),
    number: c.number,
    dueDate: toYmd(c.dueDate),
    recipient: membersById.get(String(c.recipientMemberId)) ?? { id: String(c.recipientMemberId), displayName: 'Former member' },
    contributorCount: n,
    contributorMemberIds: c.contributorMemberIds.map(String),
    expectedPerMember: normalize(per, cur),
    // An estimate of what the schedule says should be collected; not money Kontaa holds.
    expectedPool: normalize(new D(per).times(n).toString(), cur),
    status: c.status,
    cancelReason: c.cancelReason,
    notes: c.notes,
  };
}

export async function memberMap(groupId) {
  const rows = await SusuGroupMember.find({ groupId }).select('displayName status role').lean();
  return new Map(rows.map((m) => [String(m._id), { id: String(m._id), displayName: m.displayName, status: m.status, role: m.role }]));
}

export async function listCycles(group) {
  const [cycles, members] = await Promise.all([SusuCycle.find({ groupId: group._id }).sort({ number: 1 }).lean(), memberMap(group._id)]);
  return cycles.map((c) => presentCycle({ ...c, currency: group.currency }, members));
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Creates cycles for every active member who doesn't yet have a turn,
 * continuing after the last cycle. Each cycle snapshots who contributes and
 * how much. For random rotation the order is drawn once and logged.
 */
export async function generateCycles(group, user) {
  if (group.rotationMethod === 'manual') throw ApiError.badRequest('This group picks recipients by hand. Add cycles one at a time.');
  const [members, existing] = await Promise.all([
    SusuGroupMember.find({ groupId: group._id, status: 'active' }).sort({ rotationPosition: 1, createdAt: 1 }),
    SusuCycle.find({ groupId: group._id, status: 'active' }).sort({ number: 1 }),
  ]);
  if (members.length < 2) throw ApiError.badRequest('Add at least two active members before setting up the rotation.');
  const hadTurn = new Set(existing.map((c) => String(c.recipientMemberId)));
  let queue = members.filter((m) => !hadTurn.has(String(m._id)));
  if (!queue.length) throw ApiError.badRequest('Every active member already has a turn in the rotation.');
  if (group.rotationMethod === 'random') {
    queue = shuffle(queue);
    // Record the draw so the order is transparent and can't be quietly redone.
    for (const [i, m] of queue.entries()) {
      m.rotationPosition = existing.length + i + 1;
      await m.save();
    }
    await logActivity(group, { actorId: user._id, action: 'rotation.randomised', entityType: 'SusuGroup', entityId: group._id, metadata: { order: queue.map((m) => m.displayName) } });
  }
  const lastNumber = await SusuCycle.findOne({ groupId: group._id }).sort({ number: -1 }).select('number');
  let number = lastNumber?.number ?? 0;
  const contributors = members.map((m) => m._id);
  const created = [];
  for (const m of queue) {
    number += 1;
    const cycle = await SusuCycle.create({
      groupId: group._id,
      number,
      dueDate: parse(dueDate(scheduleShape(group), number - 1)),
      recipientMemberId: m._id,
      contributorMemberIds: contributors,
      expectedPerMember: group.contributionAmount,
      createdBy: user._id,
    });
    created.push(cycle);
  }
  await logActivity(group, { actorId: user._id, action: 'cycles.generated', entityType: 'SusuGroup', entityId: group._id, metadata: { count: created.length, from: created[0].number, to: created.at(-1).number } });
  return listCycles(group);
}

export async function createCycle(group, input, user) {
  const recipient = await SusuGroupMember.findOne({ _id: input.recipientMemberId, groupId: group._id, status: 'active' });
  if (!recipient) throw fieldError('recipientMemberId', 'Choose an active member as the recipient.');
  const members = await SusuGroupMember.find({ groupId: group._id, status: 'active' }).select('_id');
  const last = await SusuCycle.findOne({ groupId: group._id }).sort({ number: -1 }).select('number');
  const number = (last?.number ?? 0) + 1;
  const cycle = await SusuCycle.create({
    groupId: group._id,
    number,
    dueDate: parse(input.dueDate ?? dueDate(scheduleShape(group), number - 1)),
    recipientMemberId: recipient._id,
    contributorMemberIds: members.map((m) => m._id),
    expectedPerMember: input.expectedPerMember ? toDecimal128(normalize(input.expectedPerMember, group.currency)) : group.contributionAmount,
    notes: input.notes ?? '',
    createdBy: user._id,
  });
  await logActivity(group, { actorId: user._id, action: 'cycle.created', entityType: 'SusuCycle', entityId: cycle._id, memberId: recipient._id, metadata: { number, dueDate: toYmd(cycle.dueDate), recipient: recipient.displayName } });
  return presentCycle({ ...cycle.toObject(), currency: group.currency }, await memberMap(group._id));
}

/** Change a cycle's date, recipient or expected contributors, or cancel it. Always with a reason. */
export async function updateCycle(group, cycleId, changes, user) {
  const cycle = await SusuCycle.findOne({ _id: cycleId, groupId: group._id });
  if (!cycle) throw ApiError.notFound('Cycle not found.');
  if (cycle.status === 'cancelled') throw ApiError.badRequest('This cycle was cancelled.');
  if (!changes.reason || changes.reason.trim().length < 3) throw fieldError('reason', 'Say why the cycle is being changed.');
  const before = { dueDate: toYmd(cycle.dueDate), recipient: String(cycle.recipientMemberId), contributors: cycle.contributorMemberIds.length, status: cycle.status };

  const payout = await SusuPayout.findOne({ cycleId: cycle._id, status: { $ne: 'cancelled' } });
  if (changes.recipientMemberId && String(changes.recipientMemberId) !== String(cycle.recipientMemberId)) {
    if (payout) throw ApiError.conflict('A payout is already recorded for this cycle. Cancel it before changing the recipient.', 'PAYOUT_EXISTS');
    const r = await SusuGroupMember.findOne({ _id: changes.recipientMemberId, groupId: group._id, status: 'active' });
    if (!r) throw fieldError('recipientMemberId', 'Choose an active member as the recipient.');
    cycle.recipientMemberId = r._id;
  }
  if (changes.dueDate) cycle.dueDate = parse(changes.dueDate);
  if (changes.contributorMemberIds) {
    const valid = await SusuGroupMember.find({ _id: { $in: changes.contributorMemberIds }, groupId: group._id }).select('_id');
    if (valid.length !== new Set(changes.contributorMemberIds.map(String)).size) throw fieldError('contributorMemberIds', 'Choose members of this group.');
    cycle.contributorMemberIds = valid.map((m) => m._id);
  }
  if (changes.status === 'cancelled') {
    if (payout) throw ApiError.conflict('A payout is recorded for this cycle. Cancel the payout first.', 'PAYOUT_EXISTS');
    cycle.status = 'cancelled';
    cycle.cancelReason = changes.reason.trim();
  }
  if (changes.notes !== undefined) cycle.notes = changes.notes;
  await cycle.save();
  const after = { dueDate: toYmd(cycle.dueDate), recipient: String(cycle.recipientMemberId), contributors: cycle.contributorMemberIds.length, status: cycle.status };
  await logActivity(group, { actorId: user._id, action: cycle.status === 'cancelled' ? 'cycle.cancelled' : 'cycle.changed', entityType: 'SusuCycle', entityId: cycle._id, memberId: cycle.recipientMemberId, metadata: { number: cycle.number, before, after, reason: changes.reason.trim() } });
  return presentCycle({ ...cycle.toObject(), currency: group.currency }, await memberMap(group._id));
}
