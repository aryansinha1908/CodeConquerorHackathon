// /api/v1/bookings over HTTP (architecture.md §5 and §6 "Bookings"): the whole app on port 0, a real
// MongoDB through fixtures.js (skipped without TEST_MONGODB_URI) and ioredis-mock. The booking
// service's rules are tested in test/integration/bookingService.test.js; these check that each route
// reaches its service with the right arguments and that answers and refusals reach the client in the
// envelope.
//
// Time: in a real request the services read the clock, so slots created over HTTP are picked relative
// to the real time (futureSlot), and earlier states are driven through the services with the
// fixtures' NOW. Check-in is judged by the real clock and a request can't fast-forward it, so the
// tests move an approved booking's slot to the present instead (moveSlot).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import logger from "../../src/lib/logger.js";
import { keys } from "../../src/lib/redisKeys.js";
import {
  AuditLog,
  Booking,
  ConditionReport,
  Incident,
  Notification,
  User,
  UserBadge,
} from "../../src/models/index.js";
import {
  checkIn,
  checkOut,
  transition,
} from "../../src/services/bookingService.js";
import {
  NOW,
  TUE,
  bookAs,
  checklistOk,
  ist,
  plus,
  redis,
  skip,
  useTestDatabase,
} from "../integration/fixtures.js";
import { useApi } from "./http.js";

logger.level = "silent";
// photoProblems accepts only delivery URLs of this account (services/uploadService.js).
process.env.CLOUDINARY_CLOUD_NAME = "campus-test";

const DAY = 24 * 60 * 60_000;
const IST_OFFSET = 330 * 60_000;

let f; // fixtures, rebuilt for every test

// A printer slot the real clock accepts, two days ahead (the printer needs 2 hours' notice, takes
// bookings up to 14 days ahead and is closed on Sundays): from–to in IST.
function futureSlot(from = "10:00", to = "12:00") {
  let day = new Date(Date.now() + IST_OFFSET + 2 * DAY);
  if (day.getUTCDay() === 0) day = new Date(day.getTime() + DAY);
  const date = day.toISOString().slice(0, 10);
  return { start: ist(`${date}T${from}`), end: ist(`${date}T${to}`) };
}

// An hour-long slot starting `minutes` from the real now (negative: already started).
function moveSlot(bookingId, minutes) {
  const start = plus(new Date(), minutes);
  return Booking.updateOne({ _id: bookingId }, { start, end: plus(start, 60) });
}

const WED = { start: ist("2026-11-04T10:00"), end: ist("2026-11-04T12:00") };
const THU = { start: ist("2026-11-05T10:00"), end: ist("2026-11-05T12:00") };
const PURPOSE = "Printing parts for the robotics club";

// Earlier states through the services, at the fixtures' NOW (a Monday) for the TUE slot by default.
const at = { now: NOW };
const pending = async (who = f.student, slot = TUE, extra = {}) =>
  (await bookAs(who, f.printer, slot, extra)).booking;
const approved = async (who = f.student) =>
  transition((await pending(who))._id, "approve", f.manager._id, {}, at);
const checkedOut = async () => {
  const booking = await approved();
  await checkIn(booking._id, f.student._id, checklistOk(f.printer), {
    now: plus(TUE.start, -10),
  });
  return checkOut(booking._id, f.student._id, checklistOk(f.printer), {
    now: TUE.end,
  });
};

const ourPhoto = (name) => ({
  publicId: `campuscommons/photos/${name}`,
  url: `https://res.cloudinary.com/campus-test/image/upload/v1730000000/campuscommons/photos/${name}.jpg`,
});
const foreignPhoto = { publicId: "x1", url: "https://example.com/x1.jpg" };
const photoProblem = {
  path: "photos.0",
  message: "Must be a photo uploaded through /uploads/images.",
};

const suspend = (user) =>
  User.updateOne(
    { _id: user._id },
    {
      suspendedUntil: plus(new Date(), 7 * 24 * 60),
      suspensionReason: "Repeated no-shows",
    },
  );

// The success envelope (architecture.md §6) → data.
function ok(res, status = 200) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.equal(typeof res.body.requestId, "string");
  assert.ok(res.body.requestId.length > 0);
  assert.ok("data" in res.body);
  return res.body.data;
}

// The error envelope → error.
function refused(res, status, code) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, code, JSON.stringify(res.body));
  assert.equal(typeof res.body.error.message, "string");
  assert.equal(typeof res.body.requestId, "string");
  return res.body.error;
}

const envelopeKeys = (res) => Object.keys(res.body).sort();
const bookingHits = (user) =>
  redis.get(`${keys.rateLimitPrefix("bookingCreate")}${user._id}`);

describe("/api/v1/bookings", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const { call } = useApi();

  test("every route answers 401 UNAUTHENTICATED without a valid token", async () => {
    const id = "6a1f00000000000000000001";
    const routes = [
      ["POST", "/bookings/check"],
      ["POST", "/bookings"],
      ["GET", "/bookings/mine"],
      ["GET", "/bookings/manage"],
      ["GET", `/bookings/${id}`],
      ["GET", `/bookings/${id}/timeline`],
      ...[
        "approve",
        "reject",
        "waitlist",
        "cancel",
        "check-in",
        "check-out",
        "confirm-return",
      ].map((action) => ["POST", `/bookings/${id}/${action}`]),
    ];
    for (const [method, path] of routes) {
      const json = method === "POST" ? {} : undefined;
      const res = await call(method, path, { json });
      refused(res, 401, "UNAUTHENTICATED");
      assert.deepEqual(envelopeKeys(res), ["error", "requestId", "success"]);
    }
    refused(
      await call("GET", "/bookings/mine", { token: "not-a-jwt" }),
      401,
      "UNAUTHENTICATED",
    );
  });

  describe("requests", () => {
    test("POST /bookings/check: the checklist for a slot and nothing saved; a suspended member still sees why", async () => {
      const slot = futureSlot();
      const res = await call("POST", "/bookings/check", {
        user: f.student,
        json: { resourceId: f.printer._id, ...slot },
      });
      const check = ok(res);
      assert.deepEqual(envelopeKeys(res), ["data", "requestId", "success"]);
      assert.deepEqual(
        [check.eligible, check.outcome, check.waitlistPosition],
        [true, "pending", null],
      );
      assert.equal(check.results.length, 12);
      assert.deepEqual(Object.keys(check.results[0]).sort(), [
        "fixHint",
        "hard",
        "message",
        "passed",
        "rule",
      ]);
      assert.equal(await Booking.countDocuments(), 0);

      // A dry run isn't a mutation: the checklist explains the suspension instead of a bare 403.
      await suspend(f.student2);
      const suspended = ok(
        await call("POST", "/bookings/check", {
          user: f.student2,
          json: { resourceId: f.printer._id, ...slot },
        }),
      );
      assert.equal(suspended.outcome, "ineligible");
      assert.deepEqual(
        suspended.results.filter((r) => !r.passed).map((r) => r.rule),
        ["NOT_SUSPENDED"],
      );

      // The id guard reaches the client: a resourceId that can't be an id is 404, not a CastError.
      refused(
        await call("POST", "/bookings/check", {
          user: f.student,
          json: { resourceId: "printer", ...slot },
        }),
        404,
        "NOT_FOUND",
      );
      assert.equal(
        await bookingHits(f.student),
        null,
        "a dry run isn't counted in the bookingCreate tier",
      );
    });

    test("POST /bookings: 201 with the evaluation, audited under the request id; refusals keep their codes", async () => {
      const slot = futureSlot();
      const body = { resourceId: f.printer._id, ...slot, purpose: PURPOSE };

      const res = await call("POST", "/bookings", {
        user: f.student,
        json: body,
      });
      const created = ok(res, 201);
      assert.deepEqual(Object.keys(created).sort(), [
        "booking",
        "evaluation",
        "waitlistPosition",
      ]);
      assert.equal(created.booking.status, "pending");
      assert.equal(created.booking.borrower, String(f.student._id));
      assert.equal(created.booking.start, slot.start.toISOString());
      assert.equal(created.evaluation.outcome, "pending");
      assert.equal(created.waitlistPosition, null);
      const entry = await AuditLog.findOne({
        "entity.id": created.booking._id,
      }).lean();
      assert.deepEqual(
        [entry.action, entry.requestId],
        ["booking.requested", res.body.requestId],
      );
      assert.equal(Number(await bookingHits(f.student)), 1);

      // The slot is held: 409 with the position, or the waitlist when asked.
      const taken = refused(
        await call("POST", "/bookings", { user: f.student2, json: body }),
        409,
        "SLOT_TAKEN",
      );
      assert.deepEqual(taken.details, { waitlistPosition: 1 });
      const waiting = ok(
        await call("POST", "/bookings", {
          user: f.student2,
          json: { ...body, joinWaitlist: true },
        }),
        201,
      );
      assert.deepEqual(
        [waiting.booking.status, waiting.waitlistPosition],
        ["waitlisted", 1],
      );

      // A field the model refuses: 400 with the field in details.
      const later = futureSlot("13:00", "15:00");
      const short = refused(
        await call("POST", "/bookings", {
          user: f.student3,
          json: { ...body, ...later, purpose: "Print" },
        }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(
        short.details.map((d) => d.path),
        ["purpose"],
      );

      // A failed rule: 422 with the rule, as the envelope example shows.
      await UserBadge.deleteMany({ user: f.student3._id });
      const ineligible = refused(
        await call("POST", "/bookings", {
          user: f.student3,
          json: { ...body, ...later },
        }),
        422,
        "INELIGIBLE",
      );
      assert.deepEqual(
        ineligible.details.map((d) => d.rule),
        ["BADGES"],
      );

      // Suspended: 403 before the bookingCreate tier, so the refusal isn't counted.
      await suspend(f.student2);
      const blocked = refused(
        await call("POST", "/bookings", {
          user: f.student2,
          json: { ...body, ...later },
        }),
        403,
        "FORBIDDEN",
      );
      assert.equal(blocked.details.reason, "Repeated no-shows");
      assert.equal(Number(await bookingHits(f.student2)), 2);
      assert.equal(await Booking.countDocuments(), 2);
    });
  });

  describe("lists", () => {
    test("GET /bookings/mine: the member's own bookings with paging meta; a bad query is 400 with every problem", async () => {
      await pending(f.student);
      await bookAs(f.student, f.kits, TUE); // auto-approved
      await pending(f.student2, WED);

      const res = await call("GET", "/bookings/mine", { user: f.student });
      const mine = ok(res);
      assert.deepEqual(envelopeKeys(res), [
        "data",
        "meta",
        "requestId",
        "success",
      ]);
      assert.deepEqual(res.body.meta, { page: 1, limit: 20, total: 2 });
      assert.deepEqual(mine.map((b) => b.resource.title).sort(), [
        "Arduino IoT Kit",
        "Prusa MK4 3D Printer",
      ]);
      assert.ok(mine.every((b) => b.borrower === String(f.student._id)));

      const approvedOnly = await call(
        "GET",
        "/bookings/mine?status=approved&limit=1",
        { user: f.student },
      );
      assert.deepEqual(
        ok(approvedOnly).map((b) => b.status),
        ["approved"],
      );
      assert.deepEqual(approvedOnly.body.meta, {
        page: 1,
        limit: 1,
        total: 1,
      });

      const bad = refused(
        await call("GET", "/bookings/mine?status=booked&page=0", {
          user: f.student,
        }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(
        bad.details.map((d) => d.path),
        ["status", "page"],
      );
    });

    test("GET /bookings/manage: the pending queue grouped by conflict, other statuses as a list, members refused", async () => {
      await pending(f.student);
      await pending(f.student2, TUE, { joinWaitlist: true });

      const res = await call("GET", "/bookings/manage?status=pending", {
        user: f.manager,
      });
      const groups = ok(res);
      assert.deepEqual(res.body.meta, { page: 1, limit: 20, total: 1 });
      assert.equal(groups.length, 1);
      assert.deepEqual(Object.keys(groups[0]).sort(), [
        "bookings",
        "end",
        "resource",
        "start",
      ]);
      assert.deepEqual(
        groups[0].bookings.map((b) => [
          b.borrower.name,
          b.status,
          b.waitlistPosition ?? null,
        ]),
        [
          ["Ananya Rao", "pending", null],
          ["Kabir Singh", "waitlisted", 1],
        ],
      );
      assert.ok(
        groups[0].bookings.every((b) => !("email" in b.borrower)),
        "no borrower email for managers",
      );

      const list = await call("GET", "/bookings/manage?status=waitlisted", {
        user: f.manager,
      });
      assert.deepEqual(
        ok(list).map((b) => [b.status, b.resource.title]),
        [["waitlisted", "Prusa MK4 3D Printer"]],
      );
      assert.deepEqual(list.body.meta, { page: 1, limit: 20, total: 1 });

      // Another unit's manager sees none of it; a member can't see the queue at all.
      const other = await call("GET", "/bookings/manage?status=pending", {
        user: f.cseManager,
      });
      assert.deepEqual([ok(other), other.body.meta.total], [[], 0]);
      refused(
        await call("GET", "/bookings/manage", { user: f.student }),
        403,
        "FORBIDDEN",
      );
      const bad = refused(
        await call("GET", "/bookings/manage?resourceId=printer&from=soon", {
          user: f.manager,
        }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(
        bad.details.map((d) => d.path),
        ["resourceId", "from"],
      );
    });
  });

  describe("one booking", () => {
    test("GET /bookings/:id and /timeline: the borrower and the unit's managers see them, others are 403, a malformed id is 404", async () => {
      const booking = await pending(f.student);

      const mine = ok(
        await call("GET", `/bookings/${booking._id}`, { user: f.student }),
      );
      assert.deepEqual(
        [mine._id, mine.status, mine.allowedActions, mine.isOverdue],
        [String(booking._id), "pending", ["cancel"], false],
      );
      assert.equal(mine.resource.title, "Prusa MK4 3D Printer");
      assert.deepEqual(mine.orgUnit, {
        _id: String(f.dic._id),
        name: "Design and Innovation Centre",
        code: "dic",
      });
      assert.equal(mine.waitlistPosition, null);

      const managed = ok(
        await call("GET", `/bookings/${booking._id}`, { user: f.manager }),
      );
      assert.deepEqual(managed.allowedActions, [
        "approve",
        "reject",
        "waitlist",
        "cancel",
      ]);
      assert.equal(managed.borrower.name, "Ananya Rao");
      assert.equal(managed.borrower.email, undefined, "no email for managers");

      refused(
        await call("GET", `/bookings/${booking._id}`, { user: f.student2 }),
        403,
        "FORBIDDEN",
      );
      refused(
        await call("GET", "/bookings/not-a-booking", { user: f.student }),
        404,
        "NOT_FOUND",
      );

      const timeline = ok(
        await call("GET", `/bookings/${booking._id}/timeline`, {
          user: f.manager,
        }),
      );
      assert.deepEqual(
        timeline.map((item) => [item.kind, item.action, item.text]),
        [["event", "booking.requested", "Ananya Rao requested this booking"]],
      );
      refused(
        await call("GET", `/bookings/${booking._id}/timeline`, {
          user: f.cseManager,
        }),
        403,
        "FORBIDDEN",
      );
      refused(
        await call("GET", "/bookings/1234/timeline", { user: f.student }),
        404,
        "NOT_FOUND",
      );
    });

    test("decisions: approve with a note, reject and waitlist with a reason, cancel by the borrower; scope and state hold", async () => {
      const first = await pending(f.student);
      const second = await pending(f.student2, WED);
      const third = await pending(f.student3, THU);
      const decide = (booking, action, user, json) =>
        call("POST", `/bookings/${booking._id}/${action}`, { user, json });

      // Another unit's manager, and the borrower themselves, can't decide.
      refused(await decide(first, "approve", f.cseManager), 403, "FORBIDDEN");
      refused(await decide(first, "approve", f.student), 403, "FORBIDDEN");

      const res = await decide(first, "approve", f.manager, {
        note: "Bring your own filament",
      });
      const approvedBooking = ok(res);
      assert.deepEqual(
        [approvedBooking.status, approvedBooking.decision.reason],
        ["approved", "Bring your own filament"],
      );
      const entry = await AuditLog.findOne({
        action: "booking.approved",
      }).lean();
      assert.equal(entry.requestId, res.body.requestId);
      refused(
        await decide(first, "approve", f.manager),
        409,
        "INVALID_TRANSITION",
      );

      // A rejection needs a reason, and the detail says which field.
      const missing = refused(
        await decide(second, "reject", f.manager, {}),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(missing.details, [
        { path: "reason", message: "Required" },
      ]);
      const rejected = ok(
        await decide(second, "reject", f.manager, {
          reason: "Printer reserved for the M.Des jury",
        }),
      );
      assert.deepEqual(
        [rejected.status, rejected.decision.reason],
        ["rejected", "Printer reserved for the M.Des jury"],
      );

      const waitlisted = ok(
        await decide(third, "waitlist", f.manager, {
          reason: "Waiting for the nozzle replacement",
        }),
      );
      assert.equal(waitlisted.status, "waitlisted");
      // The borrower leaves the waitlist with no body at all: no reason needed.
      const cancelled = ok(await decide(third, "cancel", f.student3));
      assert.deepEqual(
        [cancelled.status, cancelled.cancellation.by],
        ["cancelled", String(f.student3._id)],
      );

      refused(
        await call("POST", "/bookings/not-a-booking/cancel", {
          user: f.student,
        }),
        404,
        "NOT_FOUND",
      );
      // Decisions are mutations: a suspended manager is refused before the service.
      const fourth = await pending(f.student2, THU);
      await suspend(f.manager);
      refused(await decide(fourth, "approve", f.manager), 403, "FORBIDDEN");
      assert.equal(
        (await Booking.findById(fourth._id).lean()).status,
        "pending",
      );
    });

    test("check-in and check-out: own photos only, the whole checklist, and the window judged by the real clock", async () => {
      const booking = await approved();
      const url = (step) => `/bookings/${booking._id}/${step}`;
      const report = {
        ...checklistOk(f.printer),
        photos: [ourPhoto("check-in")],
      };

      await moveSlot(booking._id, 120);
      const early = refused(
        await call("POST", url("check-in"), { user: f.student, json: report }),
        409,
        "INVALID_TRANSITION",
      );
      assert.match(
        early.message,
        /^Check-in opens 15 minutes before the start time/,
      );

      await moveSlot(booking._id, -5);
      const foreign = refused(
        await call("POST", url("check-in"), {
          user: f.student,
          json: { ...report, photos: [foreignPhoto] },
        }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(foreign.details, [photoProblem]);
      refused(
        await call("POST", url("check-in"), {
          user: f.student2,
          json: report,
        }),
        403,
        "FORBIDDEN",
      );
      const partial = refused(
        await call("POST", url("check-in"), {
          user: f.student,
          json: { ...report, items: report.items.slice(0, 1) },
        }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(partial.details, [
        { path: "items", message: "Missing: Build plate undamaged" },
      ]);
      assert.equal(await ConditionReport.countDocuments(), 0);

      const checkedIn = ok(
        await call("POST", url("check-in"), { user: f.student, json: report }),
      );
      assert.equal(checkedIn.status, "checked_in");
      const saved = await ConditionReport.findById(
        checkedIn.checkIn.report,
      ).lean();
      assert.deepEqual(
        [saved.phase, saved.photos.map((p) => p.publicId)],
        ["check_in", ["campuscommons/photos/check-in"]],
      );

      refused(
        await call("POST", url("check-out"), {
          user: f.student,
          json: { ...checklistOk(f.printer), photos: [foreignPhoto] },
        }),
        400,
        "VALIDATION_ERROR",
      );
      const checkedOut = ok(
        await call("POST", url("check-out"), {
          user: f.student,
          json: checklistOk(f.printer),
        }),
      );
      assert.equal(checkedOut.status, "checked_out");
      assert.ok(checkedOut.checkOut.report);
    });

    test("confirm-return: the unit's managers inspect with an explicit outcome; ok completes the booking", async () => {
      const booking = await checkedOut();
      const confirm = (user, json) =>
        call("POST", `/bookings/${booking._id}/confirm-return`, { user, json });

      refused(await confirm(f.student, { outcome: "ok" }), 403, "FORBIDDEN");
      const noOutcome = refused(
        await confirm(f.manager),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(noOutcome.details, [
        { path: "outcome", message: 'Expected "ok" or "issue"' },
      ]);
      const foreign = refused(
        await confirm(f.manager, { outcome: "ok", photos: [foreignPhoto] }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(foreign.details, [photoProblem]);
      const noIncident = refused(
        await confirm(f.manager, { outcome: "issue" }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(noIncident.details, [
        { path: "incident", message: "Required" },
      ]);

      const done = ok(await confirm(f.manager, { outcome: "ok" }));
      assert.deepEqual(Object.keys(done).sort(), ["booking", "incident"]);
      assert.deepEqual(
        [done.booking.status, done.booking.returnConfirmation.outcome],
        ["completed", "ok"],
      );
      assert.equal(done.incident, null);
    });
  });

  describe("input checks", () => {
    const fields = (error) => error.details.map((d) => [d.path, d.message]);

    test("a bad or missing start or end is reported on its own field, before the resource is read", async () => {
      const { end } = futureSlot();
      for (const path of ["/bookings/check", "/bookings"]) {
        const garbage = refused(
          await call("POST", path, {
            user: f.student,
            json: { resourceId: f.printer._id, start: "garbage", end },
          }),
          400,
          "VALIDATION_ERROR",
        );
        assert.deepEqual(fields(garbage), [["start", "Must be a valid date."]]);
        const missing = refused(
          await call("POST", path, {
            user: f.student,
            json: { resourceId: f.printer._id },
          }),
          400,
          "VALIDATION_ERROR",
        );
        assert.deepEqual(fields(missing), [
          ["start", "Required."],
          ["end", "Required."],
        ]);
      }
      assert.equal(await Booking.countDocuments(), 0);
    });

    test("a reason or note over 500 characters is 400 before the booking changes, so nothing goes unaudited", async () => {
      const first = await pending(f.student);
      const decide = (action, user, json) =>
        call("POST", `/bookings/${first._id}/${action}`, { user, json });
      const cases = [
        ["reject", f.manager, { reason: "r".repeat(1200) }, "reason"],
        ["waitlist", f.manager, { reason: "w".repeat(501) }, "reason"],
        ["approve", f.manager, { note: "n".repeat(1001) }, "note"],
        ["cancel", f.student, { reason: "c".repeat(1500) }, "reason"],
      ];
      for (const [action, user, json, path] of cases) {
        const error = refused(
          await decide(action, user, json),
          400,
          "VALIDATION_ERROR",
        );
        assert.deepEqual(fields(error), [
          [path, "Can be at most 500 characters."],
        ]);
      }
      const typed = refused(
        await decide("approve", f.manager, { note: { $gt: "" } }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(fields(typed), [["note", "Must be text."]]);
      assert.equal(
        (await Booking.findById(first._id).lean()).status,
        "pending",
      );
      assert.equal(
        await AuditLog.countDocuments({ "entity.id": first._id }),
        1,
        "only booking.requested",
      );
      // A reason of exactly 500 characters still goes through, audited.
      const rejected = ok(
        await decide("reject", f.manager, { reason: "r".repeat(500) }),
      );
      assert.equal(rejected.status, "rejected");
      assert.equal(
        await AuditLog.countDocuments({ action: "booking.rejected" }),
        1,
      );
      // The notice carries it too, cut to the body's 500 characters rather than lost.
      const [notice] = await Notification.find({
        user: f.student._id,
        type: "booking.rejected",
      }).lean();
      assert.equal(notice.body.length, 500);
    });

    test("handover items that aren't a list of objects are 400 on items, never a 500", async () => {
      const booking = await approved();
      await moveSlot(booking._id, -5);
      const url = `/bookings/${booking._id}/check-in`;
      const cases = [
        [null, [["items", "Must be a list."]]],
        ["abc", [["items", "Must be a list."]]],
        [{}, [["items", "Must be a list."]]],
        [
          [null, { label: "Nozzle clean", ok: true }, "Build plate undamaged"],
          [
            ["items.0", "Must be an object with a label."],
            ["items.2", "Must be an object with a label."],
          ],
        ],
      ];
      for (const [items, expected] of cases) {
        const error = refused(
          await call("POST", url, {
            user: f.student,
            json: { items, overall: "good" },
          }),
          400,
          "VALIDATION_ERROR",
        );
        assert.deepEqual(fields(error), expected, JSON.stringify(items));
      }
      // An empty body: the checklist says what is missing (there is no `report` error).
      const empty = refused(
        await call("POST", url, { user: f.student }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(fields(empty), [
        ["items", "Missing: Nozzle clean"],
        ["items", "Missing: Build plate undamaged"],
      ]);
      assert.equal(await ConditionReport.countDocuments(), 0);
      assert.equal(
        (await Booking.findById(booking._id).lean()).status,
        "approved",
      );
    });

    test("confirm-return: bad items, a long note or a bad incident are 400 before anything is saved, and the retry works", async () => {
      const booking = await checkedOut();
      const confirm = (json) =>
        call("POST", `/bookings/${booking._id}/confirm-return`, {
          user: f.manager,
          json,
        });
      const incident = {
        type: "damage",
        severity: "low",
        description: "The nozzle is cracked badly here",
      };
      const { items } = checklistOk(f.printer);

      const notList = refused(
        await confirm({ outcome: "ok", items: "abc" }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(fields(notList), [["items", "Must be a list."]]);
      const longNote = refused(
        await confirm({ outcome: "issue", note: "n".repeat(1100), incident }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(fields(longNote), [
        ["note", "Can be at most 1000 characters."],
      ]);
      // The incident is checked before the report is saved, with the model's paths and messages.
      const short = refused(
        await confirm({
          outcome: "issue",
          items,
          incident: { ...incident, description: "Nozzle cracked" },
        }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(
        short.details.map((d) => d.path),
        ["description"],
      );
      assert.equal(
        await ConditionReport.countDocuments({ phase: "return_confirmation" }),
        0,
      );
      assert.equal(await Incident.countDocuments(), 0);
      assert.equal(
        (await Booking.findById(booking._id).lean()).status,
        "checked_out",
      );

      // The corrected retry, with the same items, goes through.
      const done = ok(await confirm({ outcome: "issue", items, incident }));
      assert.equal(done.booking.status, "flagged");
      assert.deepEqual(done.booking.incidents, [done.incident._id]);
      assert.equal(await Incident.countDocuments(), 1);
    });

    test("GET /bookings/mine takes several statuses; /manage and /:id show the borrower's department as an object", async () => {
      const first = await pending(f.student);
      await transition(first._id, "cancel", f.student._id, {}, at);
      await pending(f.student, WED);
      await bookAs(f.student, f.kits, TUE); // auto-approved
      for (const query of [
        "status=approved,pending",
        "status=pending&status=approved",
      ]) {
        const res = await call("GET", `/bookings/mine?${query}`, {
          user: f.student,
        });
        assert.deepEqual(ok(res).map((b) => b.status).sort(), [
          "approved",
          "pending",
        ]);
        assert.equal(res.body.meta.total, 2);
      }
      const bad = refused(
        await call("GET", "/bookings/mine?status=pending,booked", {
          user: f.student,
        }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(
        bad.details.map((d) => d.path),
        ["status"],
      );

      const department = {
        _id: String(f.cse._id),
        code: "cse",
        name: "Computer Science and Engineering",
      };
      const queue = ok(
        await call("GET", "/bookings/manage?status=pending", {
          user: f.manager,
        }),
      );
      assert.deepEqual(queue[0].bookings[0].borrower.department, department);
      const list = ok(
        await call("GET", "/bookings/manage?status=approved", {
          user: f.manager,
        }),
      );
      assert.deepEqual(list[0].borrower.department, department);
      const one = ok(
        await call("GET", `/bookings/${list[0]._id}`, { user: f.manager }),
      );
      assert.deepEqual(one.borrower.department, department);
    });
  });

  test("the whole lifecycle over HTTP: request, approve, check in, check out, return with an issue", async () => {
    const requestIds = [];
    const send = async (path, user, json, status = 200) => {
      const res = await call("POST", path, { user, json });
      const data = ok(res, status);
      requestIds.push(res.body.requestId);
      return data;
    };
    const created = await send(
      "/bookings",
      f.student,
      { resourceId: f.printer._id, ...futureSlot(), purpose: PURPOSE },
      201,
    );
    assert.equal(created.booking.status, "pending");
    const id = created.booking._id;
    const step = (action, user, json) =>
      send(`/bookings/${id}/${action}`, user, json);

    const approvedBooking = await step("approve", f.manager, {
      note: "Bring your own filament",
    });
    assert.equal(approvedBooking.status, "approved");

    // The one step that isn't a request: time passes until the slot starts.
    await moveSlot(id, -5);
    const checkedIn = await step("check-in", f.student, {
      ...checklistOk(f.printer),
      photos: [ourPhoto("before")],
    });
    assert.equal(checkedIn.status, "checked_in");

    const checkedOut = await step("check-out", f.student, {
      items: [
        { label: "Nozzle clean", ok: true },
        { label: "Build plate undamaged", ok: false, note: "Scratched" },
      ],
      overall: "minor_issue",
      notes: "The plate was scratched during removal",
    });
    assert.equal(checkedOut.status, "checked_out");

    const returned = await step("confirm-return", f.manager, {
      outcome: "issue",
      items: [
        { label: "Nozzle clean", ok: true },
        { label: "Build plate undamaged", ok: false, note: "Deep scratch" },
      ],
      photos: [ourPhoto("after")],
      note: "Scratch near the front edge",
      incident: {
        type: "damage",
        severity: "high",
        description: "Build plate scratched near the front edge.",
      },
    });
    assert.equal(returned.booking.status, "flagged");
    assert.deepEqual(
      [returned.incident.status, returned.incident.severity],
      ["open", "high"],
    );
    assert.deepEqual(returned.booking.incidents, [returned.incident._id]);
    assert.deepEqual(
      returned.incident.photos.map((p) => p.publicId),
      ["campuscommons/photos/after"],
    );
    assert.equal(await Incident.countDocuments({ booking: id }), 1);

    const detail = ok(
      await call("GET", `/bookings/${id}`, { user: f.student }),
    );
    assert.deepEqual([detail.status, detail.allowedActions], ["flagged", []]);

    const timeline = ok(
      await call("GET", `/bookings/${id}/timeline`, { user: f.student }),
    );
    assert.deepEqual(
      timeline.filter((i) => i.kind === "event").map((i) => i.text),
      [
        "Ananya Rao requested this booking",
        'Manager (DIC) approved: "Bring your own filament"',
        "Ananya Rao checked in",
        "Ananya Rao checked out",
        'Manager (DIC) reported an issue on return: "Scratch near the front edge"',
      ],
    );
    assert.deepEqual(
      timeline.filter((i) => i.kind === "condition_report").map((i) => i.text),
      [
        "Check-in report: good condition, 1 photo",
        "Check-out report: minor issue, 1 item flagged",
        "Return report: damaged, 1 item flagged, 1 photo",
      ],
    );
    assert.deepEqual(
      timeline.filter((i) => i.kind === "incident").map((i) => i.text),
      ["Incident opened: high-severity damage"],
    );

    // Each step's audit entry carries the id of the request that made it ({ requestId: req.id }).
    const entries = await AuditLog.find({
      "entity.type": "booking",
      "entity.id": id,
    })
      .sort({ at: 1 })
      .lean();
    assert.deepEqual(
      entries.map((e) => e.requestId),
      requestIds,
    );
  });
});
