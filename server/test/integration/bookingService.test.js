// Booking service against a real MongoDB. Skipped unless TEST_MONGODB_URI is set, e.g.
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 node --test test/integration
// Each run creates its own database (campuscommons_test_<random>) and drops it at the end.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import RedisMock from "ioredis-mock";
import { useRedisClient } from "../../src/config/redis.js";
import { setLogger } from "../../src/lib/log.js";
import {
  AuditLog,
  Badge,
  Booking,
  ConditionReport,
  Incident,
  Notification,
  OrgUnit,
  Resource,
  User,
  UserBadge,
} from "../../src/models/index.js";
import {
  SYSTEM,
  checkBooking,
  checkIn,
  checkOut,
  confirmReturn,
  createBooking,
  getBooking,
  getTimeline,
  listForManager,
  listMine,
  transition,
} from "../../src/services/bookingService.js";

const uri = process.env.TEST_MONGODB_URI;
const skip = uri
  ? false
  : "set TEST_MONGODB_URI to run (a throwaway database is created and dropped)";

const warnings = [];
setLogger({ info() {}, warn: (...args) => warnings.push(args), error() {} });

const redis = new RedisMock();
const ist = (s) => new Date(`${s}:00+05:30`);
const plus = (date, minutes) => new Date(date.getTime() + minutes * 60_000);
const NOW = ist("2026-11-02T10:00"); // Monday
const TUE = { start: ist("2026-11-03T10:00"), end: ist("2026-11-03T12:00") };
const TUE_LATER = {
  start: ist("2026-11-03T11:00"),
  end: ist("2026-11-03T13:00"),
};
const opts = { now: NOW };
const failure = (promise) =>
  promise.then(
    () => assert.fail("expected the service to refuse"),
    (err) => err,
  );

let f; // fixtures, rebuilt for every test

async function seed() {
  const [dic, cse] = await OrgUnit.create([
    { name: "Design and Innovation Centre", code: "dic", type: "centre" },
    {
      name: "Computer Science and Engineering",
      code: "cse",
      type: "department",
    },
  ]);
  const person = (name, email, extra = {}) => ({
    name,
    email: `${email}@demo.campuscommons.test`,
    passwordHash: "x".repeat(60),
    memberType: "ug",
    department: cse._id,
    verification: { status: "approved" },
    ...extra,
  });
  const [student, student2, student3, manager, cseManager, admin] =
    await User.create([
      person("Ananya Rao", "student"),
      person("Kabir Singh", "student2"),
      person("Ishaan Das", "student3"),
      person("Meera Iyer", "manager", {
        memberType: "faculty",
        roles: ["member", "manager"],
        managedOrgUnits: [dic._id],
      }),
      person("Ravi Kumar", "cse-manager", {
        memberType: "faculty",
        roles: ["member", "manager"],
        managedOrgUnits: [cse._id],
      }),
      person("Campus Admin", "admin", {
        memberType: "staff",
        roles: ["admin"],
      }),
    ]);
  await OrgUnit.updateOne({ _id: dic._id }, { managers: [manager._id] });
  await OrgUnit.updateOne({ _id: cse._id }, { managers: [cseManager._id] });

  const badge = await Badge.create({
    name: "3D Printing Basics",
    code: "3d-printing-basics",
    orgUnit: dic._id,
  });
  await UserBadge.create(
    [student, student2, student3].map((u) => ({
      user: u._id,
      badge: badge._id,
      status: "active",
    })),
  );

  const weekly = [1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    open: "09:00",
    close: "17:00",
  }));
  const printer = await Resource.create({
    orgUnit: dic._id,
    title: "Prusa MK4 3D Printer",
    category: "equipment",
    availability: { weekly },
    eligibility: {
      memberTypes: ["ug", "pg", "rs", "faculty"],
      badges: [badge._id],
    },
    limits: {
      minDurationMins: 30,
      maxDurationMins: 240,
      maxHoursPerWeek: 6,
      maxActiveBookings: 1,
      leadTimeMins: 120,
      maxAdvanceDays: 14,
    },
    checklist: ["Nozzle clean", "Build plate undamaged"],
  });
  const kits = await Resource.create({
    orgUnit: dic._id,
    title: "Arduino IoT Kit",
    category: "equipment",
    quantity: 2,
    availability: { weekly },
    eligibility: { approvalMode: "auto" },
    limits: { maxHoursPerWeek: 3, maxActiveBookings: 5 },
    checklist: ["All sensors present"],
  });
  return {
    dic,
    cse,
    student,
    student2,
    student3,
    manager,
    cseManager,
    admin,
    badge,
    printer,
    kits,
  };
}

const book = (who, slot = TUE, extra = {}, resource = f.printer) =>
  createBooking(
    who._id,
    {
      resourceId: resource._id,
      ...slot,
      purpose: "Printing parts for the robotics club",
      ...extra,
    },
    opts,
  );
const checklistOk = (resource = f.printer) => ({
  items: resource.checklist.map((label) => ({ label, ok: true })),
  photos: [],
  overall: "good",
});
const notificationsFor = (user) =>
  Notification.find({ user: user._id }).sort({ createdAt: 1 }).lean();

describe("bookingService", { skip }, () => {
  before(async () => {
    await mongoose.connect(uri, {
      dbName: `campuscommons_test_${randomUUID().slice(0, 8)}`,
    });
    await Promise.all(
      mongoose.modelNames().map((name) => mongoose.model(name).syncIndexes()),
    );
  });

  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    // Raw driver calls: the AuditLog model refuses deletes by design.
    for (const collection of await mongoose.connection.db.collections())
      await collection.deleteMany({});
    useRedisClient(redis);
    await redis.flushall();
    warnings.length = 0;
    f = await seed();
  });

  describe("check and create", () => {
    test("check runs all 12 rules and creates nothing", async () => {
      const result = await checkBooking(
        f.student._id,
        { resourceId: f.printer._id, ...TUE },
        opts,
      );
      assert.equal(result.outcome, "pending");
      assert.equal(result.results.length, 12);
      assert.equal(await Booking.countDocuments(), 0);
    });

    test("a request is pending, snapshotted, audited and sent to the unit's managers", async () => {
      const { booking } = await book(f.student);
      assert.equal(booking.status, "pending");
      assert.equal(String(booking.orgUnit), String(f.dic._id));
      assert.equal(booking.eligibilitySnapshot.length, 12);

      const [entry] = await AuditLog.find({ "entity.id": booking._id }).lean();
      assert.equal(entry.action, "booking.requested");
      assert.deepEqual(entry.actor.role, "member");
      assert.deepEqual(entry.changes.status, [null, "pending"]);

      const [note] = await notificationsFor(f.manager);
      assert.equal(note.type, "booking.requested");
      assert.equal(
        note.body,
        "Ananya Rao requested Prusa MK4 3D Printer for 3 Nov, 10:00–12:00.",
      );
      assert.equal(note.link, "/manage/requests");
    });

    test("an ineligible request is refused with the failed rules and nothing is saved", async () => {
      await UserBadge.deleteMany({ user: f.student._id });
      const err = await failure(book(f.student));
      assert.equal(err.status, 422);
      assert.equal(err.code, "INELIGIBLE");
      assert.equal(
        err.message,
        "You don't meet 1 requirement for this resource.",
      );
      assert.deepEqual(err.details, [
        {
          rule: "BADGES",
          passed: false,
          message: "Missing badge: 3D Printing Basics.",
          fixHint: "Request it from Design and Innovation Centre.",
        },
      ]);
      assert.equal(await Booking.countDocuments(), 0);
    });

    test("a taken slot answers 409 with the waitlist position, or joins the waitlist", async () => {
      await book(f.student);
      const err = await failure(book(f.student2));
      assert.equal(err.code, "SLOT_TAKEN");
      assert.deepEqual(err.details, { waitlistPosition: 1 });

      const { booking, waitlistPosition } = await book(f.student2, TUE, {
        joinWaitlist: true,
      });
      assert.equal(booking.status, "waitlisted");
      assert.equal(waitlistPosition, 1);
      const [note] = await notificationsFor(f.student2);
      assert.match(note.body, /You're #1 in line\./);
      assert.equal(
        (await book(f.student3, TUE_LATER, { joinWaitlist: true }))
          .waitlistPosition,
        2,
      );
    });

    test("two students racing for the last slot: one pending, one waitlisted", async () => {
      const results = await Promise.all([
        book(f.student, TUE, { joinWaitlist: true }),
        book(f.student2, TUE, { joinWaitlist: true }),
      ]);
      assert.deepEqual(results.map((r) => r.booking.status).sort(), [
        "pending",
        "waitlisted",
      ]);
    });

    test("countable items: parallel units, back-to-back slots and auto-approval", async () => {
      const kit = (who, slot, extra) => book(who, slot, extra, f.kits);
      const late = {
        start: ist("2026-11-03T12:00"),
        end: ist("2026-11-03T13:00"),
      };
      assert.equal((await kit(f.student, TUE)).booking.status, "approved");
      assert.equal((await kit(f.student2, TUE)).booking.status, "approved");
      assert.equal(
        (await kit(f.student3, TUE, { joinWaitlist: true })).booking.status,
        "waitlisted",
      );
      assert.equal(
        (await kit(f.student3, late)).booking.status,
        "approved",
        "12:00 starts as 10–12 ends",
      );
      const [note] = await notificationsFor(f.student);
      assert.equal(note.type, "booking.approved");
    });

    test("capacity is the busiest moment: two short bookings don't fill a 2-unit kit", async () => {
      const kit = (who, start, end) =>
        book(
          who,
          { start: ist(`2026-11-05T${start}`), end: ist(`2026-11-05T${end}`) },
          {},
          f.kits,
        );
      await kit(f.student, "10:00", "11:00");
      await kit(f.student2, "11:00", "12:00");
      // 10–12 overlaps both, but only one unit is in use at any moment.
      assert.equal(
        (await kit(f.student3, "10:00", "12:00")).booking.status,
        "approved",
      );
    });

    test("fair-usage caps count the user's own bookings", async () => {
      await book(f.student);
      const wed = {
        start: ist("2026-11-04T10:00"),
        end: ist("2026-11-04T11:00"),
      };
      const err = await failure(book(f.student, wed));
      assert.deepEqual(
        err.details.map((d) => d.rule),
        ["ACTIVE_BOOKINGS"],
      );

      const kit = (slot) => book(f.student2, slot, {}, f.kits);
      await kit(TUE); // 2 of 3 weekly hours
      const wedTwoHours = {
        start: ist("2026-11-04T10:00"),
        end: ist("2026-11-04T12:00"),
      };
      const weekly = await failure(kit(wedTwoHours));
      assert.deepEqual(
        weekly.details.map((d) => d.rule),
        ["WEEKLY_HOURS"],
      );
      assert.equal(
        weekly.details[0].message,
        "You've used 2 of 3 hours this week on this resource.",
      );
    });
  });

  describe("decisions", () => {
    test("a manager of the unit approves with a note; others can't", async () => {
      const { booking } = await book(f.student);
      const denied = await failure(
        transition(booking._id, "approve", f.cseManager._id, {}, opts),
      );
      assert.equal(denied.code, "FORBIDDEN");

      const approved = await transition(
        booking._id,
        "approve",
        f.manager._id,
        { note: "Bring your own filament" },
        opts,
      );
      assert.equal(approved.status, "approved");
      assert.equal(approved.decision.reason, "Bring your own filament");
      const entry = await AuditLog.findOne({
        action: "booking.approved",
      }).lean();
      assert.deepEqual(
        [entry.actor.role, entry.reason],
        ["manager", "Bring your own filament"],
      );
      assert.ok(
        (await notificationsFor(f.student)).some(
          (n) => n.type === "booking.approved",
        ),
      );

      const again = await failure(
        transition(booking._id, "approve", f.manager._id, {}, opts),
      );
      assert.equal(again.code, "INVALID_TRANSITION");
    });

    test("approval re-checks capacity under the lock", async () => {
      const { booking } = await book(f.student);
      // A holder that slipped in some other way (e.g. a manual database edit).
      await Booking.create({
        resource: f.printer._id,
        orgUnit: f.dic._id,
        borrower: f.student2._id,
        ...TUE,
        purpose: "Inserted by hand for the test",
        status: "approved",
      });
      const err = await failure(
        transition(booking._id, "approve", f.manager._id, {}, opts),
      );
      assert.equal(err.code, "SLOT_TAKEN");
      assert.equal(
        (await Booking.findById(booking._id).lean()).status,
        "pending",
      );
    });

    test("rejecting needs a reason, then promotes the oldest waitlisted request", async () => {
      const { booking } = await book(f.student);
      const second = (await book(f.student2, TUE, { joinWaitlist: true }))
        .booking;
      const third = (await book(f.student3, TUE_LATER, { joinWaitlist: true }))
        .booking;

      assert.equal(
        (
          await failure(
            transition(booking._id, "reject", f.manager._id, {}, opts),
          )
        ).code,
        "VALIDATION_ERROR",
      );
      await transition(
        booking._id,
        "reject",
        f.manager._id,
        { reason: "Printer reserved for the M.Des jury" },
        opts,
      );

      assert.equal(
        (await Booking.findById(second._id).lean()).status,
        "pending",
        "FIFO: oldest first",
      );
      assert.equal(
        (await Booking.findById(third._id).lean()).status,
        "waitlisted",
        "no capacity left for the next one",
      );
      const promoted = await AuditLog.findOne({
        action: "booking.promoted",
      }).lean();
      assert.deepEqual(
        [String(promoted.entity.id), promoted.actor.role],
        [String(second._id), "system"],
      );
      const notes = await notificationsFor(f.student2);
      assert.equal(notes.at(-1).type, "booking.promoted");
      assert.match(
        (await notificationsFor(f.student)).at(-1).body,
        /wasn't approved: Printer reserved for the M\.Des jury$/,
      );
    });

    test("promotion skips someone who is no longer eligible", async () => {
      const { booking } = await book(f.student);
      const second = (await book(f.student2, TUE, { joinWaitlist: true }))
        .booking;
      const third = (await book(f.student3, TUE_LATER, { joinWaitlist: true }))
        .booking;
      await User.updateOne(
        { _id: f.student2._id },
        { suspendedUntil: ist("2026-12-01T00:00") },
      );

      await transition(booking._id, "cancel", f.student._id, {}, opts);
      assert.equal(
        (await Booking.findById(second._id).lean()).status,
        "waitlisted",
      );
      assert.equal(
        (await Booking.findById(third._id).lean()).status,
        "pending",
      );
    });

    test("a borrower cancels without a reason and the managers are told", async () => {
      const { booking } = await book(f.student);
      await transition(booking._id, "cancel", f.student._id, {}, opts);
      const note = (await notificationsFor(f.manager)).at(-1);
      assert.equal(note.type, "booking.cancelled");
      assert.equal(
        note.body,
        "Ananya Rao cancelled Prusa MK4 3D Printer on 3 Nov, 10:00–12:00.",
      );
      const managerCancel = await failure(
        transition(
          (await book(f.student2)).booking._id,
          "cancel",
          f.manager._id,
          {},
          opts,
        ),
      );
      assert.equal(
        managerCancel.code,
        "VALIDATION_ERROR",
        "managers must give a reason",
      );
    });

    test("the sweeper's no-show frees the slot for a later waitlisted request", async () => {
      const { booking } = await book(f.student);
      await transition(booking._id, "approve", f.manager._id, {}, opts);
      const later = (await book(f.student2, TUE_LATER, { joinWaitlist: true }))
        .booking;

      const tooSoon = await failure(
        transition(
          booking._id,
          "markNoShow",
          SYSTEM,
          {},
          { now: plus(TUE.start, 10) },
        ),
      );
      assert.equal(tooSoon.code, "INVALID_TRANSITION");
      const missed = await transition(
        booking._id,
        "markNoShow",
        SYSTEM,
        {},
        { now: plus(TUE.start, 16) },
      );
      assert.equal(missed.status, "no_show");
      assert.equal(
        (await Booking.findById(later._id).lean()).status,
        "pending",
      );
      assert.ok(
        (await notificationsFor(f.manager)).some(
          (n) => n.type === "booking.no_show",
        ),
      );
    });

    test("a manager rejecting while the borrower cancels: exactly one wins", async () => {
      const { booking } = await book(f.student);
      const results = await Promise.allSettled([
        transition(
          booking._id,
          "reject",
          f.manager._id,
          { reason: "Printer reserved for the M.Des jury" },
          opts,
        ),
        transition(booking._id, "cancel", f.student._id, {}, opts),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        results.find((r) => r.status === "rejected").reason.code,
        "INVALID_TRANSITION",
      );
      assert.equal(
        await AuditLog.countDocuments({ "entity.id": booking._id }),
        2,
        "requested + one decision",
      );
    });

    test("only decisions go through transition()", async () => {
      const { booking } = await book(f.student);
      assert.equal(
        (
          await failure(
            transition(booking._id, "checkIn", f.student._id, {}, opts),
          )
        ).code,
        "VALIDATION_ERROR",
      );
    });
  });

  describe("handover and return", () => {
    const approvedBooking = async () => {
      const { booking } = await book(f.student);
      return transition(booking._id, "approve", f.manager._id, {}, opts);
    };
    const handoverTime = { now: plus(TUE.start, -10) };

    test("check-in opens 15 minutes before the start and needs the full checklist", async () => {
      const booking = await approvedBooking();
      const early = await failure(
        checkIn(booking._id, f.student._id, checklistOk(), {
          now: plus(TUE.start, -30),
        }),
      );
      assert.equal(early.code, "INVALID_TRANSITION");
      assert.match(
        early.message,
        /Check-in opens 15 minutes before the start time/,
      );

      const partial = await failure(
        checkIn(
          booking._id,
          f.student._id,
          {
            items: [
              { label: "Nozzle clean", ok: true },
              { label: "Coffee", ok: true },
            ],
            overall: "good",
          },
          handoverTime,
        ),
      );
      assert.equal(partial.code, "VALIDATION_ERROR");
      assert.deepEqual(
        partial.details.map((d) => d.message),
        [
          "Missing: Build plate undamaged",
          "Not on this resource's checklist: Coffee",
        ],
      );
      assert.equal(await ConditionReport.countDocuments(), 0);

      const checkedIn = await checkIn(
        booking._id,
        f.student._id,
        checklistOk(),
        handoverTime,
      );
      assert.equal(checkedIn.status, "checked_in");
      const report = await ConditionReport.findById(
        checkedIn.checkIn.report,
      ).lean();
      assert.deepEqual([report.phase, report.overall], ["check_in", "good"]);
      assert.ok(
        (await notificationsFor(f.manager)).some(
          (n) => n.type === "booking.checked_in",
        ),
      );
      assert.equal(
        (
          await failure(
            checkIn(booking._id, f.student._id, checklistOk(), handoverTime),
          )
        ).code,
        "INVALID_TRANSITION",
      );
    });

    test("check-out, then the manager confirms the return", async () => {
      const booking = await approvedBooking();
      await checkIn(booking._id, f.student._id, checklistOk(), handoverTime);
      await checkOut(booking._id, f.student._id, checklistOk(), {
        now: TUE.end,
      });
      const confirm = (await notificationsFor(f.manager)).at(-1);
      assert.deepEqual(
        [confirm.type, confirm.link],
        ["booking.checked_out", `/manage/returns/${booking._id}`],
      );

      const { booking: done, incident } = await confirmReturn(
        booking._id,
        f.manager._id,
        { outcome: "ok" },
        { now: TUE.end },
      );
      assert.equal(done.status, "completed");
      assert.equal(incident, null);
    });

    test("reporting an issue flags the booking and opens an incident for a human", async () => {
      const booking = await approvedBooking();
      await checkIn(booking._id, f.student._id, checklistOk(), handoverTime);
      await checkOut(booking._id, f.student._id, checklistOk(), {
        now: TUE.end,
      });

      const missing = await failure(
        confirmReturn(
          booking._id,
          f.manager._id,
          { outcome: "issue" },
          { now: TUE.end },
        ),
      );
      assert.equal(missing.code, "VALIDATION_ERROR");

      const { booking: flagged, incident } = await confirmReturn(
        booking._id,
        f.manager._id,
        {
          outcome: "issue",
          items: [
            { label: "Nozzle clean", ok: true },
            { label: "Build plate undamaged", ok: false, note: "Deep scratch" },
          ],
          note: "Scratch near the front edge",
          incident: {
            type: "damage",
            severity: "high",
            description: "Build plate scratched near the front edge.",
          },
        },
        { now: TUE.end },
      );
      assert.equal(flagged.status, "flagged");
      assert.deepEqual(flagged.incidents.map(String), [String(incident._id)]);
      assert.deepEqual(
        [incident.status, incident.source, incident.severity],
        ["open", "manager", "high"],
      );
      const report = await ConditionReport.findOne({
        phase: "return_confirmation",
      }).lean();
      assert.equal(report.overall, "damaged");
      assert.equal(
        (await AuditLog.findOne({ action: "incident.created" }).lean()).actor
          .role,
        "manager",
      );
      for (const [who, link] of [
        [f.student, `/incidents/${incident._id}`],
        [f.manager, `/manage/incidents/${incident._id}`],
        [f.admin, "/admin/incidents"],
      ]) {
        const note = (await notificationsFor(who)).at(-1);
        assert.deepEqual([note.type, note.link], ["incident.created", link]);
      }
    });
  });

  describe("reads", () => {
    test("booking detail: buttons per viewer, waitlist position, strangers refused", async () => {
      const { booking } = await book(f.student);
      const waiting = (await book(f.student2, TUE, { joinWaitlist: true }))
        .booking;

      assert.deepEqual(
        (await getBooking(booking._id, f.student._id, opts)).allowedActions,
        ["cancel"],
      );
      assert.deepEqual(
        (await getBooking(booking._id, f.manager._id, opts)).allowedActions,
        ["approve", "reject", "waitlist", "cancel"],
      );
      const detail = await getBooking(waiting._id, f.student2._id, opts);
      assert.equal(detail.waitlistPosition, 1);
      assert.equal(detail.borrower.name, "Kabir Singh");
      assert.equal(detail.borrower.email, undefined, "no email for managers");
      assert.equal(
        (await failure(getBooking(booking._id, f.student3._id, opts))).code,
        "FORBIDDEN",
      );
    });

    test("my bookings and the manager queue grouped by conflict, scoped to the unit", async () => {
      await book(f.student);
      await book(f.student2, TUE, { joinWaitlist: true });
      await book(f.student3, TUE_LATER, { joinWaitlist: true });

      const mine = await listMine(f.student3._id);
      assert.deepEqual(
        [mine.meta.total, mine.items[0].waitlistPosition],
        [1, 2],
      );

      const queue = await listForManager(f.manager._id, { status: "pending" });
      assert.equal(queue.groups.length, 1);
      assert.deepEqual(
        queue.groups[0].bookings.map((b) => [
          b.borrower.name,
          b.status,
          b.waitlistPosition ?? null,
        ]),
        [
          ["Ananya Rao", "pending", null],
          ["Kabir Singh", "waitlisted", 1],
          ["Ishaan Das", "waitlisted", 2],
        ],
      );
      assert.equal(
        (await listForManager(f.cseManager._id, { status: "pending" })).groups
          .length,
        0,
      );
      assert.equal(
        (await listForManager(f.admin._id, { status: "pending" })).groups
          .length,
        1,
      );
      assert.equal(
        (await failure(listForManager(f.student._id, {}))).code,
        "FORBIDDEN",
      );
    });

    test("the timeline tells the whole story in order", async () => {
      const { booking } = await book(f.student);
      await transition(
        booking._id,
        "approve",
        f.manager._id,
        { note: "Bring your own filament" },
        opts,
      );
      await checkIn(booking._id, f.student._id, checklistOk(), {
        now: plus(TUE.start, -5),
      });
      await checkOut(booking._id, f.student._id, checklistOk(), {
        now: TUE.end,
      });
      await confirmReturn(
        booking._id,
        f.manager._id,
        { outcome: "ok" },
        { now: TUE.end },
      );

      const timeline = await getTimeline(booking._id, f.student._id);
      assert.deepEqual(
        timeline.map((item) => item.text),
        [
          "Ananya Rao requested this booking",
          'Manager (DIC) approved: "Bring your own filament"',
          "Check-in report: good condition",
          "Ananya Rao checked in",
          "Check-out report: good condition",
          "Ananya Rao checked out",
          "Manager (DIC) confirmed the return",
        ],
      );
      assert.equal(
        (await failure(getTimeline(booking._id, f.student2._id))).code,
        "FORBIDDEN",
      );
    });
  });

  describe("when Redis is down", () => {
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

    test("creating fails closed with 503; a cancel still works and promotion is skipped", async () => {
      const { booking } = await book(f.student);
      const waiting = (await book(f.student2, TUE, { joinWaitlist: true }))
        .booking;
      useRedisClient(unreachable());

      const err = await failure(
        book(f.student3, {
          start: ist("2026-11-05T10:00"),
          end: ist("2026-11-05T11:00"),
        }),
      );
      assert.deepEqual([err.status, err.code], [503, "SERVICE_UNAVAILABLE"]);
      assert.equal(await Booking.countDocuments(), 2);

      await transition(booking._id, "cancel", f.student._id, {}, opts);
      assert.equal(
        (await Booking.findById(booking._id).lean()).status,
        "cancelled",
      );
      assert.equal(
        (await Booking.findById(waiting._id).lean()).status,
        "waitlisted",
      );
      assert.ok(
        warnings.some(
          ([, message]) => message === "Waitlist promotion skipped",
        ),
      );
    });
  });
});
