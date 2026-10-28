// In-app notifications (backend.md §8.2). Every event creates one Notification per recipient.
// Email for the events marked in §8.2 is added with the mailer (B-18).
//
// send() never throws: a lost notification is logged, but must not undo the booking change behind it.
import { log } from "../lib/log.js";
import { Notification } from "../models/index.js";

// data.audience picks the link: "member" pages vs "manager" (/manage) and "admin" (/admin) pages.
const linkFor = (data, links) =>
  links[data.audience ?? "member"] ?? links.member;
const bookingLink = (data) => `/bookings/${data.bookingId}`;
const withReason = (text, reason) =>
  reason ? `${text}: ${reason}` : `${text}.`;

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
  "booking.expired": (d) => ({
    title: "Waitlist request expired",
    body: `The slot for ${d.resourceTitle} on ${d.when} started before a place opened up.`,
    link: bookingLink(d),
  }),
  "incident.created": (d) => ({
    title: "Incident reported",
    body: `A ${d.severity}-severity ${d.type} incident was reported for ${d.resourceTitle}.`,
    link: linkFor(d, {
      member: `/incidents/${d.incidentId}`,
      manager: `/manage/incidents/${d.incidentId}`,
      admin: "/admin/incidents",
    }),
  }),
};

export const NOTIFICATION_EVENTS = Object.keys(TEMPLATES);

export function render(event, data) {
  const template = TEMPLATES[event];
  if (!template) throw new Error(`No notification template for "${event}"`);
  return template(data);
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
