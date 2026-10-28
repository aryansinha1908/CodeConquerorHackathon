// Applies a transition the state machine has already allowed: one conditional update, then the audit
// entry, then notifications (backend.md §6.2). Shared by bookingService and waitlistService.
import { TRANSITIONS } from "../engines/stateMachine.js";
import { ServiceError } from "../lib/serviceError.js";
import { formatIstRange } from "../lib/time.js";
import { Booking, User } from "../models/index.js";
import { SYSTEM_ACTOR, record } from "./auditService.js";
import { send } from "./notifyService.js";

const RELATION_ROLE = {
  borrower: "member",
  unitManager: "manager",
  admin: "admin",
  system: "system",
};

// The capacity the actor acted in: the first relation the transition allows that the actor holds.
export function auditActor(actor, action, relations) {
  if (actor?.system) return SYSTEM_ACTOR;
  const relation = TRANSITIONS[action].by.find((r) => relations.includes(r));
  return { id: actor._id, role: RELATION_ROLE[relation] };
}

const managersOf = (resource) => resource.orgUnit?.managers ?? [];

// Notification text needs the borrower's name only when managers are told.
async function notificationData(booking, resource, extra) {
  const borrower = await User.findById(booking.borrower, { name: 1 }).lean();
  return {
    bookingId: String(booking._id),
    resourceTitle: resource.title,
    when: formatIstRange(booking.start, booking.end),
    borrowerName: borrower?.name ?? "A member",
    status: booking.status,
    ...extra,
  };
}

// [recipients, event, audience] per action; confirmIssue is notified as incident.created instead.
const NOTIFY = {
  approve: (b) => [[[b.borrower], "booking.approved"]],
  reject: (b) => [[[b.borrower], "booking.rejected"]],
  waitlist: (b) => [[[b.borrower], "booking.waitlisted"]],
  cancel: (b, r, relations) =>
    relations.includes("borrower")
      ? [[managersOf(r), "booking.cancelled", "manager"]]
      : [[[b.borrower], "booking.cancelled"]],
  promote: (b) => [[[b.borrower], "booking.promoted"]],
  expire: (b) => [[[b.borrower], "booking.expired"]],
  checkIn: (b, r) => [[managersOf(r), "booking.checked_in", "manager"]],
  markNoShow: (b, r) => [
    [[b.borrower], "booking.no_show"],
    [managersOf(r), "booking.no_show", "manager"],
  ],
  checkOut: (b, r) => [[managersOf(r), "booking.checked_out", "manager"]],
  confirmOk: (b) => [[[b.borrower], "booking.completed"]],
  confirmIssue: () => [],
  closeFlagged: (b) => [[[b.borrower], "booking.completed"]],
};

export async function notifyBooking(sends, booking, resource, extra = {}) {
  if (!sends.length) return;
  const data = await notificationData(booking, resource, extra);
  for (const [recipients, event, audience] of sends) {
    await send(recipients, event, { ...data, audience });
  }
}

// check: an ok result of canTransition(); set/push: extra fields written with the status change.
// Throws 409 INVALID_TRANSITION if someone else changed the booking since it was read.
export async function applyTransition({
  booking,
  resource,
  check,
  actor,
  reason,
  set = {},
  push,
  requestId,
  notifyExtra,
}) {
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: check.from },
    { $set: { status: check.to, ...set }, ...(push && { $push: push }) },
    { returnDocument: "after" },
  ).lean();
  if (!updated) {
    throw new ServiceError(
      409,
      "INVALID_TRANSITION",
      "This booking was changed by someone else just now. Refresh and try again.",
    );
  }

  await record({
    actor: auditActor(actor, check.action, check.relations),
    action: check.audit,
    entity: { type: "booking", id: booking._id },
    orgUnit: booking.orgUnit,
    reason,
    changes: { status: [check.from, check.to] },
    requestId,
  });
  await notifyBooking(
    NOTIFY[check.action](updated, resource, check.relations),
    updated,
    resource,
    { reason, from: check.from, ...notifyExtra },
  );
  return updated;
}
