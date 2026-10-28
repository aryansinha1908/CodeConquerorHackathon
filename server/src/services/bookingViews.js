// Pure helpers that shape bookings for the UI: the manager's conflict groups and the timeline text.

const idOf = (x) => String(x?._id ?? x);
const time = (d) => new Date(d).getTime();
const overlaps = (a, b) =>
  time(a.start) < time(b.end) && time(b.start) < time(a.end);

// Requests competing for the same units: same resource and overlapping time (chained, so A–B and
// B–C put A, B and C in one group). Only groups with a pending request are kept, oldest request
// first, so a manager sees who is waiting behind the request they are about to decide.
export function groupConflicts(bookings) {
  const byResource = new Map();
  for (const b of bookings) {
    const key = idOf(b.resource);
    byResource.set(key, [...(byResource.get(key) ?? []), b]);
  }

  const groups = [];
  for (const list of byResource.values()) {
    let current = null;
    for (const b of [...list].sort((x, y) => time(x.start) - time(y.start))) {
      if (current && time(b.start) < time(current.end)) {
        current.bookings.push(b);
        if (time(b.end) > time(current.end)) current.end = b.end;
      } else {
        current = {
          resource: b.resource,
          start: b.start,
          end: b.end,
          bookings: [b],
        };
        groups.push(current);
      }
    }
  }

  const oldestPending = (g) =>
    Math.min(
      ...g.bookings
        .filter((b) => b.status === "pending")
        .map((b) => time(b.createdAt)),
    );

  return groups
    .filter((g) => g.bookings.some((b) => b.status === "pending"))
    .map((g) => {
      const fifo = [...g.bookings].sort(
        (x, y) => time(x.createdAt) - time(y.createdAt),
      );
      const waitlisted = fifo.filter((b) => b.status === "waitlisted");
      // Same rule as waitlistPosition(): earlier waitlisted requests for an overlapping slot, plus one.
      const position = (b) =>
        1 +
        waitlisted.filter(
          (w) =>
            w !== b && time(w.createdAt) < time(b.createdAt) && overlaps(w, b),
        ).length;
      return {
        ...g,
        bookings: fifo.map((b) =>
          b.status === "waitlisted"
            ? { ...b, waitlistPosition: position(b) }
            : b,
        ),
      };
    })
    .sort((a, b) => oldestPending(a) - oldestPending(b));
}

const statusTo = (entry) => entry.changes?.status?.[1];
const statusFrom = (entry) => entry.changes?.status?.[0];

const VERBS = {
  "booking.requested": (e) =>
    ({
      waitlisted: "requested this slot and joined the waitlist",
      approved: "booked this slot (auto-approved)",
    })[statusTo(e)] ?? "requested this booking",
  "booking.approved": () => "approved",
  "booking.rejected": () => "rejected",
  "booking.waitlisted": () => "moved this request to the waitlist",
  "booking.cancelled": () => "cancelled",
  "booking.promoted": (e) =>
    statusTo(e) === "approved"
      ? "promoted this request from the waitlist and confirmed it"
      : "promoted this request from the waitlist",
  "booking.expired": () => "expired the waitlisted request",
  "booking.checked_in": () => "checked in",
  "booking.no_show": () => "marked a no-show",
  "booking.checked_out": () => "checked out",
  "booking.completed": (e) =>
    statusFrom(e) === "flagged"
      ? "closed the booking after the incident was resolved"
      : "confirmed the return",
  "booking.flagged": () => "reported an issue on return",
  "booking.overdue": () => "flagged the return as overdue",
};

// 'Manager (DIC) rejected: "Printer reserved for the M.Des jury"' (backend.md §8.1)
export function describeEntry(entry, { actorName, unitCode } = {}) {
  const { role } = entry.actor;
  const who =
    role === "system"
      ? "System"
      : role === "manager"
        ? `Manager${unitCode ? ` (${unitCode.toUpperCase()})` : ""}`
        : role === "admin"
          ? "Admin"
          : (actorName ?? "Member");
  const verb = VERBS[entry.action]?.(entry) ?? entry.action;
  return entry.reason ? `${who} ${verb}: "${entry.reason}"` : `${who} ${verb}`;
}

const PHASES = {
  check_in: "Check-in",
  check_out: "Check-out",
  return_confirmation: "Return",
};
const CONDITION = {
  good: "good condition",
  minor_issue: "minor issue",
  damaged: "damaged",
};

// "Check-out report: minor issue, 1 item flagged, 2 photos"
export function describeReport(report) {
  const flagged = (report.items ?? []).filter((item) => !item.ok).length;
  const photos = (report.photos ?? []).length;
  const parts = [CONDITION[report.overall] ?? report.overall];
  if (flagged) parts.push(`${flagged} item${flagged === 1 ? "" : "s"} flagged`);
  if (photos) parts.push(`${photos} photo${photos === 1 ? "" : "s"}`);
  return `${PHASES[report.phase]} report: ${parts.join(", ")}`;
}
