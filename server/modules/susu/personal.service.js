import mongoose from "mongoose";
import Decimal from "decimal.js";
import { ApiError } from "../../utils/ApiError.js";
import { isDuplicateKey } from "../../utils/idempotency.js";
import {
  D,
  fitsCurrency,
  minorUnits,
  normalize,
  str,
  toDecimal128,
} from "../../utils/money.js";
import { addDays, parse } from "../../utils/periods.js";
import { toYmd } from "../../validators/money.js";
import {
  readUpload,
  removeUpload,
  saveUpload,
} from "../../services/fileStorage.js";
import { recordAudit } from "../audit/audit.service.js";
import { SusuContribution, SusuPlan, SusuWithdrawal } from "./susu.models.js";
import { buildSchedule, dueDate } from "./schedule.js";
import { assertWithinLimit } from "../subscriptions/entitlements.js";

/*
 * Personal Susu: plans, contributions and withdrawals the user records.
 * Nothing here creates transactions, touches account balances or appears in
 * income or expense reports. The money stays wherever the user keeps it.
 */

const fieldError = (field, message) =>
  ApiError.validation([{ location: "body", field, message }]);
const oid = (v) => new mongoose.Types.ObjectId(String(v));

function assertFits(value, currency, field) {
  if (!fitsCurrency(value, currency))
    throw fieldError(
      field,
      `${currency} amounts have at most ${minorUnits(currency)} decimal places.`,
    );
}

/** Plain, string-dated view of a plan for the schedule calculator. */
function planShape(plan) {
  return {
    startDate: toYmd(plan.startDate),
    targetDate: toYmd(plan.targetDate),
    frequency: plan.frequency,
    intervalDays: plan.intervalDays,
    currency: plan.currency,
    contributionAmounts: plan.contributionAmounts.map((a) => ({
      amount: str(a.amount),
      effectiveFrom: toYmd(a.effectiveFrom),
    })),
    pauses: plan.pauses.map((p) => ({ from: toYmd(p.from), to: toYmd(p.to) })),
    endedOn: toYmd(plan.completedAt ?? plan.cancelledAt),
  };
}

async function totals(planId) {
  const sum = (Model) =>
    Model.aggregate([
      { $match: { planId: oid(planId), status: "recorded" } },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
          last: { $max: "$date" },
        },
      },
    ]);
  const [[c], [w]] = await Promise.all([
    sum(SusuContribution),
    sum(SusuWithdrawal),
  ]);
  const contributed = str(c?.total) ?? "0";
  const withdrawn = str(w?.total) ?? "0";
  return {
    contributed,
    withdrawn,
    current: new D(contributed).minus(withdrawn).toString(),
    contributionCount: c?.count ?? 0,
    withdrawalCount: w?.count ?? 0,
    lastContribution: toYmd(c?.last),
  };
}

async function scheduleFor(plan, today) {
  const rows = await SusuContribution.find({
    planId: plan._id,
    status: "recorded",
  })
    .select("date amount")
    .lean();
  return buildSchedule(
    planShape(plan),
    rows.map((r) => ({ date: toYmd(r.date), amount: str(r.amount) })),
    today,
  );
}

export async function summarizePlan(plan, today) {
  const cur = plan.currency;
  const [t, { stats }] = await Promise.all([
    totals(plan._id),
    scheduleFor(plan, today),
  ]);
  const target = plan.targetAmount ? str(plan.targetAmount) : null;
  const planned = str(plan.contributionAmounts.at(-1).amount);
  let progress = null;
  let remaining = null;
  let onScheduleFinish = null;
  if (target) {
    const rem = D.max(new D(target).minus(t.current), 0);
    remaining = normalize(rem.toString(), cur);
    progress = D.min(new D(t.current).div(target).times(100), 999.9).toFixed(1);
    // If every coming period is paid as planned, when is the target reached?
    if (!rem.isZero() && plan.status === "active" && stats.nextDue) {
      const periods = rem
        .div(planned)
        .toDecimalPlaces(0, Decimal.ROUND_UP)
        .toNumber();
      if (periods < 5000)
        onScheduleFinish = dueDate(
          planShape(plan),
          stats.periods + periods - 1,
        );
    }
  }
  return {
    contributed: normalize(t.contributed, cur),
    withdrawn: normalize(t.withdrawn, cur),
    current: normalize(t.current, cur),
    target: target ? normalize(target, cur) : null,
    remaining,
    progress,
    reached: Boolean(target && remaining === normalize("0", cur)),
    contributionCount: t.contributionCount,
    withdrawalCount: t.withdrawalCount,
    lastContribution: t.lastContribution,
    onScheduleFinish,
    schedule: stats,
  };
}

export async function presentPlan(plan, today) {
  return {
    id: String(plan._id),
    name: plan.name,
    description: plan.description,
    currency: plan.currency,
    targetAmount: plan.targetAmount
      ? normalize(str(plan.targetAmount), plan.currency)
      : null,
    contributionAmount: normalize(
      str(plan.contributionAmounts.at(-1).amount),
      plan.currency,
    ),
    contributionHistory: plan.contributionAmounts.map((a) => ({
      amount: normalize(str(a.amount), plan.currency),
      effectiveFrom: toYmd(a.effectiveFrom),
    })),
    frequency: plan.frequency,
    intervalDays: plan.intervalDays,
    startDate: toYmd(plan.startDate),
    targetDate: toYmd(plan.targetDate),
    location: { type: plan.location.type, label: plan.location.label },
    status: plan.status,
    notes: plan.notes,
    completedAt: plan.completedAt,
    cancelledAt: plan.cancelledAt,
    cancelReason: plan.cancelReason,
    summary: await summarizePlan(plan, today),
    createdAt: plan.createdAt,
  };
}

async function findPlan(workspaceId, id) {
  const plan = await SusuPlan.findOne({ _id: id, workspaceId });
  if (!plan) throw ApiError.notFound("Susu plan not found.");
  return plan;
}

export async function listPlans(
  workspace,
  today,
  { includeClosed = false } = {},
) {
  const q = { workspaceId: workspace._id };
  if (!includeClosed) q.status = { $in: ["active", "paused"] };
  const plans = await SusuPlan.find(q).sort({ status: 1, createdAt: 1 });
  return Promise.all(plans.map((p) => presentPlan(p, today)));
}

export async function getPlan(workspace, id, today) {
  return presentPlan(await findPlan(workspace._id, id), today);
}

export async function planSchedule(workspace, id, today, limit = 60) {
  const plan = await findPlan(workspace._id, id);
  const { windows, stats } = await scheduleFor(plan, today);
  return { windows: windows.slice(-limit).reverse(), stats };
}

/** Contributed and withdrawn per calendar month, newest first. */
export async function monthlySummary(workspace, id) {
  const plan = await findPlan(workspace._id, id);
  const group = (Model) =>
    Model.aggregate([
      { $match: { planId: plan._id, status: "recorded" } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$date" } },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);
  const [cs, ws] = await Promise.all([
    group(SusuContribution),
    group(SusuWithdrawal),
  ]);
  const months = new Map();
  const row = (m) =>
    months.get(m) ?? {
      month: m,
      contributed: "0",
      withdrawn: "0",
      contributions: 0,
      withdrawals: 0,
    };
  for (const c of cs)
    months.set(c._id, {
      ...row(c._id),
      contributed: str(c.total),
      contributions: c.count,
    });
  for (const w of ws)
    months.set(w._id, {
      ...row(w._id),
      withdrawn: str(w.total),
      withdrawals: w.count,
    });
  return [...months.values()]
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .map((m) => ({
      ...m,
      contributed: normalize(m.contributed, plan.currency),
      withdrawn: normalize(m.withdrawn, plan.currency),
      net: normalize(
        new D(m.contributed).minus(m.withdrawn).toString(),
        plan.currency,
      ),
    }));
}

function checkSchedule(input) {
  if (input.frequency === "custom" && !input.intervalDays)
    throw fieldError(
      "intervalDays",
      "Say how many days between contributions.",
    );
  if (
    input.targetDate &&
    input.startDate &&
    input.targetDate <= input.startDate
  )
    throw fieldError(
      "targetDate",
      "The target date must be after the start date.",
    );
}

export async function createPlan(workspace, input, actor, today, ctx) {
  await assertWithinLimit(workspace, "susuPlans");
  checkSchedule(input);
  assertFits(input.contributionAmount, input.currency, "contributionAmount");
  if (input.targetAmount)
    assertFits(input.targetAmount, input.currency, "targetAmount");
  const plan = await SusuPlan.create({
    workspaceId: workspace._id,
    name: input.name,
    description: input.description ?? "",
    currency: input.currency,
    targetAmount: input.targetAmount
      ? toDecimal128(normalize(input.targetAmount, input.currency))
      : null,
    contributionAmounts: [
      {
        amount: toDecimal128(
          normalize(input.contributionAmount, input.currency),
        ),
        effectiveFrom: parse(input.startDate),
      },
    ],
    frequency: input.frequency,
    intervalDays: input.frequency === "custom" ? input.intervalDays : null,
    startDate: parse(input.startDate),
    targetDate: input.targetDate ? parse(input.targetDate) : null,
    location: { type: input.location.type, label: input.location.label ?? "" },
    notes: input.notes ?? "",
    createdBy: actor._id,
  });
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: "susu_plan.created",
    entityType: "SusuPlan",
    entityId: plan._id,
    metadata: {
      name: plan.name,
      currency: plan.currency,
      contributionAmount: input.contributionAmount,
      frequency: plan.frequency,
    },
    ctx,
  });
  return presentPlan(plan, today);
}

/**
 * Edits details and handles status changes. The schedule (frequency, start
 * date, currency) locks once contributions exist, because changing it would
 * rewrite which past periods were met or missed.
 */
export async function updatePlan(workspace, id, changes, actor, today, ctx) {
  const plan = await findPlan(workspace._id, id);
  if (plan.status === "cancelled")
    throw ApiError.badRequest("This plan was cancelled and is read-only.");
  const before = {
    status: plan.status,
    contributionAmount: str(plan.contributionAmounts.at(-1).amount),
    targetAmount: str(plan.targetAmount),
    name: plan.name,
  };
  const hasEntries = await SusuContribution.exists({ planId: plan._id });

  const scheduleKeys = ["frequency", "intervalDays", "startDate", "currency"];
  if (scheduleKeys.some((k) => changes[k] !== undefined)) {
    if (hasEntries)
      throw ApiError.conflict(
        "Contributions are already recorded, so the schedule and currency can’t change. Start a new plan instead.",
        "SCHEDULE_LOCKED",
      );
    const merged = {
      frequency: changes.frequency ?? plan.frequency,
      intervalDays: changes.intervalDays ?? plan.intervalDays,
      startDate: changes.startDate ?? toYmd(plan.startDate),
      targetDate: changes.targetDate ?? toYmd(plan.targetDate),
    };
    checkSchedule(merged);
    plan.frequency = merged.frequency;
    plan.intervalDays =
      merged.frequency === "custom" ? merged.intervalDays : null;
    plan.startDate = parse(merged.startDate);
    if (changes.currency) plan.currency = changes.currency;
    plan.contributionAmounts[0].effectiveFrom = plan.startDate;
  }
  if (changes.contributionAmount) {
    assertFits(changes.contributionAmount, plan.currency, "contributionAmount");
    // The new amount applies from today on; earlier periods keep their expectation.
    const value = toDecimal128(
      normalize(changes.contributionAmount, plan.currency),
    );
    const from = parse(today);
    if (!hasEntries)
      plan.contributionAmounts = [
        { amount: value, effectiveFrom: plan.startDate },
      ];
    else {
      const same = plan.contributionAmounts.find(
        (a) => a.effectiveFrom.getTime() === from.getTime(),
      );
      if (same) same.amount = value;
      else
        plan.contributionAmounts.push({ amount: value, effectiveFrom: from });
    }
  }
  if (changes.targetAmount !== undefined) {
    if (changes.targetAmount)
      assertFits(changes.targetAmount, plan.currency, "targetAmount");
    plan.targetAmount = changes.targetAmount
      ? toDecimal128(normalize(changes.targetAmount, plan.currency))
      : null;
  }
  if (changes.targetDate !== undefined) {
    if (changes.targetDate && changes.targetDate <= toYmd(plan.startDate))
      throw fieldError(
        "targetDate",
        "The target date must be after the start date.",
      );
    plan.targetDate = changes.targetDate ? parse(changes.targetDate) : null;
  }
  if (changes.location)
    plan.location = {
      type: changes.location.type ?? plan.location.type,
      label: changes.location.label ?? plan.location.label,
    };
  for (const key of ["name", "description", "notes"])
    if (changes[key] !== undefined) plan[key] = changes[key];

  let action = "susu_plan.updated";
  if (changes.status && changes.status !== plan.status) {
    action = applyStatus(plan, changes.status, changes.cancelReason, today);
  }
  plan.markModified("contributionAmounts");
  plan.markModified("pauses");
  await plan.save();

  const after = {
    status: plan.status,
    contributionAmount: str(plan.contributionAmounts.at(-1).amount),
    targetAmount: str(plan.targetAmount),
    name: plan.name,
  };
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action,
    entityType: "SusuPlan",
    entityId: plan._id,
    metadata: { before, after, reason: changes.cancelReason ?? "" },
    ctx,
  });
  return presentPlan(plan, today);
}

function applyStatus(plan, next, reason, today) {
  const from = plan.status;
  if (next === "paused") {
    if (from !== "active")
      throw ApiError.badRequest("Only an active plan can be paused.");
    plan.pauses.push({ from: parse(today), to: null });
  } else if (next === "active") {
    if (from === "paused") {
      const open = plan.pauses.find((p) => p.to === null);
      if (open) {
        // Periods due today onwards count again.
        const end = addDays(today, -1);
        if (end < toYmd(open.from))
          plan.pauses = plan.pauses.filter((p) => p !== open);
        else open.to = parse(end);
      }
    } else if (from === "completed") {
      plan.completedAt = null;
    }
  } else if (next === "completed") {
    if (from === "paused") {
      const open = plan.pauses.find((p) => p.to === null);
      if (open) open.to = parse(today);
    }
    plan.completedAt = new Date(`${today}T00:00:00.000Z`);
  } else if (next === "cancelled") {
    if (!reason || reason.trim().length < 3)
      throw fieldError("cancelReason", "Say why the plan is being cancelled.");
    plan.cancelledAt = new Date(`${today}T00:00:00.000Z`);
    plan.cancelReason = reason.trim();
  }
  plan.status = next;
  return {
    paused: "susu_plan.paused",
    active: from === "completed" ? "susu_plan.reopened" : "susu_plan.resumed",
    completed: "susu_plan.completed",
    cancelled: "susu_plan.cancelled",
  }[next];
}

/* ---------------- entries ---------------- */

const MODELS = { contribution: SusuContribution, withdrawal: SusuWithdrawal };

export function presentEntry(e, kind) {
  return {
    id: String(e._id),
    kind,
    amount: normalize(str(e.amount), e.currency),
    currency: e.currency,
    date: toYmd(e.date),
    notes: e.notes,
    reason: e.reason ?? undefined,
    status: e.status,
    cancelledAt: e.cancelledAt,
    cancelReason: e.cancelReason,
    attachment: e.attachment
      ? {
          name: e.attachment.originalName,
          mimeType: e.attachment.mimeType,
          size: e.attachment.size,
        }
      : null,
    createdAt: e.createdAt,
  };
}

export async function listEntries(workspace, planId, kind) {
  const plan = await findPlan(workspace._id, planId);
  const rows = await MODELS[kind]
    .find({ planId: plan._id })
    .sort({ date: -1, createdAt: -1 })
    .lean();
  return rows.map((r) => presentEntry(r, kind));
}

export async function addEntry(
  workspace,
  planId,
  kind,
  input,
  actor,
  today,
  ctx,
  clientRef,
) {
  const plan = await findPlan(workspace._id, planId);
  if (clientRef) {
    // A replay of an entry this user already sent (e.g. an offline draft): return it unchanged.
    const prior = await MODELS[kind].findOne({
      createdBy: actor._id,
      clientRef,
    });
    if (prior) {
      if (String(prior.planId) !== String(plan._id))
        throw ApiError.conflict(
          "This Idempotency-Key was already used for a different record.",
          "IDEMPOTENCY_MISMATCH",
        );
      return {
        entry: presentEntry(prior, kind),
        plan: await presentPlan(plan, today),
        replayed: true,
      };
    }
  }
  if (plan.status === "cancelled")
    throw ApiError.badRequest("This plan was cancelled and is read-only.");
  if (kind === "contribution" && plan.status === "completed")
    throw ApiError.badRequest(
      "This plan is marked complete. Reopen it to record contributions.",
    );
  assertFits(input.amount, plan.currency, "amount");
  if (input.date > today)
    throw fieldError("date", "Entries can’t be dated in the future.");
  if (input.date < toYmd(plan.startDate))
    throw fieldError("date", "This is before the plan started.");
  if (kind === "withdrawal") {
    const { current } = await totals(plan._id);
    if (new D(input.amount).greaterThan(current)) {
      throw fieldError(
        "amount",
        `That’s more than the ${normalize(current, plan.currency)} ${plan.currency} recorded in this plan.`,
      );
    }
  }
  let entry;
  try {
    entry = await MODELS[kind].create({
      workspaceId: workspace._id,
      planId: plan._id,
      amount: toDecimal128(normalize(input.amount, plan.currency)),
      currency: plan.currency,
      date: parse(input.date),
      notes: input.notes ?? "",
      ...(kind === "withdrawal" ? { reason: input.reason } : {}),
      createdBy: actor._id,
      clientRef,
    });
  } catch (err) {
    // Two copies of the same request raced: the other one won, so return what it saved.
    if (clientRef && isDuplicateKey(err))
      return {
        entry: presentEntry(
          await MODELS[kind].findOne({ createdBy: actor._id, clientRef }),
          kind,
        ),
        plan: await presentPlan(plan, today),
        replayed: true,
      };
    throw err;
  }
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: `susu_plan.${kind}_recorded`,
    entityType: "SusuPlan",
    entityId: plan._id,
    metadata: {
      entryId: String(entry._id),
      amount: str(entry.amount),
      date: input.date,
      ...(kind === "withdrawal" ? { reason: input.reason } : {}),
    },
    ctx,
  });
  return {
    entry: presentEntry(entry, kind),
    plan: await presentPlan(plan, today),
  };
}

export async function cancelEntry(
  workspace,
  planId,
  kind,
  entryId,
  reason,
  actor,
  today,
  ctx,
) {
  const plan = await findPlan(workspace._id, planId);
  if (plan.status === "cancelled")
    throw ApiError.badRequest("This plan was cancelled and is read-only.");
  const entry = await MODELS[kind].findOne({
    _id: entryId,
    planId: plan._id,
    status: "recorded",
  });
  if (!entry) throw ApiError.notFound("Entry not found, or already cancelled.");
  if (kind === "contribution") {
    const { current } = await totals(plan._id);
    if (new D(current).minus(str(entry.amount)).lessThan(0)) {
      throw ApiError.conflict(
        "Cancelling this would leave the plan below zero. Cancel the later withdrawal first.",
        "WOULD_GO_NEGATIVE",
      );
    }
  }
  entry.status = "cancelled";
  entry.cancelledAt = new Date();
  entry.cancelledBy = actor._id;
  entry.cancelReason = reason;
  await entry.save();
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: `susu_plan.${kind}_cancelled`,
    entityType: "SusuPlan",
    entityId: plan._id,
    metadata: { entryId: String(entry._id), amount: str(entry.amount), reason },
    ctx,
  });
  return {
    entry: presentEntry(entry, kind),
    plan: await presentPlan(plan, today),
  };
}

/** One proof file per contribution, e.g. a photo of the collector's card. */
export async function attachProof(
  workspace,
  planId,
  entryId,
  file,
  actor,
  ctx,
) {
  const plan = await findPlan(workspace._id, planId);
  const entry = await SusuContribution.findOne({
    _id: entryId,
    planId: plan._id,
  });
  if (!entry) throw ApiError.notFound("Contribution not found.");
  if (entry.status !== "recorded")
    throw ApiError.badRequest("This contribution was cancelled.");
  const stored = await saveUpload(workspace._id, file);
  const previous = entry.attachment?.storageKey;
  entry.attachment = stored;
  await entry.save();
  if (previous) await removeUpload(previous);
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: "susu_plan.proof_attached",
    entityType: "SusuPlan",
    entityId: plan._id,
    metadata: {
      entryId: String(entry._id),
      name: stored.originalName,
      replaced: Boolean(previous),
    },
    ctx,
  });
  return presentEntry(entry, "contribution");
}

export async function openProof(workspace, planId, entryId) {
  const plan = await findPlan(workspace._id, planId);
  const entry = await SusuContribution.findOne({
    _id: entryId,
    planId: plan._id,
  });
  if (!entry?.attachment) throw ApiError.notFound("No file attached.");
  return {
    meta: entry.attachment,
    data: await readUpload(entry.attachment.storageKey),
  };
}

/** Workspace overview: totals per currency and how plans are keeping up. Never mixed across currencies. */
export async function susuSummary(workspace, today) {
  const plans = await SusuPlan.find({
    workspaceId: workspace._id,
    status: { $in: ["active", "paused"] },
  });
  const byCurrency = new Map();
  const items = [];
  for (const plan of plans) {
    const s = await summarizePlan(plan, today);
    const row = byCurrency.get(plan.currency) ?? {
      currency: plan.currency,
      plans: 0,
      current: new D(0),
      arrears: new D(0),
      missed: 0,
    };
    row.plans += 1;
    row.current = row.current.plus(s.current);
    row.arrears = row.arrears.plus(s.schedule.arrears);
    row.missed += s.schedule.missed;
    byCurrency.set(plan.currency, row);
    items.push({
      id: String(plan._id),
      name: plan.name,
      currency: plan.currency,
      status: plan.status,
      current: s.current,
      progress: s.progress,
      missed: s.schedule.missed,
      arrears: normalize(new D(s.schedule.arrears).toString(), plan.currency),
      nextDue: s.schedule.nextDue,
    });
  }
  return {
    totals: [...byCurrency.values()].map((r) => ({
      ...r,
      current: normalize(r.current.toString(), r.currency),
      arrears: normalize(r.arrears.toString(), r.currency),
    })),
    plans: items,
  };
}
