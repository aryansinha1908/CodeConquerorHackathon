import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { maxConcurrent } from "../../src/services/bookingContext.js";
import {
  describeEntry,
  describeReport,
  groupConflicts,
} from "../../src/services/bookingViews.js";
import {
  NOTIFICATION_EVENTS,
  render,
} from "../../src/services/notifyService.js";
import { formatIstRange } from "../../src/lib/time.js";

const ist = (s) => new Date(`${s}:00+05:30`);
const booking = (id, status, start, end, createdAt, resource = "printer") => ({
  _id: id,
  resource,
  status,
  start: ist(`2026-11-03T${start}`),
  end: ist(`2026-11-03T${end}`),
  createdAt: ist(`2026-11-01T${createdAt}`),
});

describe("maxConcurrent", () => {
  const window = [ist("2026-11-03T09:00"), ist("2026-11-03T17:00")];
  const at = (start, end) => ({
    start: ist(`2026-11-03T${start}`),
    end: ist(`2026-11-03T${end}`),
  });

  test("counts the busiest moment, not the number of overlaps", () => {
    // Three short bookings inside a long request, never more than one at a time.
    assert.equal(
      maxConcurrent(
        [at("09:00", "10:00"), at("11:00", "12:00"), at("13:00", "14:00")],
        ...window,
      ),
      1,
    );
    assert.equal(
      maxConcurrent(
        [at("09:00", "12:00"), at("10:00", "11:00"), at("10:30", "13:00")],
        ...window,
      ),
      3,
    );
  });

  test("back-to-back bookings don't overlap", () => {
    assert.equal(
      maxConcurrent([at("09:00", "10:00"), at("10:00", "11:00")], ...window),
      1,
    );
  });

  test("only the part inside the window counts", () => {
    assert.equal(
      maxConcurrent([at("08:00", "09:00"), at("17:00", "18:00")], ...window),
      0,
    );
    assert.equal(maxConcurrent([], ...window), 0);
  });
});

describe("groupConflicts", () => {
  test("chains overlapping requests per resource, oldest first, with waitlist positions", () => {
    const groups = groupConflicts([
      booking("a", "pending", "10:00", "12:00", "09:00"),
      booking("b", "waitlisted", "11:00", "13:00", "09:05"),
      booking("c", "waitlisted", "12:30", "14:00", "09:10"), // overlaps b only: still the same group
      booking("d", "waitlisted", "10:00", "11:00", "09:20"),
      booking("e", "pending", "15:00", "16:00", "08:00"), // separate slot
      booking("f", "pending", "10:00", "12:00", "09:30", "laser"), // other resource
    ]);
    assert.deepEqual(
      groups.map((g) => g.bookings.map((b) => b._id)),
      [["e"], ["a", "b", "c", "d"], ["f"]],
    );
    const positions = Object.fromEntries(
      groups[1].bookings.map((b) => [b._id, b.waitlistPosition]),
    );
    // d (10–11) only touches b (11–13) end to end, so no earlier waitlisted request competes with it.
    assert.deepEqual(positions, { a: undefined, b: 1, c: 2, d: 1 });
    assert.equal(groups[1].start.getTime(), ist("2026-11-03T10:00").getTime());
    assert.equal(groups[1].end.getTime(), ist("2026-11-03T14:00").getTime());
  });

  test("drops groups that have nothing pending to decide", () => {
    assert.deepEqual(
      groupConflicts([booking("x", "waitlisted", "10:00", "11:00", "09:00")]),
      [],
    );
  });
});

describe("timeline text", () => {
  const entry = (action, role, extra = {}) => ({
    action,
    actor: { role },
    ...extra,
  });

  test("names the actor the way backend.md §8.1 shows", () => {
    assert.equal(
      describeEntry(
        entry("booking.approved", "manager", {
          reason: "Slot fine, bring your own filament",
        }),
        {
          unitCode: "dic",
        },
      ),
      'Manager (DIC) approved: "Slot fine, bring your own filament"',
    );
    assert.equal(
      describeEntry(entry("booking.no_show", "system")),
      "System marked a no-show",
    );
    assert.equal(
      describeEntry(entry("booking.checked_in", "member"), {
        actorName: "Ananya Rao",
      }),
      "Ananya Rao checked in",
    );
    assert.equal(
      describeEntry(
        entry("booking.cancelled", "admin", { reason: "Lab closed" }),
      ),
      'Admin cancelled: "Lab closed"',
    );
  });

  test("words depend on the status change", () => {
    const requested = (to) =>
      entry("booking.requested", "member", { changes: { status: [null, to] } });
    assert.equal(
      describeEntry(requested("pending"), { actorName: "A" }),
      "A requested this booking",
    );
    assert.equal(
      describeEntry(requested("waitlisted"), { actorName: "A" }),
      "A requested this slot and joined the waitlist",
    );
    assert.equal(
      describeEntry(requested("approved"), { actorName: "A" }),
      "A booked this slot (auto-approved)",
    );
    const closed = entry("booking.completed", "system", {
      changes: { status: ["flagged", "completed"] },
    });
    assert.equal(
      describeEntry(closed),
      "System closed the booking after the incident was resolved",
    );
  });

  test("condition reports summarise flagged items and photos", () => {
    const photo = { url: "u", publicId: "p" };
    assert.equal(
      describeReport({
        phase: "check_out",
        overall: "minor_issue",
        items: [{ ok: true }, { ok: false }],
        photos: [photo, photo],
      }),
      "Check-out report: minor issue, 1 item flagged, 2 photos",
    );
    assert.equal(
      describeReport({
        phase: "check_in",
        overall: "good",
        items: [],
        photos: [],
      }),
      "Check-in report: good condition",
    );
  });
});

describe("notification templates", () => {
  const data = {
    bookingId: "b1",
    incidentId: "i1",
    resourceTitle: "Prusa MK4 3D Printer",
    when: "3 Nov, 10:00–12:00",
    borrowerName: "Ananya Rao",
    reason: "Printer reserved for the M.Des jury",
    position: 2,
    type: "damage",
    severity: "high",
    status: "pending",
    userName: "Ananya Rao",
    badgeName: "3D Printing Basics",
  };

  test("every event renders a title, a body and an in-app link for each audience", () => {
    for (const event of NOTIFICATION_EVENTS) {
      for (const audience of ["member", "manager", "admin"]) {
        const { title, body, link } = render(event, { ...data, audience });
        assert.ok(title && title.length <= 120, `${event} title`);
        assert.ok(
          body && !body.includes("undefined"),
          `${event} body: ${body}`,
        );
        assert.match(link, /^\/(?!\/)/, `${event} link`);
      }
    }
  });

  test("texts carry the reason, the position and the right link", () => {
    assert.equal(
      render("booking.rejected", data).body,
      "Your request for Prusa MK4 3D Printer on 3 Nov, 10:00–12:00 wasn't approved: Printer reserved for the M.Des jury",
    );
    assert.match(
      render("booking.waitlisted", { ...data, reason: undefined }).body,
      /You're #2 in line\.$/,
    );
    assert.equal(
      render("booking.cancelled", { ...data, audience: "manager" }).body,
      "Ananya Rao cancelled Prusa MK4 3D Printer on 3 Nov, 10:00–12:00.",
    );
    assert.equal(
      render("booking.checked_out", data).link,
      "/manage/returns/b1",
    );
    assert.equal(
      render("incident.created", { ...data, audience: "manager" }).link,
      "/manage/incidents/i1",
    );
    assert.match(
      render("booking.promoted", { ...data, status: "approved" }).body,
      /is confirmed/,
    );
  });

  test("an unknown event is an error, not a blank notification", () => {
    assert.throws(
      () => render("booking.teleported", data),
      /No notification template/,
    );
  });
});

describe("formatIstRange", () => {
  test("same day and multi-day", () => {
    assert.equal(
      formatIstRange(ist("2026-11-03T10:00"), ist("2026-11-03T12:00")),
      "3 Nov, 10:00–12:00",
    );
    assert.equal(
      formatIstRange(ist("2026-11-03T16:00"), ist("2026-11-05T10:00")),
      "3 Nov, 16:00 – 5 Nov, 10:00",
    );
  });
});
