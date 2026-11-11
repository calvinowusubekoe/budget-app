import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { isDuplicateKey } from '../../utils/idempotency.js';
import { D, fitsCurrency, minorUnits, normalize, str, toDecimal128 } from '../../utils/money.js';
import { parse } from '../../utils/periods.js';
import { toYmd } from '../../validators/money.js';
import { User } from '../users/user.model.js';
import { notify } from '../notifications/notifications.service.js';
import { SusuActivityLog, SusuCycle, SusuGroupContribution, SusuGroupMember, SusuPayout } from './group.models.js';
import { groupCan, logActivity } from './groupAccess.js';
import { memberMap } from './groups.service.js';
import { readUpload, removeUpload, saveUpload } from '../../services/fileStorage.js';

/*
 * Contribution and payout records for Group Susu. A record says what the
 * organiser was told happened outside Kontaa. "Confirmed" means the member
 * acknowledged it; it is not proof that money moved, and Kontaa never
 * initiates, receives or verifies any payment.
 */

const fieldError = (field, message) => ApiError.validation([{ location: 'body', field, message }]);
const oid = (v) => new mongoose.Types.ObjectId(String(v));

function assertFits(value, currency, field) {
  if (!fitsCurrency(value, currency)) throw fieldError(field, `${currency} amounts have at most ${minorUnits(currency)} decimal places.`);
}

/** Who last entered or corrected a record. They can't also be the one confirming it. */
function lastEditor(r) {
  const e = [...(r.events ?? [])].reverse().find((x) => x.type === 'recorded' || x.type === 'corrected');
  return String(e?.actorId ?? r.recordedBy);
}

/** The two record kinds share one lifecycle; these describe how they differ. */
const KINDS = {
  contribution: {
    Model: SusuGroupContribution,
    subject: 'memberId',
    capability: 'recordContributions',
    label: 'contribution',
    amountField: 'amount',
    dateField: 'date',
  },
  payout: {
    Model: SusuPayout,
    subject: 'recipientMemberId',
    capability: 'recordPayouts',
    label: 'payout',
    amountField: 'actualAmount',
    dateField: 'payoutDate',
  },
};

async function actorNames(records) {
  const ids = new Set();
  for (const r of records) {
    ids.add(String(r.recordedBy));
    for (const e of r.events ?? []) ids.add(String(e.actorId));
  }
  const users = await User.find({ _id: { $in: [...ids] } })
    .select('name')
    .lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

function presentRecord(kind, r, ctx) {
  const k = KINDS[kind];
  const subject = ctx.members.get(String(r[k.subject])) ?? {
    id: String(r[k.subject]),
    displayName: 'Former member',
  };
  const base = {
    id: String(r._id),
    kind,
    cycleId: String(r.cycleId),
    cycleNumber: ctx.cycles.get(String(r.cycleId))?.number ?? null,
    currency: r.currency,
    notes: r.notes,
    status: r.status,
    recordedBy: ctx.names.get(String(r.recordedBy)) ?? 'Someone',
    events: (r.events ?? []).map((e) => ({
      type: e.type,
      actor: ctx.names.get(String(e.actorId)) ?? 'Someone',
      reason: e.reason,
      changes: e.changes,
      at: e.at,
    })),
    // Whether the person asking can confirm or dispute it: only the member it's about.
    proof: r.attachment?.storageKey ? { name: r.attachment.originalName, mimeType: r.attachment.mimeType, size: r.attachment.size, uploadedAt: r.attachment.uploadedAt } : null,
    canRespond: Boolean(ctx.me && String(ctx.me._id) === String(r[k.subject]) && ['recorded', 'disputed'].includes(r.status) && String(ctx.me.userId) !== lastEditor(r)),
    // Entered by the same person it's about, so a confirmation would mean nothing.
    selfRecorded: Boolean(ctx.subjectUsers?.get(String(r[k.subject])) === lastEditor(r)),
    createdAt: r.createdAt,
  };
  if (kind === 'contribution') {
    return {
      ...base,
      member: subject,
      amount: normalize(str(r.amount), r.currency),
      date: toYmd(r.date),
    };
  }
  return {
    ...base,
    recipient: subject,
    expectedAmount: normalize(str(r.expectedAmount), r.currency),
    actualAmount: normalize(str(r.actualAmount), r.currency),
    payoutDate: toYmd(r.payoutDate),
    confirmationDetails: r.confirmationDetails,
  };
}

async function presentAll(kind, group, records, me) {
  const [members, cycles, names, subjectUsers] = await Promise.all([
    memberMap(group._id),
    SusuCycle.find({ groupId: group._id })
      .select('number')
      .lean()
      .then((cs) => new Map(cs.map((c) => [String(c._id), c]))),
    actorNames(records),
    SusuGroupMember.find({ groupId: group._id, userId: { $ne: null } })
      .select('userId')
      .lean()
      .then((ms) => new Map(ms.map((m) => [String(m._id), String(m.userId)]))),
  ]);
  return records.map((r) => presentRecord(kind, r, { members, cycles, names, me, subjectUsers }));
}

async function activeCycle(group, cycleId) {
  const cycle = await SusuCycle.findOne({ _id: cycleId, groupId: group._id });
  if (!cycle) throw ApiError.notFound('Cycle not found.');
  if (cycle.status === 'cancelled') throw ApiError.badRequest('This cycle was cancelled.');
  return cycle;
}

async function managersOf(group) {
  const rows = await SusuGroupMember.find({
    groupId: group._id,
    status: 'active',
    role: { $in: ['organizer', 'assistant'] },
    userId: { $ne: null },
  })
    .select('userId')
    .lean();
  return rows.map((r) => r.userId);
}

async function askToConfirm(group, kind, record, member, user) {
  if (!member?.userId || String(member.userId) === String(user._id)) return;
  const amount = kind === 'contribution' ? str(record.amount) : str(record.actualAmount);
  await notify([member.userId], {
    type: kind === 'payout' ? 'susu_payout_recorded' : 'susu_confirm_request',
    title: kind === 'payout' ? `${group.name}: please confirm your payout` : `${group.name}: please confirm your contribution`,
    body: `${normalize(amount, group.currency)} ${group.currency} was recorded for you. Confirm it if it’s right, or dispute it.`,
    link: `/susu/groups/${group._id}?tab=mine`,
    data: { groupId: String(group._id), recordId: String(record._id), kind },
    dedupeKey: `susu-${kind}:${record._id}:${record.events.length}`,
  });
}

/* ---------------- create ---------------- */

export async function recordContribution(group, cycleId, input, user, today, clientRef) {
  if (clientRef) {
    const prior = await SusuGroupContribution.findOne({
      recordedBy: user._id,
      clientRef,
    });
    if (prior) {
      if (String(prior.groupId) !== String(group._id)) throw ApiError.conflict('This Idempotency-Key was already used for a different record.', 'IDEMPOTENCY_MISMATCH');
      return (await presentAll('contribution', group, [prior.toObject()], null))[0];
    }
  }
  const cycle = await activeCycle(group, cycleId);
  if (!cycle.contributorMemberIds.some((id) => String(id) === String(input.memberId))) {
    throw fieldError('memberId', 'This member isn’t expected to contribute in this cycle.');
  }
  const member = await SusuGroupMember.findOne({
    _id: input.memberId,
    groupId: group._id,
    status: { $ne: 'removed' },
  });
  if (!member) throw fieldError('memberId', 'Choose a member of this group.');
  assertFits(input.amount, group.currency, 'amount');
  if (input.date > today) throw fieldError('date', 'Contributions can’t be dated in the future.');

  let record;
  try {
    record = await SusuGroupContribution.create({
      groupId: group._id,
      cycleId: cycle._id,
      memberId: member._id,
      amount: toDecimal128(normalize(input.amount, group.currency)),
      currency: group.currency,
      date: parse(input.date),
      notes: input.notes ?? '',
      recordedBy: user._id,
      clientRef,
      events: [{ type: 'recorded', actorId: user._id }],
    });
  } catch (err) {
    if (clientRef && isDuplicateKey(err))
      return (
        await presentAll(
          'contribution',
          group,
          [
            (
              await SusuGroupContribution.findOne({
                recordedBy: user._id,
                clientRef,
              })
            ).toObject(),
          ],
          null,
        )
      )[0];
    throw err;
  }
  await logActivity(group, {
    actorId: user._id,
    action: 'contribution.recorded',
    entityType: 'SusuGroupContribution',
    entityId: record._id,
    memberId: member._id,
    metadata: {
      cycle: cycle.number,
      member: member.displayName,
      amount: str(record.amount),
      date: input.date,
    },
  });
  await askToConfirm(group, 'contribution', record, member, user);
  return (await presentAll('contribution', group, [record.toObject()], null))[0];
}

export async function recordPayout(group, cycleId, input, user, today) {
  const cycle = await activeCycle(group, cycleId);
  if (
    await SusuPayout.exists({
      cycleId: cycle._id,
      status: { $ne: 'cancelled' },
    })
  ) {
    throw ApiError.conflict('A payout is already recorded for this cycle. Correct or cancel it instead.', 'PAYOUT_EXISTS');
  }
  const recipient = await SusuGroupMember.findById(cycle.recipientMemberId);
  assertFits(input.actualAmount, group.currency, 'actualAmount');
  if (input.payoutDate > today) throw fieldError('payoutDate', 'Payouts can’t be dated in the future.');
  const expected = new D(str(cycle.expectedPerMember)).times(cycle.contributorMemberIds.length).toString();

  const record = await SusuPayout.create({
    groupId: group._id,
    cycleId: cycle._id,
    recipientMemberId: cycle.recipientMemberId,
    expectedAmount: toDecimal128(normalize(expected, group.currency)),
    actualAmount: toDecimal128(normalize(input.actualAmount, group.currency)),
    currency: group.currency,
    payoutDate: parse(input.payoutDate),
    confirmationDetails: input.confirmationDetails ?? '',
    notes: input.notes ?? '',
    recordedBy: user._id,
    events: [{ type: 'recorded', actorId: user._id }],
  });
  await logActivity(group, {
    actorId: user._id,
    action: 'payout.recorded',
    entityType: 'SusuPayout',
    entityId: record._id,
    memberId: cycle.recipientMemberId,
    metadata: {
      cycle: cycle.number,
      recipient: recipient?.displayName,
      expected: str(record.expectedAmount),
      actual: str(record.actualAmount),
      date: input.payoutDate,
    },
  });
  await askToConfirm(group, 'payout', record, recipient, user);
  return (await presentAll('payout', group, [record.toObject()], null))[0];
}

/* ---------------- list ---------------- */

export async function listRecords(kind, group, membership, filters = {}) {
  const k = KINDS[kind];
  const q = { groupId: group._id };
  if (filters.cycleId) q.cycleId = oid(filters.cycleId);
  if (filters.status) q.status = filters.status;
  // Members see every payout (the rotation is shared knowledge) but only their own contributions.
  if (kind === 'contribution') {
    if (!groupCan(group, membership, 'viewAllRecords')) q.memberId = membership._id;
    else if (filters.memberId) q.memberId = oid(filters.memberId);
  }
  const rows = await k.Model.find(q)
    .sort({ [k.dateField]: -1, createdAt: -1 })
    .lean();
  return presentAll(kind, group, rows, membership);
}

/* ---------------- lifecycle ---------------- */

/**
 *  confirm  the member the record is about acknowledges it (from recorded or disputed)
 *  dispute  that member says it's wrong, with a reason (from recorded)
 *  cancel   a manager withdraws it, with a reason; confirmed records need an organiser
 *  correct  a manager fixes amount/date/details on a recorded or disputed record;
 *           it goes back to "recorded" and the member is asked to confirm again
 */
export async function actOnRecord(kind, group, membership, id, body, user) {
  const k = KINDS[kind];
  const record = await k.Model.findOne({ _id: id, groupId: group._id });
  if (!record) throw ApiError.notFound(`${k.label[0].toUpperCase()}${k.label.slice(1)} not found.`);
  const isSubject = String(membership._id) === String(record[k.subject]);
  const action = body.action ?? 'correct';
  const reason = body.reason?.trim() ?? '';
  const subject = await SusuGroupMember.findById(record[k.subject]);

  if (record.status === 'cancelled') throw ApiError.badRequest('This record was cancelled and can’t change.');

  if (action === 'confirm' || action === 'dispute') {
    // A member can't confirm or dispute someone else's record, even as organiser.
    if (!isSubject || membership.status !== 'active') {
      throw ApiError.forbidden(`Only ${subject?.displayName ?? 'the member'} can ${action} this ${k.label}.`);
    }
    if (lastEditor(record) === String(user._id)) {
      throw ApiError.forbidden(`You entered this ${k.label} yourself, so you can’t also confirm or dispute it. Another organiser can record it instead, or it stays as recorded.`);
    }
    if (action === 'confirm' && !['recorded', 'disputed'].includes(record.status)) throw ApiError.badRequest('There’s nothing to confirm.');
    if (action === 'dispute') {
      if (record.status !== 'recorded') throw ApiError.badRequest(record.status === 'confirmed' ? 'You already confirmed this. Ask an organiser to correct it.' : 'This is already disputed.');
      if (reason.length < 3) throw fieldError('reason', 'Say what’s wrong with it.');
    }
    record.status = action === 'confirm' ? 'confirmed' : 'disputed';
    record.events.push({ type: record.status, actorId: user._id, reason });
    await record.save();
    await logActivity(group, {
      actorId: user._id,
      action: `${k.label}.${record.status}`,
      entityType: kind === 'payout' ? 'SusuPayout' : 'SusuGroupContribution',
      entityId: record._id,
      memberId: record[k.subject],
      metadata: { reason },
    });
    if (record.status === 'disputed') {
      await notify(await managersOf(group), {
        type: 'susu_disputed',
        title: `${group.name}: ${subject?.displayName} disputed a ${k.label}`,
        body: reason,
        link: `/susu/groups/${group._id}?tab=${kind === 'payout' ? 'payouts' : 'contributions'}`,
        data: {
          groupId: String(group._id),
          recordId: String(record._id),
          kind,
        },
        dedupeKey: `susu-dispute:${record._id}:${record.events.length}`,
      });
    }
    return (await presentAll(kind, group, [record.toObject()], membership))[0];
  }

  if (!groupCan(group, membership, k.capability)) throw ApiError.forbidden(`Only organisers can change ${k.label} records.`);
  if (group.status !== 'active') throw ApiError.forbidden(`This group is ${group.status} and read-only.`);

  if (action === 'cancel') {
    if (reason.length < 3) throw fieldError('reason', 'Say why this record is being cancelled.');
    if (record.status === 'confirmed' && !groupCan(group, membership, 'cancelConfirmed')) {
      throw ApiError.forbidden('Only an organiser can cancel a record the member has confirmed.');
    }
    const from = record.status;
    record.status = 'cancelled';
    record.events.push({ type: 'cancelled', actorId: user._id, reason });
    await record.save();
    await logActivity(group, {
      actorId: user._id,
      action: `${k.label}.cancelled`,
      entityType: kind === 'payout' ? 'SusuPayout' : 'SusuGroupContribution',
      entityId: record._id,
      memberId: record[k.subject],
      metadata: { reason, previousStatus: from },
    });
    return (await presentAll(kind, group, [record.toObject()], membership))[0];
  }

  // correct
  if (record.status === 'confirmed') {
    throw ApiError.conflict('This record is confirmed and locked. Cancel it with a reason and record it again.', 'RECORD_CONFIRMED');
  }
  const changes = {};
  const amountKey = k.amountField;
  const newAmount = kind === 'contribution' ? body.amount : body.actualAmount;
  if (newAmount) {
    assertFits(newAmount, group.currency, kind === 'contribution' ? 'amount' : 'actualAmount');
    const v = normalize(newAmount, group.currency);
    if (v !== normalize(str(record[amountKey]), group.currency)) {
      changes.amount = {
        from: normalize(str(record[amountKey]), group.currency),
        to: v,
      };
      record[amountKey] = toDecimal128(v);
    }
  }
  const newDate = kind === 'contribution' ? body.date : body.payoutDate;
  if (newDate && newDate !== toYmd(record[k.dateField])) {
    changes.date = { from: toYmd(record[k.dateField]), to: newDate };
    record[k.dateField] = parse(newDate);
  }
  for (const f of ['notes', ...(kind === 'payout' ? ['confirmationDetails'] : [])]) {
    if (body[f] !== undefined && body[f] !== record[f]) {
      changes[f] = { from: record[f], to: body[f] };
      record[f] = body[f];
    }
  }
  if (!Object.keys(changes).length) throw ApiError.badRequest('Nothing changed.');
  if (reason.length < 3) throw fieldError('reason', 'Say why the record is being corrected.');
  record.status = 'recorded';
  record.events.push({ type: 'corrected', actorId: user._id, reason, changes });
  await record.save();
  await logActivity(group, {
    actorId: user._id,
    action: `${k.label}.corrected`,
    entityType: kind === 'payout' ? 'SusuPayout' : 'SusuGroupContribution',
    entityId: record._id,
    memberId: record[k.subject],
    metadata: { changes, reason },
  });
  await askToConfirm(group, kind, record, subject, user);
  return (await presentAll(kind, group, [record.toObject()], membership))[0];
}

/* ---------------- reports ---------------- */

/**
 * Outstanding contributions, per cycle and per member, worked out from the
 * cycle snapshots. Received = recorded + confirmed. Disputed amounts are
 * reported separately and don't count. Scheduled (expected but unrecorded)
 * amounts are never counted as received.
 */
export async function groupReport(group, membership, today) {
  const cur = group.currency;
  const seeAll = groupCan(group, membership, 'viewAllRecords');
  const [cycles, members, contributions, payouts] = await Promise.all([
    SusuCycle.find({ groupId: group._id, status: 'active' }).sort({ number: 1 }).lean(),
    memberMap(group._id),
    SusuGroupContribution.find({
      groupId: group._id,
      status: { $ne: 'cancelled' },
    }).lean(),
    SusuPayout.find({
      groupId: group._id,
      status: { $ne: 'cancelled' },
    }).lean(),
  ]);

  // sums[cycle][member] = { received, confirmed, disputed }
  const sums = new Map();
  for (const c of contributions) {
    const key = `${c.cycleId}:${c.memberId}`;
    const s = sums.get(key) ?? {
      received: new D(0),
      confirmed: new D(0),
      disputed: new D(0),
    };
    const amt = str(c.amount);
    if (c.status === 'disputed') s.disputed = s.disputed.plus(amt);
    else {
      s.received = s.received.plus(amt);
      if (c.status === 'confirmed') s.confirmed = s.confirmed.plus(amt);
    }
    sums.set(key, s);
  }
  const payoutByCycle = new Map(payouts.map((p) => [String(p.cycleId), p]));
  const memberRows = new Map();
  const n = (v) => normalize(v.toString(), cur);

  const cycleRows = cycles.map((cy) => {
    const due = toYmd(cy.dueDate);
    const isDue = due <= today;
    const per = new D(str(cy.expectedPerMember));
    let received = new D(0);
    let confirmed = new D(0);
    let disputed = new D(0);
    let outstanding = new D(0);
    const cells = [];
    for (const mid of cy.contributorMemberIds.map(String)) {
      const s = sums.get(`${cy._id}:${mid}`) ?? {
        received: new D(0),
        confirmed: new D(0),
        disputed: new D(0),
      };
      received = received.plus(s.received);
      confirmed = confirmed.plus(s.confirmed);
      disputed = disputed.plus(s.disputed);
      const short = D.max(per.minus(s.received), 0);
      if (isDue) outstanding = outstanding.plus(short);
      // On the collection day itself nothing is "missed" yet; it's due.
      const state = s.received.greaterThanOrEqualTo(per)
        ? 'paid'
        : s.disputed.greaterThan(0)
          ? 'disputed'
          : s.received.greaterThan(0)
            ? 'partial'
            : due < today
              ? 'missed'
              : isDue
                ? 'due'
                : 'scheduled';
      cells.push({
        memberId: mid,
        received: n(s.received),
        confirmed: n(s.confirmed),
        disputed: n(s.disputed),
        state,
      });

      const row = memberRows.get(mid) ?? {
        expected: new D(0),
        received: new D(0),
        confirmed: new D(0),
        disputed: new D(0),
        outstanding: new D(0),
        missed: 0,
        partial: 0,
        upcoming: new D(0),
      };
      if (isDue) {
        row.expected = row.expected.plus(per);
        row.outstanding = row.outstanding.plus(short);
        if (state === 'missed') row.missed += 1;
        if (state === 'partial') row.partial += 1;
      } else row.upcoming = row.upcoming.plus(per);
      row.received = row.received.plus(s.received);
      row.confirmed = row.confirmed.plus(s.confirmed);
      row.disputed = row.disputed.plus(s.disputed);
      memberRows.set(mid, row);
    }
    const p = payoutByCycle.get(String(cy._id));
    return {
      cycleId: String(cy._id),
      number: cy.number,
      dueDate: due,
      due: isDue,
      recipient: members.get(String(cy.recipientMemberId)) ?? null,
      expectedPool: n(per.times(cy.contributorMemberIds.length)),
      received: n(received),
      confirmed: n(confirmed),
      disputed: n(disputed),
      outstanding: n(outstanding),
      payout: p
        ? {
            id: String(p._id),
            actualAmount: normalize(str(p.actualAmount), cur),
            payoutDate: toYmd(p.payoutDate),
            status: p.status,
          }
        : null,
      // Members only see their own cell in each cycle.
      members: seeAll ? cells : cells.filter((c) => c.memberId === String(membership._id)),
    };
  });

  const memberSummaries = [...memberRows.entries()]
    .filter(([mid]) => seeAll || mid === String(membership._id))
    .map(([mid, r]) => ({
      member: members.get(mid) ?? { id: mid, displayName: 'Former member' },
      expectedToDate: n(r.expected),
      received: n(r.received),
      confirmed: n(r.confirmed),
      disputed: n(r.disputed),
      outstanding: n(r.outstanding),
      missedCycles: r.missed,
      partialCycles: r.partial,
      upcoming: n(r.upcoming),
    }))
    .sort((a, b) => new D(b.outstanding).comparedTo(a.outstanding));

  const disputes = [
    ...contributions
      .filter((c) => c.status === 'disputed' && (seeAll || String(c.memberId) === String(membership._id)))
      .map((c) => ({
        kind: 'contribution',
        id: String(c._id),
        member: members.get(String(c.memberId)),
        amount: normalize(str(c.amount), cur),
        reason: c.events.at(-1)?.reason ?? '',
        at: c.events.at(-1)?.at,
      })),
    ...payouts
      .filter((p) => p.status === 'disputed')
      .map((p) => ({
        kind: 'payout',
        id: String(p._id),
        member: members.get(String(p.recipientMemberId)),
        amount: normalize(str(p.actualAmount), cur),
        reason: p.events.at(-1)?.reason ?? '',
        at: p.events.at(-1)?.at,
      })),
  ];

  const dueCycles = cycleRows.filter((c) => c.due);
  const total = (f) => n(dueCycles.reduce((acc, c) => acc.plus(c[f]), new D(0)));
  return {
    currency: cur,
    asOf: today,
    totals: {
      cycles: cycleRows.length,
      dueCycles: dueCycles.length,
      expectedToDate: n(dueCycles.reduce((acc, c) => acc.plus(c.expectedPool), new D(0))),
      received: total('received'),
      confirmed: total('confirmed'),
      outstanding: total('outstanding'),
      payoutsRecorded: payouts.length,
      payoutsConfirmed: payouts.filter((p) => p.status === 'confirmed').length,
    },
    cycles: cycleRows,
    members: memberSummaries,
    disputes,
  };
}

/* ---------------- activity ---------------- */

export async function groupActivity(group, membership, { limit = 100 } = {}) {
  const q = { groupId: group._id };
  if (!groupCan(group, membership, 'viewAllRecords')) {
    // Members see group-wide events plus anything about themselves.
    q.$or = [{ memberId: membership._id }, { entityType: { $in: ['SusuGroup', 'SusuCycle', 'SusuPayout'] } }];
  }
  const rows = await SusuActivityLog.find(q).sort({ createdAt: -1 }).limit(limit).lean();
  const names = new Map(
    (
      await User.find({
        _id: { $in: rows.map((r) => r.actorId).filter(Boolean) },
      })
        .select('name')
        .lean()
    ).map((u) => [String(u._id), u.name]),
  );
  return rows.map((r) => ({
    id: String(r._id),
    action: r.action,
    entityType: r.entityType,
    actor: r.actorId ? (names.get(String(r.actorId)) ?? 'Someone') : 'System',
    metadata: r.metadata,
    createdAt: r.createdAt,
  }));
}

/** My standing across all my groups, for the Susu overview. */
export async function myGroupStanding(groups, memberships, today) {
  const out = [];
  for (const g of groups) {
    const m = memberships.get(String(g._id));
    const r = await groupReport(g, m, today);
    const mine = r.members.find((x) => x.member.id === String(m._id));
    const next = r.cycles.find((c) => !c.due);
    out.push({
      groupId: String(g._id),
      outstanding: mine?.outstanding ?? normalize('0', g.currency),
      missedCycles: mine?.missedCycles ?? 0,
      nextCycle: next
        ? {
            number: next.number,
            dueDate: next.dueDate,
            recipient: next.recipient?.displayName,
          }
        : null,
      myTurn: r.cycles.find((c) => c.recipient?.id === String(m._id)) ?? null,
    });
  }
  return out;
}

/* ---------------- proof files ---------------- */

async function proofRecord(kind, group, recordId) {
  const k = KINDS[kind];
  const r = await k.Model.findOne({ _id: recordId, groupId: group._id });
  if (!r) throw ApiError.notFound(`${kind === 'contribution' ? 'Contribution' : 'Payout'} not found.`);
  return { k, r };
}

/**
 * Attaches a receipt or screenshot of the external payment. Allowed for the
 * member the record is about, whoever recorded it, and managers who may record
 * this kind. Replacing a proof keeps the event in the record's history.
 */
export async function attachRecordProof(kind, group, membership, recordId, file, user) {
  const { k, r } = await proofRecord(kind, group, recordId);
  if (r.status === 'cancelled') throw ApiError.badRequest('This record was cancelled.');
  const allowed = membership.status === 'active' && (String(r[k.subject]) === String(membership._id) || String(r.recordedBy) === String(user._id) || groupCan(group, membership, k.capability));
  if (!allowed) throw ApiError.forbidden('Only the member it’s about, whoever recorded it, or a group manager can add proof.');
  const stored = await saveUpload(`groups/${group._id}`, file);
  const previous = r.attachment?.storageKey;
  r.attachment = { ...stored, uploadedBy: user._id, uploadedAt: new Date() };
  r.events.push({ type: 'proof_attached', actorId: user._id, changes: { file: stored.originalName, replaced: Boolean(previous) } });
  await r.save();
  if (previous) await removeUpload(previous);
  await logActivity(group, { actorId: user._id, action: `${kind}.proof_attached`, entityType: kind === 'contribution' ? 'SusuGroupContribution' : 'SusuPayout', entityId: r._id, memberId: r[k.subject], metadata: { name: stored.originalName, size: stored.size } });
  return (await presentAll(kind, group, [r.toObject()], membership))[0];
}

/** Same visibility as the record: payouts to every member, contributions to managers and the member. */
export async function openRecordProof(kind, group, membership, recordId) {
  const { k, r } = await proofRecord(kind, group, recordId);
  if (kind === 'contribution' && !groupCan(group, membership, 'viewAllRecords') && String(r[k.subject]) !== String(membership._id)) throw ApiError.notFound('Contribution not found.');
  if (!r.attachment?.storageKey) throw ApiError.notFound('No proof is attached.');
  return { meta: r.attachment, data: await readUpload(r.attachment.storageKey) };
}
