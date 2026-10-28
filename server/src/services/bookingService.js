// Booking lifecycle (backend.md §6, architecture.md §5 and §9). Controllers pass the Zod-validated
// input and req.user.id; every change is audited and notified (bookingTransitions.js).
//
// Concurrency: creating and approving run under the resource lock (lib/lock.js), so the capacity
// count and the write can't interleave with another request for the same resource. Every status
// change is a conditional update on the status that was read, so two managers acting at once can't
// both win. If Redis is down, creating and approving answer 503 rather than risk a double booking.
import { evaluate, requestStatus } from "../engines/eligibility.js";
import {
  SYSTEM,
  allowedActions,
  canTransition,
  isOverdue,
  relationsOf,
} from "../engines/stateMachine.js";
import { withLock } from "../lib/lock.js";
import { BOOKING_STATUSES, RETURN_OUTCOMES } from "../models/enums.js";
import { keys } from "../lib/redisKeys.js";
import {
  ServiceError,
  forbidden,
  invalid,
  notFound,
} from "../lib/serviceError.js";
import {
  AuditLog,
  Booking,
  ConditionReport,
  Incident,
  User,
} from "../models/index.js";
import { record } from "./auditService.js";
import {
  eligibilityContext,
  loadResource,
  slotUsage,
  waitlistPosition,
} from "./bookingContext.js";
import {
  applyTransition,
  auditActor,
  notifyBooking,
} from "./bookingTransitions.js";
import {
  describeEntry,
  describeReport,
  groupConflicts,
} from "./bookingViews.js";
import { OUTCOME_LABELS, send } from "./notifyService.js";
import {
  assertValid,
  readEnum,
  readId,
  readInstant,
  readPaging,
  requireUser,
} from "./params.js";
import { promoteFreedSlot, snapshot } from "./waitlistService.js";

export { SYSTEM };

const QUEUE_CAP = 500;

const fromCheck = (check) =>
  new ServiceError(check.status, check.code, check.message, check.details);
const slotOf = ({ start, end }) => ({
  start: new Date(start),
  end: new Date(end),
});
const managersOf = (resource) => resource.orgUnit?.managers ?? [];

async function requireResource(resourceId) {
  const resource = await loadResource(resourceId);
  if (!resource) throw notFound("Resource");
  return resource;
}

async function requireBooking(bookingId) {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) throw notFound("Booking");
  return booking;
}

const resolveActor = (actorId) =>
  actorId === SYSTEM ? SYSTEM : requireUser(actorId);

function assertCanView(viewer, booking) {
  if (!relationsOf(viewer, booking).size)
    throw forbidden("You can't view this booking.");
}

// 422 with the failed rules as details, as in the envelope example (architecture.md §6).
function ineligible(evaluation) {
  const failed = evaluation.results
    .filter((r) => r.hard && !r.passed)
    .map(({ rule, passed, message, fixHint }) => ({
      rule,
      passed,
      message,
      fixHint,
    }));
  const n = failed.length;
  return new ServiceError(
    422,
    "INELIGIBLE",
    `You don't meet ${n} requirement${n === 1 ? "" : "s"} for this resource.`,
    failed,
  );
}

// ── Request ─────────────────────────────────────────────────────────────────

// POST /bookings/check: the evaluation POST /bookings enforces, without creating anything.
export async function checkBooking(userId, input, { now = new Date() } = {}) {
  const [user, resource] = await Promise.all([
    requireUser(userId),
    requireResource(input.resourceId),
  ]);
  const slot = slotOf(input);
  const ctx = await eligibilityContext(user, resource, slot, { now });
  const evaluation = evaluate(user, resource, slot, ctx);
  return {
    ...evaluation,
    waitlistPosition:
      evaluation.outcome === "slot_taken" ? ctx.waitlistAhead + 1 : null,
  };
}

// POST /bookings → { booking, evaluation, waitlistPosition }
// Throws 422 INELIGIBLE, 409 SLOT_TAKEN (unless joinWaitlist) or 503 when the lock is unavailable.
export async function createBooking(
  userId,
  input,
  { now = new Date(), requestId } = {},
) {
  const [user, resource] = await Promise.all([
    requireUser(userId),
    requireResource(input.resourceId),
  ]);
  const slot = slotOf(input);

  const { booking, evaluation, position } = await withLock(
    keys.resourceLock(resource._id),
    async () => {
      const ctx = await eligibilityContext(user, resource, slot, { now });
      const evaluation = evaluate(user, resource, slot, ctx);
      const { status, error } = requestStatus(evaluation, {
        joinWaitlist: input.joinWaitlist,
      });
      const position = ctx.waitlistAhead + 1;
      if (error === "INELIGIBLE") throw ineligible(evaluation);
      if (error === "SLOT_TAKEN") {
        throw new ServiceError(
          409,
          "SLOT_TAKEN",
          `This slot is held by an earlier request. You can join the waitlist as #${position}.`,
          { waitlistPosition: position },
        );
      }
      const created = await Booking.create({
        resource: resource._id,
        orgUnit: resource.orgUnit._id,
        borrower: user._id,
        ...slot,
        purpose: input.purpose,
        status,
        eligibilitySnapshot: snapshot(evaluation),
        ...(status === "approved" && {
          decision: { action: "approve", at: now, reason: "Auto-approved" },
        }),
      });
      return { booking: created.toObject(), evaluation, position };
    },
  );

  await record({
    actor: { id: user._id, role: "member" },
    action: "booking.requested",
    entity: { type: "booking", id: booking._id },
    orgUnit: booking.orgUnit,
    changes: { status: [null, booking.status] },
    requestId,
  });
  const sends = {
    pending: [[managersOf(resource), "booking.requested", "manager"]],
    approved: [[[user._id], "booking.approved"]],
    waitlisted: [[[user._id], "booking.waitlisted"]],
  }[booking.status];
  await notifyBooking(sends, booking, resource, { position });

  return {
    booking,
    evaluation,
    waitlistPosition: booking.status === "waitlisted" ? position : null,
  };
}

// ── Decisions and system transitions ───────────────────────────────────────

const GENERIC_ACTIONS = new Set([
  "approve",
  "reject",
  "waitlist",
  "cancel",
  "expire",
  "markNoShow",
  "closeFlagged",
]);

function decisionFields(action, actor, payload, now) {
  if (["approve", "reject", "waitlist"].includes(action)) {
    return {
      decision: {
        action,
        by: actor._id,
        at: now,
        reason: payload.reason ?? payload.note,
      },
    };
  }
  if (action === "cancel") {
    return {
      cancellation: { by: actor._id ?? null, at: now, reason: payload.reason },
    };
  }
  return {};
}

// approve (payload.note?) | reject | waitlist (payload.reason) | cancel (reason unless the borrower);
// the sweeper's expire | markNoShow and incident resolution's closeFlagged pass actorId = SYSTEM.
// Check-in, check-out and return confirmation have their own functions below.
export async function transition(
  bookingId,
  action,
  actorId,
  payload = {},
  { now = new Date(), requestId } = {},
) {
  if (!GENERIC_ACTIONS.has(action)) {
    throw invalid(`"${action}" isn't a decision; use its own function.`);
  }
  const [booking, actor] = await Promise.all([
    requireBooking(bookingId),
    resolveActor(actorId),
  ]);
  const resource = await requireResource(booking.resource);

  const apply = async () => {
    // Approval re-reads and re-counts under the lock (architecture.md §9).
    const current =
      action === "approve" ? await requireBooking(bookingId) : booking;
    const check = canTransition({
      booking: current,
      action,
      actor,
      payload,
      now,
    });
    if (!check.ok) throw fromCheck(check);
    if (action === "approve") {
      const used = await slotUsage(resource._id, current, {
        excludeId: current._id,
      });
      if (used >= (resource.quantity ?? 1)) {
        throw new ServiceError(
          409,
          "SLOT_TAKEN",
          "Another booking already holds this slot. Reject this request or move it to the waitlist.",
        );
      }
    }
    const notifyExtra =
      action === "waitlist"
        ? { position: await waitlistPosition(current) }
        : undefined;
    const updated = await applyTransition({
      booking: current,
      resource,
      check,
      actor,
      reason: payload.reason ?? payload.note,
      set: decisionFields(action, actor, payload, now),
      requestId,
      notifyExtra,
    });
    return { updated, check };
  };

  const { updated, check } =
    action === "approve"
      ? await withLock(keys.resourceLock(resource._id), apply)
      : await apply();
  if (check.freesSlot) {
    // A manager who waitlists a request wants the slot to go to someone else.
    const skip = action === "waitlist" ? [booking._id] : [];
    await promoteFreedSlot(resource, booking, { now, requestId, skip });
  }
  return updated;
}

// ── Handovers and returns ───────────────────────────────────────────────────

// Every checklist item exactly once, nothing else (backend.md §7, bookings.checkIn).
function assertChecklist(resource, items = []) {
  const expected = resource.checklist ?? [];
  const labels = items.map((item) => item.label);
  const problems = [
    ...expected.filter((l) => !labels.includes(l)).map((l) => `Missing: ${l}`),
    ...labels
      .filter((l) => !expected.includes(l))
      .map((l) => `Not on this resource's checklist: ${l}`),
    ...labels
      .filter((l, i) => labels.indexOf(l) !== i)
      .map((l) => `Listed twice: ${l}`),
  ];
  if (problems.length) {
    throw invalid(
      "The condition report must cover each checklist item once.",
      problems.map((message) => ({ path: "items", message })),
    );
  }
}

async function createReport(booking, resource, phase, actor, report) {
  try {
    return await ConditionReport.create({
      booking: booking._id,
      resource: resource._id,
      phase,
      items: report.items ?? [],
      photos: report.photos ?? [],
      overall: report.overall,
      notes: report.notes,
      submittedBy: actor._id,
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw new ServiceError(
        409,
        "INVALID_TRANSITION",
        "This step is already recorded for this booking.",
      );
    }
    throw err;
  }
}

const HANDOVERS = {
  checkIn: { phase: "check_in", field: "checkIn" },
  checkOut: { phase: "check_out", field: "checkOut" },
};

async function handover(
  action,
  bookingId,
  actorId,
  report,
  { now = new Date(), requestId } = {},
) {
  const { phase, field } = HANDOVERS[action];
  const [booking, actor] = await Promise.all([
    requireBooking(bookingId),
    requireUser(actorId),
  ]);
  const resource = await requireResource(booking.resource);
  const check = canTransition({
    booking,
    action,
    actor,
    payload: { report },
    now,
  });
  if (!check.ok) throw fromCheck(check);
  assertChecklist(resource, report.items);

  const saved = await createReport(booking, resource, phase, actor, report);
  try {
    return await applyTransition({
      booking,
      resource,
      check,
      actor,
      set: { [field]: { at: now, by: actor._id, report: saved._id } },
      requestId,
    });
  } catch (err) {
    await ConditionReport.deleteOne({ _id: saved._id }).catch(() => {});
    throw err;
  }
}

// POST /bookings/:id/check-in and /check-out. report: { items[{label, ok, note}], photos[], overall, notes }
export const checkIn = (bookingId, actorId, report, options) =>
  handover("checkIn", bookingId, actorId, report, options);
export const checkOut = (bookingId, actorId, report, options) =>
  handover("checkOut", bookingId, actorId, report, options);

async function announceIncident(
  incident,
  booking,
  resource,
  actor,
  check,
  requestId,
) {
  await record({
    actor: auditActor(actor, check.action, check.relations),
    action: "incident.created",
    entity: { type: "incident", id: incident._id },
    orgUnit: booking.orgUnit,
    changes: { status: [null, incident.status] },
    meta: {
      bookingId: booking._id,
      type: incident.type,
      severity: incident.severity,
    },
    requestId,
  });
  const data = {
    incidentId: String(incident._id),
    type: incident.type,
    severity: incident.severity,
    resourceTitle: resource.title,
  };
  await send([booking.borrower], "incident.created", {
    ...data,
    audience: "member",
  });
  await send(managersOf(resource), "incident.created", {
    ...data,
    audience: "manager",
  });
  if (incident.severity === "high") {
    const admins = await User.find({ roles: "admin" }, { _id: 1 }).lean();
    await send(
      admins.map((a) => a._id),
      "incident.created",
      { ...data, audience: "admin" },
    );
  }
}

// POST /bookings/:id/confirm-return. input: { outcome: "ok" | "issue", items?, photos?, note?,
// incident?: { type, severity, description } }. "issue" flags the booking and opens an incident
// that a human resolves; the booking completes when it is resolved (closeFlagged).
// → { booking, incident }
export async function confirmReturn(
  bookingId,
  actorId,
  input,
  { now = new Date(), requestId } = {},
) {
  // Never default to "ok": a missing outcome would silently close a booking without an inspection.
  if (!RETURN_OUTCOMES.includes(input.outcome)) {
    throw invalid('The outcome must be "ok" or "issue".', [
      { path: "outcome", message: 'Expected "ok" or "issue"' },
    ]);
  }
  const action = input.outcome === "issue" ? "confirmIssue" : "confirmOk";
  const [booking, actor] = await Promise.all([
    requireBooking(bookingId),
    requireUser(actorId),
  ]);
  const resource = await requireResource(booking.resource);
  const check = canTransition({
    booking,
    action,
    actor,
    payload: { incident: input.incident },
    now,
  });
  if (!check.ok) throw fromCheck(check);
  if (input.items?.length) assertChecklist(resource, input.items);

  const note = input.note ?? input.notes;
  const overall =
    action === "confirmOk"
      ? "good"
      : input.incident.severity === "high"
        ? "damaged"
        : "minor_issue";
  const report =
    input.items?.length || input.photos?.length
      ? await createReport(booking, resource, "return_confirmation", actor, {
          items: input.items,
          photos: input.photos,
          overall,
          notes: note,
        })
      : null;
  const incident =
    action === "confirmIssue"
      ? await Incident.create({
          booking: booking._id,
          resource: resource._id,
          orgUnit: booking.orgUnit,
          reportedBy: actor._id,
          source: "manager",
          type: input.incident.type,
          severity: input.incident.severity,
          description: input.incident.description,
          photos: input.photos ?? [],
        })
      : null;

  let updated;
  try {
    updated = await applyTransition({
      booking,
      resource,
      check,
      actor,
      reason: note,
      set: {
        returnConfirmation: {
          at: now,
          by: actor._id,
          outcome: input.outcome,
          report: report?._id,
        },
      },
      push: incident ? { incidents: incident._id } : undefined,
      requestId,
    });
  } catch (err) {
    await Promise.all([
      report && ConditionReport.deleteOne({ _id: report._id }),
      incident && Incident.deleteOne({ _id: incident._id }),
    ]).catch(() => {});
    throw err;
  }

  if (incident)
    await announceIncident(
      incident,
      booking,
      resource,
      actor,
      check,
      requestId,
    );
  return { booking: updated, incident: incident?.toObject() ?? null };
}

// ── Reads ───────────────────────────────────────────────────────────────────

// GET /bookings/:id for the borrower, a manager of the unit or an admin. Managers see the
// borrower's name, member type and department, never their email or ID card (architecture.md §16).
// → the booking plus allowedActions (the buttons to show), isOverdue and waitlistPosition
export async function getBooking(
  bookingId,
  viewerId,
  { now = new Date() } = {},
) {
  const [booking, viewer] = await Promise.all([
    Booking.findById(bookingId)
      .populate("resource", "title slug location bookingMode checklist")
      .populate("borrower", "name memberType department")
      .populate("orgUnit", "name code")
      .lean(),
    requireUser(viewerId),
  ]);
  if (!booking) throw notFound("Booking");
  assertCanView(viewer, booking);
  return {
    ...booking,
    allowedActions: allowedActions(booking, viewer, now),
    isOverdue: isOverdue(booking, now),
    waitlistPosition:
      booking.status === "waitlisted" ? await waitlistPosition(booking) : null,
  };
}

// GET /bookings/mine. query: { status, page, limit } → { items, meta }, latest start first.
export async function listMine(userId, query = {}) {
  const user = await requireUser(userId);
  const problems = [];
  const status = readEnum(query.status, BOOKING_STATUSES, "status", problems);
  const { page, limit } = readPaging(query, problems);
  assertValid(problems);

  const filter = { borrower: user._id, ...(status && { status }) };
  const [items, total] = await Promise.all([
    Booking.find(filter)
      .sort({ start: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("resource", "title slug location")
      .lean(),
    Booking.countDocuments(filter),
  ]);
  for (const item of items) {
    if (item.status === "waitlisted")
      item.waitlistPosition = await waitlistPosition(item);
  }
  return { items, meta: { page, limit, total } };
}

// GET /bookings/manage, limited to the manager's units (admins see all). status=pending returns
// conflict groups: each pending request with the waitlisted requests competing for its slot.
// query: { status, resourceId, from, to, page, limit }, with from and to bounding the start as
// [from, to).
export async function listForManager(managerId, query = {}) {
  const manager = await requireUser(managerId);
  const isAdmin = manager.roles?.includes("admin");
  if (!isAdmin && !manager.roles?.includes("manager")) {
    throw forbidden("Only unit managers can see this queue.");
  }
  const problems = [];
  const status = readEnum(query.status, BOOKING_STATUSES, "status", problems);
  const resourceId = readId(query.resourceId, "resourceId", problems);
  const from = readInstant(query.from, "from", problems);
  const to = readInstant(query.to, "to", problems);
  const { page, limit } = readPaging(query, problems);
  assertValid(problems);

  const filter = {
    ...(!isAdmin && { orgUnit: { $in: manager.managedOrgUnits ?? [] } }),
    ...(resourceId && { resource: resourceId }),
    ...((from || to) && {
      start: { ...(from && { $gte: from }), ...(to && { $lt: to }) },
    }),
  };
  const withPeople = (query) =>
    query
      .populate("resource", "title slug quantity")
      .populate("borrower", "name memberType department")
      .lean();

  if (status === "pending") {
    const competing = await withPeople(
      Booking.find({ ...filter, status: { $in: ["pending", "waitlisted"] } })
        .sort({ createdAt: 1 })
        .limit(QUEUE_CAP),
    );
    const groups = groupConflicts(competing);
    return {
      groups: groups.slice((page - 1) * limit, page * limit),
      meta: { page, limit, total: groups.length },
    };
  }

  const matching = { ...filter, ...(status && { status }) };
  const [items, total] = await Promise.all([
    withPeople(
      Booking.find(matching)
        .sort({ start: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ),
    Booking.countDocuments(matching),
  ]);
  return { items, meta: { page, limit, total } };
}

// GET /bookings/:id/timeline: audit entries, condition reports and incidents, oldest first.
export async function getTimeline(bookingId, viewerId) {
  const [booking, viewer] = await Promise.all([
    Booking.findById(bookingId).populate("orgUnit", "code").lean(),
    requireUser(viewerId),
  ]);
  if (!booking) throw notFound("Booking");
  assertCanView(viewer, booking);

  const [entries, reports, incidents] = await Promise.all([
    AuditLog.find({ "entity.type": "booking", "entity.id": booking._id })
      .sort({ at: 1 })
      .populate("actor.id", "name")
      .lean(),
    ConditionReport.find({ booking: booking._id })
      .populate("submittedBy", "name")
      .lean(),
    Incident.find(
      { booking: booking._id },
      { type: 1, severity: 1, status: 1, createdAt: 1, resolution: 1 },
    ).lean(),
  ]);
  const unitCode = booking.orgUnit?.code;

  return [
    ...entries.map((e) => ({
      kind: "event",
      at: e.at,
      action: e.action,
      actor: { role: e.actor.role, name: e.actor.id?.name ?? null },
      reason: e.reason ?? null,
      text: describeEntry(e, { actorName: e.actor.id?.name, unitCode }),
    })),
    ...reports.map((r) => ({
      kind: "condition_report",
      at: r.at,
      phase: r.phase,
      overall: r.overall,
      items: r.items,
      photos: r.photos,
      notes: r.notes ?? null,
      by: r.submittedBy?.name ?? null,
      text: describeReport(r),
    })),
    ...incidents.flatMap((i) => {
      const item = {
        kind: "incident",
        id: i._id,
        type: i.type,
        severity: i.severity,
        status: i.status,
      };
      const opened = {
        ...item,
        event: "opened",
        at: i.createdAt,
        text: `Incident opened: ${i.severity}-severity ${i.type}`,
      };
      if (!i.resolution?.at) return [opened];
      const { outcome } = i.resolution;
      return [
        opened,
        {
          ...item,
          event: "resolved",
          at: i.resolution.at,
          outcome,
          text: `Incident resolved. Outcome: ${OUTCOME_LABELS[outcome] ?? outcome}`,
        },
      ];
    }),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
}
