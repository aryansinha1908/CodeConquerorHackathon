// The cron sweeper against a real MongoDB; see fixtures.js for how to run it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { useRedisClient } from "../../src/config/redis.js";
import { runSweep } from "../../src/jobs/sweeper.js";
import { tryLock } from "../../src/lib/lock.js";
import { keys } from "../../src/lib/redisKeys.js";
import { AuditLog, Booking, Incident } from "../../src/models/index.js";
import {
  checkIn,
  getBooking,
  getTimeline,
  transition,
} from "../../src/services/bookingService.js";
import {
  NOW,
  TUE,
  TUE_LATER,
  bookAs,
  checklistOk,
  ist,
  notificationsFor,
  skip,
  useTestDatabase,
  warnings,
} from "./fixtures.js";

let f;
const at = (hhmm) => ist(`2026-11-03T${hhmm}`); // Tuesday, the day of the booking
const sweepAt = (hhmm) => runSweep({ now: at(hhmm) });

const pending = async (who = f.student, slot = TUE) =>
  (await bookAs(who, f.printer, slot)).booking;
const waitlisted = async (who, slot) =>
  (await bookAs(who, f.printer, slot, { joinWaitlist: true })).booking;
const approved = async () =>
  transition((await pending())._id, "approve", f.manager._id, {}, { now: NOW });
const checkedIn = async () => {
  const booking = await approved();
  return checkIn(booking._id, f.student._id, checklistOk(f.printer), {
    now: at("09:55"),
  });
};
const statusOf = async (booking) =>
  (await Booking.findById(booking._id).lean()).status;
const eventsFor = async (user, type) =>
  (await notificationsFor(user)).filter((n) => n.type === type);

const unreachable = () => {
  const fail = async () => {
    throw new Error(
      "Stream isn't writeable and enableOfflineQueue options is false",
    );
  };
  return {
    defineCommand(name) {
      this[name] = fail;
    },
    set: fail,
    get: fail,
    del: fail,
  };
};

describe("sweeper", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  test("start reminder: once, within the hour before the start", async () => {
    const booking = await approved();
    assert.equal(
      (await sweepAt("08:30")).counts.startReminders,
      0,
      "90 minutes early",
    );
    assert.equal((await sweepAt("09:15")).counts.startReminders, 1);
    assert.equal(
      (await sweepAt("09:20")).counts.startReminders,
      0,
      "already sent",
    );

    const [reminder, ...rest] = await eventsFor(
      f.student,
      "booking.reminder_start",
    );
    assert.equal(rest.length, 0);
    assert.equal(reminder.link, `/bookings/${booking._id}/check-in`);
    assert.ok(
      (await Booking.findById(booking._id).lean()).flags.startReminderAt,
    );
  });

  test("end reminder: once, in the last 15 minutes", async () => {
    await checkedIn();
    assert.equal((await sweepAt("11:40")).counts.endReminders, 0);
    assert.equal((await sweepAt("11:50")).counts.endReminders, 1);
    assert.equal((await sweepAt("11:55")).counts.endReminders, 0);
    assert.equal(
      (await eventsFor(f.student, "booking.reminder_end")).length,
      1,
    );
  });

  test("no-show after 15 minutes frees the slot for the waitlist", async () => {
    const booking = await approved();
    const later = await waitlisted(f.student2, TUE_LATER);

    assert.equal(
      (await sweepAt("10:10")).counts.noShows,
      0,
      "still in the grace period",
    );
    assert.equal((await sweepAt("10:16")).counts.noShows, 1);
    assert.equal(await statusOf(booking), "no_show");
    assert.equal(
      await statusOf(later),
      "pending",
      "promoted into the freed slot",
    );

    const entry = await AuditLog.findOne({ action: "booking.no_show" }).lean();
    assert.equal(entry.actor.role, "system");
    assert.equal((await eventsFor(f.manager, "booking.no_show")).length, 1);
  });

  test("overdue: flag, audit, a delay incident and notifications, all exactly once", async () => {
    const booking = await checkedIn();
    assert.equal(
      (await sweepAt("12:10")).counts.overdueReturns,
      0,
      "still in the grace period",
    );
    assert.equal((await sweepAt("12:16")).counts.overdueReturns, 1);
    assert.equal((await sweepAt("12:30")).counts.overdueReturns, 0);

    const flagged = await Booking.findById(booking._id).lean();
    assert.equal(
      flagged.status,
      "checked_in",
      "overdue is a flag, not a status",
    );
    assert.equal(flagged.flags.overdue, true);
    const incidents = await Incident.find({ booking: booking._id }).lean();
    assert.equal(incidents.length, 1);
    assert.deepEqual(
      [
        incidents[0].source,
        incidents[0].type,
        incidents[0].severity,
        incidents[0].reportedBy,
      ],
      ["system", "delay", "low", null],
    );
    assert.match(
      incidents[0].description,
      /ended at 3 Nov, 12:00 and the item hadn't been returned by 3 Nov, 12:16/,
    );
    assert.deepEqual(flagged.incidents.map(String), [String(incidents[0]._id)]);
    assert.deepEqual(
      (
        await AuditLog.find({ "actor.role": "system" }).sort({ at: 1 }).lean()
      ).map((e) => e.action),
      ["booking.overdue", "incident.created"],
    );
    assert.equal((await eventsFor(f.student, "booking.overdue")).length, 1);
    const [managerNote] = await eventsFor(f.manager, "booking.overdue");
    assert.match(
      managerNote.body,
      /Ananya Rao hasn't returned Prusa MK4 3D Printer/,
    );

    const detail = await getBooking(booking._id, f.student._id, {
      now: at("12:16"),
    });
    assert.equal(detail.isOverdue, true);
    const timeline = await getTimeline(booking._id, f.manager._id);
    assert.ok(
      timeline.some(
        (item) => item.text === "System flagged the return as overdue",
      ),
    );
  });

  test("requests whose slot has started expire, whether waitlisted or never decided", async () => {
    const undecided = await pending();
    const waiting = await waitlisted(f.student2, TUE);
    const later = await waitlisted(f.student3, TUE_LATER);

    assert.equal((await sweepAt("10:01")).counts.expiredRequests, 2);
    assert.equal(await statusOf(undecided), "expired");
    assert.equal(await statusOf(waiting), "expired");
    assert.equal(
      await statusOf(later),
      "pending",
      "the expired request held the slot, so 11:00 moves up",
    );

    const [mine] = await eventsFor(f.student, "booking.expired");
    assert.match(mine.body, /wasn't reviewed before the slot started/);
    const [theirs] = await eventsFor(f.student2, "booking.expired");
    assert.match(theirs.body, /started before a place opened up/);

    // The expired request no longer blocks the student's next booking (limit: 1 active).
    const next = await bookAs(
      f.student,
      f.printer,
      { start: ist("2026-11-05T10:00"), end: ist("2026-11-05T11:00") },
      {},
      at("10:05"),
    );
    assert.equal(next.booking.status, "pending");
  });

  test("skips while another instance holds the sweep lock", async () => {
    const booking = await approved();
    const release = await tryLock(keys.sweepLock, 60_000);
    assert.deepEqual(await sweepAt("10:16"), { skipped: true });
    assert.equal(await statusOf(booking), "approved");
    await release();
    assert.equal((await sweepAt("10:16")).counts.noShows, 1);
  });

  test("with Redis down it still sweeps, and two sweeps at once act only once", async () => {
    const booking = await checkedIn();
    useRedisClient(unreachable());
    const [a, b] = await Promise.all([sweepAt("12:16"), sweepAt("12:16")]);
    assert.equal(a.counts.overdueReturns + b.counts.overdueReturns, 1);
    assert.equal(await Incident.countDocuments({ booking: booking._id }), 1);
    assert.equal((await eventsFor(f.student, "booking.overdue")).length, 1);
    assert.ok(
      warnings.some(
        ([, message]) =>
          message === "Sweep lock unavailable; sweeping without it",
      ),
    );
  });

  test("two sweeps at once send a reminder only once", async () => {
    await approved();
    useRedisClient(unreachable());
    await Promise.all([sweepAt("09:15"), sweepAt("09:15")]);
    assert.equal(
      (await eventsFor(f.student, "booking.reminder_start")).length,
      1,
    );
  });
});
