// memberContext against a real MongoDB; see fixtures.js for how to run it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateMember } from "../../src/engines/eligibility.js";
import { Booking, UserBadge } from "../../src/models/index.js";
import {
  eligibilityContext,
  loadResource,
  loadUser,
  memberContext,
} from "../../src/services/bookingContext.js";
import { NOW, TUE, ist, skip, useTestDatabase } from "./fixtures.js";

let f; // fixtures, rebuilt for every test

// Written directly, so any status can be set up without walking the state machine.
const booking = (who, resource, start, end, status) =>
  Booking.create({
    resource: resource._id,
    orgUnit: resource.orgUnit,
    borrower: who._id,
    start: ist(start),
    end: ist(end),
    purpose: "Printing parts for the robotics club",
    status,
  });

const contextFor = async (who, resource, now = NOW) =>
  memberContext(await loadUser(who._id), await loadResource(resource._id), {
    now,
  });

describe("memberContext", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  test("a member with nothing booked holds no hours and no active bookings", async () => {
    const ctx = await contextFor(f.student, f.printer);
    assert.equal(ctx.now, NOW);
    assert.equal(ctx.hoursThisWeek, 0);
    assert.equal(ctx.activeCount, 0);
    assert.deepEqual(
      ctx.userBadges.map((ub) => [String(ub.badge), ub.status]),
      [[String(f.badge._id), "active"]],
    );
    assert.deepEqual(Object.keys(ctx).sort(), [
      "activeCount",
      "hoursThisWeek",
      "now",
      "userBadges",
    ]);
  });

  test("counts this IST week's held hours and the active bookings, on this resource only", async () => {
    const { student, student2, printer, kits } = f;
    await Promise.all([
      // This week (Mon 2 – Sun 8 Nov). Held: 2 + 0.5 + 1 + 0.5 hours.
      booking(
        student,
        printer,
        "2026-11-03T10:00",
        "2026-11-03T12:00",
        "pending",
      ),
      booking(
        student,
        printer,
        "2026-11-02T09:00",
        "2026-11-02T09:30",
        "completed",
      ),
      booking(
        student,
        printer,
        "2026-11-06T10:00",
        "2026-11-06T11:00",
        "flagged",
      ),
      booking(
        student,
        printer,
        "2026-11-08T23:00",
        "2026-11-08T23:30",
        "approved",
      ),
      // This week, but not held.
      booking(
        student,
        printer,
        "2026-11-04T10:00",
        "2026-11-04T11:00",
        "cancelled",
      ),
      booking(
        student,
        printer,
        "2026-11-04T13:00",
        "2026-11-04T14:00",
        "waitlisted",
      ),
      booking(
        student,
        printer,
        "2026-11-05T10:00",
        "2026-11-05T11:00",
        "no_show",
      ),
      // Other weeks: Monday 00:00 IST starts the next one. Active still counts.
      booking(
        student,
        printer,
        "2026-11-09T00:00",
        "2026-11-09T01:00",
        "approved",
      ),
      booking(
        student,
        printer,
        "2026-11-01T16:00",
        "2026-11-01T17:00",
        "completed",
      ),
      // Another resource, and another member.
      booking(
        student,
        kits,
        "2026-11-03T10:00",
        "2026-11-03T12:00",
        "approved",
      ),
      booking(
        student2,
        printer,
        "2026-11-03T13:00",
        "2026-11-03T15:00",
        "pending",
      ),
    ]);

    const ctx = await contextFor(student, printer);
    assert.equal(ctx.hoursThisWeek, 4);
    // pending (Tue), approved (Sun night) and approved (next Monday).
    assert.equal(ctx.activeCount, 3);
  });

  test("the week is the one containing now, since there's no slot", async () => {
    await Promise.all([
      booking(
        f.student,
        f.printer,
        "2026-11-03T10:00",
        "2026-11-03T12:00",
        "completed",
      ),
      booking(
        f.student,
        f.printer,
        "2026-11-10T10:00",
        "2026-11-10T13:00",
        "approved",
      ),
    ]);
    assert.equal((await contextFor(f.student, f.printer)).hoursThisWeek, 2);
    assert.equal(
      (await contextFor(f.student, f.printer, ist("2026-11-09T08:00")))
        .hoursThisWeek,
      3,
    );
  });

  test("counts the same way as eligibilityContext for a slot in the same week", async () => {
    await Promise.all([
      booking(
        f.student,
        f.printer,
        "2026-11-02T13:00",
        "2026-11-02T14:30",
        "approved",
      ),
      booking(
        f.student,
        f.printer,
        "2026-11-12T10:00",
        "2026-11-12T11:00",
        "pending",
      ),
    ]);
    const [user, resource] = await Promise.all([
      loadUser(f.student._id),
      loadResource(f.printer._id),
    ]);
    const member = await memberContext(user, resource, { now: NOW });
    const slot = await eligibilityContext(user, resource, TUE, { now: NOW });
    assert.equal(member.hoursThisWeek, 1.5);
    assert.equal(member.activeCount, 2);
    assert.equal(member.hoursThisWeek, slot.hoursThisWeek);
    assert.equal(member.activeCount, slot.activeCount);
    assert.deepEqual(member.userBadges, slot.userBadges);
  });

  test("feeds evaluateMember: active-booking limit and badges", async () => {
    const [user, printer] = await Promise.all([
      loadUser(f.student._id),
      loadResource(f.printer._id),
    ]);
    const fresh = evaluateMember(
      user,
      printer,
      await memberContext(user, printer, { now: NOW }),
    );
    assert.equal(fresh.eligible, true);
    assert.equal(fresh.results.length, 7);

    await booking(
      f.student,
      f.printer,
      "2026-11-03T10:00",
      "2026-11-03T12:00",
      "approved",
    );
    await UserBadge.deleteMany({ user: f.student._id });
    const { eligible, results } = evaluateMember(
      user,
      printer,
      await memberContext(user, printer, { now: NOW }),
    );
    assert.equal(eligible, false);
    assert.deepEqual(
      results.filter((r) => !r.passed).map((r) => [r.rule, r.message]),
      [
        ["BADGES", "Missing badge: 3D Printing Basics."],
        [
          "ACTIVE_BOOKINGS",
          "You already have 1 active booking for this resource.",
        ],
      ],
    );
  });

  test("now defaults to the current time", async () => {
    const before = Date.now();
    const ctx = await memberContext(
      await loadUser(f.student._id),
      await loadResource(f.printer._id),
    );
    assert.ok(ctx.now instanceof Date);
    assert.ok(ctx.now.getTime() >= before && ctx.now.getTime() <= Date.now());
  });
});
