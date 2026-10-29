// In-app notifications (backend.md §8.2). Every event creates one Notification per recipient.
// Email for the events marked in §8.2 is added with the mailer (B-18).
//
// send() never throws: a lost notification is logged, but must not undo the booking change behind it.
// The reading half (the notification centre and the header bell) is at the end.
import { log } from "../lib/log.js";
import { notFound } from "../lib/serviceError.js";
import { Notification } from "../models/index.js";
import {
  assertValid,
  isId,
  readFlag,
  readPaging,
  requireUser,
} from "./params.js";

// data.audience picks the link: "member" pages vs "manager" (/manage) and "admin" (/admin) pages.
const linkFor = (data, links) =>
  links[data.audience ?? "member"] ?? links.member;
const bookingLink = (data) => `/bookings/${data.bookingId}`;
const withReason = (text, reason) =>
  reason ? `${text}: ${reason}` : `${text}.`;
const incidentLink = (data) =>
  linkFor(data, {
    member: `/incidents/${data.incidentId}`,
    manager: `/manage/incidents/${data.incidentId}`,
    admin: "/admin/incidents",
  });
export const OUTCOME_LABELS = {
  no_action: "No action",
  warning: "Warning",
  repair_required: "Repair required",
  strike: "Strike",
};

const TEMPLATES = {
  "booking.requested": (d) => ({
    title: "New booking request",
    body: `${d.borrowerName} requested ${d.resourceTitle} for ${d.when}.`,
    link: "/manage/requests",
  }),
  "booking.approved": (d) => ({
    title: "Booking approved",
    body: `Your booking for ${d.resourceTitle} on ${d.when} is confirmed.`,
    link: bookingLink(d),
  }),
  "booking.rejected": (d) => ({
    title: "Booking not approved",
    body: withReason(
      `Your request for ${d.resourceTitle} on ${d.when} wasn't approved`,
      d.reason,
    ),
    link: bookingLink(d),
  }),
  "booking.waitlisted": (d) => ({
    title: "You're on the waitlist",
    body:
      `${d.resourceTitle} on ${d.when} is held by an earlier request. You're #${d.position} in line.` +
      (d.reason ? ` Manager's note: ${d.reason}` : ""),
    link: bookingLink(d),
  }),
  "booking.promoted": (d) =>
    d.status === "approved"
      ? {
          title: "Slot confirmed",
          body: `A slot opened up: your booking for ${d.resourceTitle} on ${d.when} is confirmed.`,
          link: bookingLink(d),
        }
      : {
          title: "A slot opened up",
          body: `Your request for ${d.resourceTitle} on ${d.when} moved from the waitlist to review.`,
          link: bookingLink(d),
        },
  "booking.cancelled": (d) =>
    d.audience === "manager"
      ? {
          title: "Booking cancelled",
          body: `${d.borrowerName} cancelled ${d.resourceTitle} on ${d.when}.`,
          link: "/manage/requests",
        }
      : {
          title: "Booking cancelled",
          body: withReason(
            `Your booking for ${d.resourceTitle} on ${d.when} was cancelled`,
            d.reason,
          ),
          link: bookingLink(d),
        },
  "booking.checked_in": (d) => ({
    title: "Checked in",
    body: `${d.borrowerName} checked in ${d.resourceTitle} (${d.when}).`,
    link: "/manage/handovers",
  }),
  "booking.checked_out": (d) => ({
    title: "Confirm a return",
    body: `${d.borrowerName} returned ${d.resourceTitle}. Check it and confirm the return.`,
    link: `/manage/returns/${d.bookingId}`,
  }),
  "booking.completed": (d) => ({
    title: "Return confirmed",
    body: `The return of ${d.resourceTitle} was confirmed. Thank you!`,
    link: bookingLink(d),
  }),
  "booking.no_show": (d) =>
    d.audience === "manager"
      ? {
          title: "No-show",
          body: `${d.borrowerName} didn't check in for ${d.resourceTitle} on ${d.when}; the slot was released.`,
          link: "/manage/handovers",
        }
      : {
          title: "Marked as a no-show",
          body: `You didn't check in for ${d.resourceTitle} on ${d.when}, so the slot was released.`,
          link: bookingLink(d),
        },
  "booking.expired": (d) =>
    d.from === "pending"
      ? {
          title: "Request expired",
          body: `Your request for ${d.resourceTitle} on ${d.when} wasn't reviewed before the slot started, so it expired.`,
          link: bookingLink(d),
        }
      : {
          title: "Waitlist request expired",
          body: `The slot for ${d.resourceTitle} on ${d.when} started before a place opened up.`,
          link: bookingLink(d),
        },
  "booking.reminder_start": (d) => ({
    title: "Your booking starts soon",
    body: `${d.resourceTitle}, ${d.when}. You can check in from 15 minutes before the start.`,
    link: `/bookings/${d.bookingId}/check-in`,
  }),
  "booking.reminder_end": (d) => ({
    title: "Return due soon",
    body: `Your booking for ${d.resourceTitle} (${d.when}) ends soon. Please check out on time.`,
    link: `/bookings/${d.bookingId}/check-out`,
  }),
  "booking.overdue": (d) =>
    d.audience === "manager"
      ? {
          title: "Overdue return",
          body: `${d.borrowerName} hasn't returned ${d.resourceTitle} (${d.when}). A delay incident was opened.`,
          link: "/manage/handovers",
        }
      : {
          title: "Return overdue",
          body: `${d.resourceTitle} was due back at the end of ${d.when}. Please return it and check out now.`,
          link: `/bookings/${d.bookingId}/check-out`,
        },
  "badge.requested": (d) => ({
    title: "New badge request",
    body: `${d.userName} requested the ${d.badgeName} badge.`,
    link: "/manage/badges",
  }),
  "badge.granted": (d) => ({
    title: "Badge granted",
    body: d.expiresOn
      ? `You now hold ${d.badgeName}, valid until ${d.expiresOn}.`
      : `You now hold ${d.badgeName}.`,
    link: "/badges",
  }),
  "badge.rejected": (d) => ({
    title: "Badge request not approved",
    body: withReason(
      `Your request for the ${d.badgeName} badge wasn't approved`,
      d.reason,
    ),
    link: "/badges",
  }),
  // architecture.md §8: the member's ID-card decision; also emailed by verificationService.
  "verification.approved": () => ({
    title: "ID card verified",
    body: "Your ID card is verified. You can now book resources and request badges.",
    link: "/verification",
  }),
  "verification.rejected": (d) => ({
    title: "ID card not verified",
    body:
      "Your ID card wasn't verified. Upload a new one to try again." +
      (d.reason ? ` Reason: ${d.reason}` : ""),
    link: "/verification",
  }),
  "incident.created": (d) => ({
    title: "Incident reported",
    body: `A ${d.severity}-severity ${d.type} incident was reported for ${d.resourceTitle}.`,
    link: incidentLink(d),
  }),
  "incident.commented": (d) => ({
    title: "New comment on an incident",
    body: `${d.authorName} commented on the ${d.type} incident for ${d.resourceTitle}.`,
    link: incidentLink(d),
  }),
  "incident.resolved": (d) => ({
    title: "Incident resolved",
    body:
      `The ${d.type} incident for ${d.resourceTitle} was resolved. Outcome: ${OUTCOME_LABELS[d.outcome] ?? "recorded"}.` +
      (d.bookingClosed ? " The booking is now closed." : ""),
    link: incidentLink(d),
  }),
};

export const NOTIFICATION_EVENTS = Object.keys(TEMPLATES);

// Notification.body's maxlength. A reason may be 500 characters by itself (a booking or badge
// rejection, a cancellation, an ID card), so a body carrying one is cut to fit rather than refused
// by the model, which would lose the notification: send() only logs the failure.
const MAX_BODY = 500;

export function render(event, data) {
  const template = TEMPLATES[event];
  if (!template) throw new Error(`No notification template for "${event}"`);
  const notice = template(data);
  return notice.body?.length > MAX_BODY
    ? { ...notice, body: `${notice.body.slice(0, MAX_BODY - 1)}…` }
    : notice;
}

// → the created notifications ([] when nothing was sent)
export async function send(userIds, event, data = {}) {
  const recipients = [...new Set(userIds.filter(Boolean).map(String))];
  if (!recipients.length) return [];
  try {
    const { title, body, link } = render(event, data);
    return await Notification.insertMany(
      recipients.map((user) => ({ user, type: event, title, body, link })),
    );
  } catch (err) {
    log.warn(
      { err, event, recipients: recipients.length },
      "Notification not sent",
    );
    return [];
  }
}

// ── Reading ─────────────────────────────────────────────────────────────────
// Each user sees only their own. Reads aren't audited: nothing about the record changes.

const READ_FIELDS = { user: 0, __v: 0 };

// GET /notifications. query: { unread, page, limit } → { items, meta: { page, limit, total, unread } },
// newest first. unread=true (literally true) keeps only unread ones; meta.unread is the bell's count
// either way, so the centre can update the bell without a second request.
export async function listNotifications(userId, query = {}) {
  const user = await requireUser(userId);
  const problems = [];
  const unreadOnly = readFlag(query.unread, "unread", problems);
  const { page, limit } = readPaging(query, problems);
  assertValid(problems);

  const mine = { user: user._id };
  const unreadFilter = { ...mine, readAt: null };
  const filter = unreadOnly ? unreadFilter : mine;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter, READ_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
    unreadOnly ? null : Notification.countDocuments(unreadFilter),
  ]);
  return { items, meta: { page, limit, total, unread: unread ?? total } };
}

// GET /notifications/unread-count → { count }. Every open tab polls it every 30 s (frontend.md
// F-16), so it is one indexed count with no user lookup: an id with no user simply has none.
export async function unreadCount(userId) {
  if (!isId(userId)) throw notFound("User");
  return {
    count: await Notification.countDocuments({ user: userId, readAt: null }),
  };
}

// PATCH /notifications/:id/read → the notification. Someone else's is 404, the same as one that
// doesn't exist. Marking a read one again keeps its first readAt.
export async function markRead(
  userId,
  notificationId,
  { now = new Date() } = {},
) {
  const user = await requireUser(userId);
  if (!isId(notificationId)) throw notFound("Notification");
  const mine = { _id: notificationId, user: user._id };
  await Notification.updateOne(
    { ...mine, readAt: null },
    { $set: { readAt: now } },
  );
  const notification = await Notification.findOne(mine, READ_FIELDS).lean();
  if (!notification) throw notFound("Notification");
  return notification;
}

// PATCH /notifications/read-all → { updated }: how many were unread.
export async function markAllRead(userId, { now = new Date() } = {}) {
  const user = await requireUser(userId);
  const { modifiedCount } = await Notification.updateMany(
    { user: user._id, readAt: null },
    { $set: { readAt: now } },
  );
  return { updated: modifiedCount };
}
