import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { currency, email, objectId } from '../../validators/common.js';
import { amount, calendarDate } from '../../validators/money.js';
import { created, ok } from '../../utils/http.js';
import { todayIn } from '../../utils/periods.js';
import { SUSU_FREQUENCIES } from './susu.models.js';
import { GROUP_ROLES, SusuGroup, SusuGroupMember } from './group.models.js';
import { groupCan, loadGroup, requireCapability } from './groupAccess.js';
import { ApiError } from '../../utils/ApiError.js';
import * as groups from './groups.service.js';
import * as records from './groupRecords.service.js';
import { idempotencyKey } from '../../utils/idempotency.js';

/*
 * Group Susu API: records only. Payout routes record payouts that happened
 * between members outside BudgetFlow; nothing here sends, collects or
 * initiates money, and no payment provider is involved.
 */

const today = (req) => todayIn(req.user.timezone);
const reason = Joi.string().trim().max(300);
const assistantPermissions = Joi.object({ manageMembers: Joi.boolean(), manageCycles: Joi.boolean(), recordContributions: Joi.boolean(), recordPayouts: Joi.boolean() });
const groupFields = {
  name: Joi.string().trim().min(1).max(80),
  description: Joi.string().trim().max(1000).allow(''),
  currency,
  contributionAmount: amount,
  frequency: Joi.string().valid(...SUSU_FREQUENCIES),
  intervalDays: Joi.number().integer().min(2).max(90).allow(null),
  startDate: calendarDate,
  endDate: calendarDate.allow(null),
  rotationMethod: Joi.string().valid('fixed_order', 'random', 'manual'),
  collectionSchedule: Joi.string().trim().max(300).allow(''),
  maxMembers: Joi.number().integer().min(2).max(200),
  assistantPermissions,
};
const groupId = { groupId: objectId.required() };
const phone = Joi.string().trim().max(30).pattern(/^[+\d\s()-]*$/).allow('').messages({ 'string.pattern.base': 'Enter a phone number using digits, spaces and +.' });
const recordAction = Joi.object({
  action: Joi.string().valid('confirm', 'dispute', 'cancel', 'correct').default('correct'),
  reason,
  amount,
  date: calendarDate,
  actualAmount: amount,
  payoutDate: calendarDate,
  confirmationDetails: Joi.string().trim().max(200).allow(''),
  notes: Joi.string().trim().max(500).allow(''),
});

export const groupsRouter = Router();
groupsRouter.use(requireAuth);

groupsRouter.get('/', async (req, res) => {
  const list = await groups.listMyGroups(req.user);
  const docs = await SusuGroup.find({ _id: { $in: list.map((g) => g.id) } });
  const memberships = new Map((await SusuGroupMember.find({ userId: req.user._id, groupId: { $in: docs.map((d) => d._id) } })).map((m) => [String(m.groupId), m]));
  const standing = new Map((await records.myGroupStanding(docs, memberships, today(req))).map((s) => [s.groupId, s]));
  ok(res, list.map((g) => ({ ...g, standing: standing.get(g.id) ?? null })));
});

groupsRouter.post(
  '/',
  validate({
    body: Joi.object({
      ...groupFields,
      name: groupFields.name.required(),
      currency: currency.required(),
      contributionAmount: amount.required(),
      frequency: groupFields.frequency.required(),
      startDate: calendarDate.required(),
      organizerName: Joi.string().trim().min(1).max(80),
    }),
  }),
  async (req, res) => created(res, await groups.createGroup(req.user, req.valid.body)),
);

groupsRouter.get('/:groupId', validate({ params: Joi.object(groupId) }), loadGroup(), async (req, res) => ok(res, await groups.getGroup(req.group, req.groupMember)));
groupsRouter.patch(
  '/:groupId',
  validate({ params: Joi.object(groupId), body: Joi.object({ ...groupFields, status: Joi.string().valid('active', 'completed', 'cancelled'), cancelReason: reason }).min(1) }),
  loadGroup(),
  async (req, res) => {
    // Settings are organiser-only. A completed or cancelled group only accepts a status change (e.g. reopening).
    if (!groupCan(req.group, req.groupMember, 'manageSettings')) throw ApiError.forbidden('Only an organiser can change group settings.');
    const keys = Object.keys(req.valid.body).filter((k) => k !== 'status' && k !== 'cancelReason');
    if (req.group.status !== 'active' && keys.length) throw ApiError.forbidden(`This group is ${req.group.status}. Reopen it to change its settings.`);
    ok(res, await groups.updateGroup(req.group, req.groupMember, req.valid.body, req.user));
  },
);

/* members */
groupsRouter.get('/:groupId/members', validate({ params: Joi.object(groupId) }), loadGroup(), async (req, res) => ok(res, await groups.listMembers(req.group, req.groupMember)));
groupsRouter.post(
  '/:groupId/members',
  validate({ params: Joi.object(groupId), body: Joi.object({ displayName: Joi.string().trim().min(1).max(80).required(), phone, email: email.allow(''), role: Joi.string().valid('assistant', 'member') }) }),
  loadGroup(),
  requireCapability('manageMembers'),
  async (req, res) => created(res, await groups.addMember(req.group, req.valid.body, req.user)),
);
groupsRouter.post(
  '/:groupId/invitations',
  validate({
    params: Joi.object(groupId),
    body: Joi.object({ email: email.required(), displayName: Joi.string().trim().min(1).max(80), memberId: objectId, phone, role: Joi.string().valid('assistant', 'member') }).or('displayName', 'memberId'),
  }),
  loadGroup(),
  requireCapability('manageMembers'),
  async (req, res) => created(res, await groups.inviteMember(req.group, req.valid.body, req.user)),
);
groupsRouter.patch(
  '/:groupId/members/:memberId',
  validate({
    params: Joi.object({ ...groupId, memberId: objectId.required() }),
    body: Joi.object({ displayName: Joi.string().trim().min(1).max(80), phone, email: email.allow(''), role: Joi.string().valid(...GROUP_ROLES), status: Joi.string().valid('active', 'suspended', 'removed'), rotationPosition: Joi.number().integer().min(1).max(500).allow(null) }).min(1),
  }),
  loadGroup(),
  requireCapability('manageMembers'),
  async (req, res) => ok(res, await groups.updateMember(req.group, req.groupMember, req.valid.params.memberId, req.valid.body, req.user)),
);

/* cycles */
groupsRouter.get('/:groupId/cycles', validate({ params: Joi.object(groupId) }), loadGroup(), async (req, res) => ok(res, await groups.listCycles(req.group)));
groupsRouter.post(
  '/:groupId/cycles',
  validate({
    params: Joi.object(groupId),
    body: Joi.alternatives().try(
      Joi.object({ generate: Joi.boolean().valid(true).required() }),
      Joi.object({ recipientMemberId: objectId.required(), dueDate: calendarDate, expectedPerMember: amount, notes: Joi.string().trim().max(500).allow('') }),
    ),
  }),
  loadGroup(),
  requireCapability('manageCycles'),
  async (req, res) => created(res, req.valid.body.generate ? await groups.generateCycles(req.group, req.user) : await groups.createCycle(req.group, req.valid.body, req.user)),
);
groupsRouter.patch(
  '/:groupId/cycles/:cycleId',
  validate({
    params: Joi.object({ ...groupId, cycleId: objectId.required() }),
    body: Joi.object({ dueDate: calendarDate, recipientMemberId: objectId, contributorMemberIds: Joi.array().items(objectId).min(1).unique(), status: Joi.string().valid('cancelled'), notes: Joi.string().trim().max(500).allow(''), reason: reason.required() }),
  }),
  loadGroup(),
  requireCapability('manageCycles'),
  async (req, res) => ok(res, await groups.updateCycle(req.group, req.valid.params.cycleId, req.valid.body, req.user)),
);

/* contribution and payout records */
groupsRouter.post(
  '/:groupId/cycles/:cycleId/contributions',
  validate({ params: Joi.object({ ...groupId, cycleId: objectId.required() }), body: Joi.object({ memberId: objectId.required(), amount: amount.required(), date: calendarDate.required(), notes: Joi.string().trim().max(500).allow('') }) }),
  loadGroup(),
  requireCapability('recordContributions'),
  async (req, res) => created(res, await records.recordContribution(req.group, req.valid.params.cycleId, req.valid.body, req.user, today(req), idempotencyKey(req))),
);
groupsRouter.get(
  '/:groupId/contributions',
  validate({ params: Joi.object(groupId), query: Joi.object({ cycleId: objectId, memberId: objectId, status: Joi.string().valid('recorded', 'confirmed', 'disputed', 'cancelled') }) }),
  loadGroup(),
  async (req, res) => ok(res, await records.listRecords('contribution', req.group, req.groupMember, req.valid.query)),
);
groupsRouter.patch(
  '/:groupId/contributions/:recordId',
  validate({ params: Joi.object({ ...groupId, recordId: objectId.required() }), body: recordAction }),
  loadGroup(),
  async (req, res) => ok(res, await records.actOnRecord('contribution', req.group, req.groupMember, req.valid.params.recordId, req.valid.body, req.user)),
);
groupsRouter.post(
  '/:groupId/cycles/:cycleId/payouts',
  validate({
    params: Joi.object({ ...groupId, cycleId: objectId.required() }),
    body: Joi.object({ actualAmount: amount.required(), payoutDate: calendarDate.required(), confirmationDetails: Joi.string().trim().max(200).allow(''), notes: Joi.string().trim().max(500).allow('') }),
  }),
  loadGroup(),
  requireCapability('recordPayouts'),
  async (req, res) => created(res, await records.recordPayout(req.group, req.valid.params.cycleId, req.valid.body, req.user, today(req))),
);
groupsRouter.get('/:groupId/payouts', validate({ params: Joi.object(groupId), query: Joi.object({ cycleId: objectId }) }), loadGroup(), async (req, res) =>
  ok(res, await records.listRecords('payout', req.group, req.groupMember, req.valid.query)),
);
groupsRouter.patch(
  '/:groupId/payouts/:recordId',
  validate({ params: Joi.object({ ...groupId, recordId: objectId.required() }), body: recordAction }),
  loadGroup(),
  async (req, res) => ok(res, await records.actOnRecord('payout', req.group, req.groupMember, req.valid.params.recordId, req.valid.body, req.user)),
);

/* reports and history */
groupsRouter.get('/:groupId/reports', validate({ params: Joi.object(groupId) }), loadGroup(), async (req, res) => ok(res, await records.groupReport(req.group, req.groupMember, today(req))));
groupsRouter.get('/:groupId/activity', validate({ params: Joi.object(groupId), query: Joi.object({ limit: Joi.number().integer().min(1).max(300).default(100) }) }), loadGroup(), async (req, res) =>
  ok(res, await records.groupActivity(req.group, req.groupMember, req.valid.query)),
);

/* invitations (by token, for the person invited) */
export const susuInvitationsRouter = Router();
susuInvitationsRouter.use(requireAuth);
const token = Joi.object({ token: Joi.string().max(200).required() });
susuInvitationsRouter.get('/:token', validate({ params: token }), async (req, res) => ok(res, await groups.previewInvitation(req.valid.params.token)));
susuInvitationsRouter.post('/:token/accept', validate({ params: token }), async (req, res) => ok(res, await groups.acceptInvitation(req.valid.params.token, req.user)));
