// Booking state machine (docs/backend.md §6.2, architecture.md §5). Pure: it decides whether a
// transition is allowed and what it leads to. bookingService.transition() applies the result with a
// conditional update ({ _id, status: from }), then records the audit entry and sends notifications.

import { MINUTE, formatIstDateTime } from "../lib/time.js";

export const STATUSES = [
  "pending",
  "approved",
  "rejected",
  "waitlisted",
  "cancelled",
  "expired",
  "checked_in",
  "checked_out",
  "completed",
  "flagged",
  "no_show",
];
export const TERMINAL_STATUSES = [
  "rejected",
  "cancelled",
  "expired",
  "no_show",
  "completed",
];
// Count toward limits.maxActiveBookings (architecture.md §17).
export const ACTIVE_STATUSES = ["pending", "approved", "checked_in"];
// Hold the slot in overlap and capacity checks; a pending request holds it until a manager decides.
export const SLOT_HOLDING_STATUSES = ["pending", "approved", "checked_in"];

export const CHECK_IN_OPENS_MINS = 15;
export const NO_SHOW_GRACE_MINS = 15;
export const OVERDUE_GRACE_MINS = 15;

// Pass as `actor` for cron and service-driven transitions.
export const SYSTEM = Object.freeze({ system: true });

// Guards return an error message, or nothing when the time is right.
const checkInWindow = (b, now) => {
  const opens = new Date(
    new Date(b.start).getTime() - CHECK_IN_OPENS_MINS * MINUTE,
  );
  if (now < opens)
    return `Check-in opens ${CHECK_IN_OPENS_MINS} minutes before the start time (${formatIstDateTime(opens)}).`;
  if (now > new Date(b.end)) return "This booking has already ended.";
};
const noShowGracePassed = (b, now) => {
  if (
    now <= new Date(new Date(b.start).getTime() + NO_SHOW_GRACE_MINS * MINUTE)
  ) {
    return `A booking becomes a no-show ${NO_SHOW_GRACE_MINS} minutes after its start time.`;
  }
};
const startPassed = (b, now) => {
  if (now <= new Date(b.start)) return "The slot hasn't started yet.";
};

// by:        relations allowed to act: borrower | unitManager (manages the booking's OrgUnit) | admin | system
// reason:    true = required; 'ifNotBorrower' = required unless the borrower acts
// review:    a decision on someone's request; nobody but an admin may decide on their own booking
// report:    condition-report phase the payload must carry
// incident:  payload must carry incident details
// freesSlot: when leaving a slot-holding status, promote the waitlist (backend.md §6.3). `waitlist`
//            doesn't, or promotion could pull the same request straight back to pending.
export const TRANSITIONS = {
  approve: {
    from: ["pending"],
    to: "approved",
    by: ["unitManager", "admin"],
    review: true,
    audit: "booking.approved",
  },
  reject: {
    from: ["pending"],
    to: "rejected",
    by: ["unitManager", "admin"],
    reason: true,
    review: true,
    freesSlot: true,
    audit: "booking.rejected",
  },
  waitlist: {
    from: ["pending"],
    to: "waitlisted",
    by: ["unitManager", "admin"],
    reason: true,
    review: true,
    audit: "booking.waitlisted",
  },
  cancel: {
    from: ["pending", "approved", "waitlisted"],
    to: "cancelled",
    by: ["borrower", "unitManager", "admin"],
    reason: "ifNotBorrower",
    freesSlot: true,
    audit: "booking.cancelled",
  },
  promote: {
    from: ["waitlisted"],
    to: "pending",
    toIfAutoApprove: "approved",
    by: ["system"],
    audit: "booking.promoted",
  },
  expire: {
    from: ["waitlisted"],
    to: "expired",
    by: ["system"],
    guard: startPassed,
    audit: "booking.expired",
  },
  checkIn: {
    from: ["approved"],
    to: "checked_in",
    by: ["borrower", "unitManager"],
    report: "check_in",
    guard: checkInWindow,
    audit: "booking.checked_in",
  },
  markNoShow: {
    from: ["approved"],
    to: "no_show",
    by: ["system"],
    guard: noShowGracePassed,
    freesSlot: true,
    audit: "booking.no_show",
  },
  checkOut: {
    from: ["checked_in"],
    to: "checked_out",
    by: ["borrower", "unitManager"],
    report: "check_out",
    audit: "booking.checked_out",
  },
  confirmOk: {
    from: ["checked_out"],
    to: "completed",
    by: ["unitManager", "admin"],
    review: true,
    audit: "booking.completed",
  },
  confirmIssue: {
    from: ["checked_out"],
    to: "flagged",
    by: ["unitManager", "admin"],
    review: true,
    incident: true,
    audit: "booking.flagged",
  },
  closeFlagged: {
    from: ["flagged"],
    to: "completed",
    by: ["system"],
    audit: "booking.completed",
  },
};

const ACTION_LABELS = {
  approve: "approve",
  reject: "reject",
  waitlist: "waitlist",
  cancel: "cancel",
  promote: "promote",
  expire: "expire",
  checkIn: "check in",
  markNoShow: "mark as a no-show",
  checkOut: "check out",
  confirmOk: "confirm the return of",
  confirmIssue: "report an issue on",
  closeFlagged: "close",
};
const STATUS_LABELS = {
  checked_in: "checked in",
  checked_out: "checked out",
  no_show: "a no-show",
};

const idOf = (x) => (x == null ? null : String(x._id ?? x));

// The actor's relations to this booking. One person can hold several, e.g. a faculty
// member who manages the DIC and also books its 3D printer.
// actor: { id | _id, roles: [], managedOrgUnits: [] } or SYSTEM
export function relationsOf(actor, booking) {
  if (actor?.system) return new Set(["system"]);
  const relations = new Set();
  const actorId = idOf(actor?.id ?? actor?._id);
  const roles = actor?.roles ?? [];
  if (actorId && actorId === idOf(booking.borrower)) relations.add("borrower");
  if (
    roles.includes("manager") &&
    (actor.managedOrgUnits ?? []).some((u) => idOf(u) === idOf(booking.orgUnit))
  ) {
    relations.add("unitManager");
  }
  if (roles.includes("admin")) relations.add("admin");
  return relations;
}

const deny = (status, code, message, details) => ({
  ok: false,
  status,
  code,
  message,
  ...(details && { details }),
});
const hasText = (v) => typeof v === "string" && v.trim().length > 0;

// Checks that don't depend on the request payload: state, actor and time.
function checkRules(def, action, booking, relations, now) {
  if (!def.from.includes(booking.status)) {
    return deny(
      409,
      "INVALID_TRANSITION",
      `Can't ${ACTION_LABELS[action]} a booking that is ${STATUS_LABELS[booking.status] ?? booking.status}.`,
    );
  }
  if (!def.by.some((r) => relations.has(r))) {
    return deny(
      403,
      "FORBIDDEN",
      `You're not allowed to ${ACTION_LABELS[action]} this booking.`,
    );
  }
  if (def.review && relations.has("borrower") && !relations.has("admin")) {
    return deny(
      403,
      "FORBIDDEN",
      "You can't decide on your own booking. Another manager of this unit or an admin must.",
    );
  }
  const tooEarlyOrLate = def.guard?.(booking, now);
  if (tooEarlyOrLate) return deny(409, "INVALID_TRANSITION", tooEarlyOrLate);
  return null;
}

// → { ok: true, action, from, to, audit, freesSlot, relations }
//   { ok: false, status, code, message, details? }   (codes from architecture.md §6)
export function canTransition({
  booking,
  action,
  actor,
  payload = {},
  now = new Date(),
}) {
  const def = TRANSITIONS[action];
  if (!def)
    return deny(400, "VALIDATION_ERROR", `Unknown booking action "${action}".`);

  const relations = relationsOf(actor, booking);
  const denied = checkRules(def, action, booking, relations, new Date(now));
  if (denied) return denied;

  const needsReason =
    def.reason === true ||
    (def.reason === "ifNotBorrower" && !relations.has("borrower"));
  if (needsReason && !hasText(payload.reason)) {
    return deny(400, "VALIDATION_ERROR", "A reason is required.", [
      { path: "reason", message: "Required" },
    ]);
  }
  if (def.report && !payload.report) {
    return deny(400, "VALIDATION_ERROR", "A condition report is required.", [
      { path: "report", message: "Required" },
    ]);
  }
  if (def.incident && !payload.incident) {
    return deny(400, "VALIDATION_ERROR", "Incident details are required.", [
      { path: "incident", message: "Required" },
    ]);
  }

  return {
    ok: true,
    action,
    from: booking.status,
    to:
      payload.autoApprove && def.toIfAutoApprove ? def.toIfAutoApprove : def.to,
    audit: def.audit,
    freesSlot:
      Boolean(def.freesSlot) && SLOT_HOLDING_STATUSES.includes(booking.status),
    relations: [...relations],
  };
}

// Actions this actor can take right now, ignoring payload requirements. GET /bookings/:id can
// return this so the UI shows only the buttons that will work.
export function allowedActions(booking, actor, now = new Date()) {
  const relations = relationsOf(actor, booking);
  return Object.entries(TRANSITIONS)
    .filter(
      ([action, def]) =>
        !def.by.includes("system") &&
        !checkRules(def, action, booking, relations, new Date(now)),
    )
    .map(([action]) => action);
}

// Overdue is a flag, not a state (architecture.md §5). Derived on read so the UI is right even if a sweep was missed.
export function isOverdue(booking, now = new Date()) {
  return (
    booking.status === "checked_in" &&
    new Date(now) >
      new Date(new Date(booking.end).getTime() + OVERDUE_GRACE_MINS * MINUTE)
  );
}
