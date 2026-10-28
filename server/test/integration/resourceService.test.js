// Resource service against a real MongoDB; see fixtures.js for how to run it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { keys } from "../../src/lib/redisKeys.js";
import {
  AuditLog,
  Booking,
  OrgUnit,
  Resource,
  User,
  UserBadge,
} from "../../src/models/index.js";
import {
  createResource,
  getAvailability,
  getEligibility,
  getResource,
  listResourceBookings,
  listResources,
  setResourceStatus,
  updateResource,
} from "../../src/services/resourceService.js";
import {
  NOW,
  TUE,
  TUE_LATER,
  bookAs,
  failure,
  ist,
  plus,
  redis,
  skip,
  useTestDatabase,
} from "./fixtures.js";

let f; // fixtures, rebuilt for every test

const DEMO_ID = "demo-user-id-001"; // what the mock auth puts in req.user.id
const WED = { start: ist("2026-11-04T10:00"), end: ist("2026-11-04T12:00") };
const WEEKDAYS = [1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  open: "09:00",
  close: "17:00",
}));
const newId = () => new mongoose.Types.ObjectId();
const titles = (result) => result.items.map((r) => r.title);
const pathsOf = (err) => err.details.map((d) => d.path);
const audits = (action) => AuditLog.find({ action }).sort({ at: 1 }).lean();

async function refused(promise, status, code) {
  const err = await failure(promise);
  assert.equal(err.status, status, err.message);
  assert.equal(err.code, code);
  return err;
}

const list = (who, query = {}) => listResources(who._id, query, { now: NOW });

// A CSE hall for faculty on Sundays, a DIC laser cutter and a CSE analyser under maintenance, and
// an archived DIC lathe.
async function moreResources() {
  const [hall, cutter, analyser, lathe] = await Resource.create([
    {
      orgUnit: f.cse._id,
      title: "Seminar Hall",
      description: "Projector and seating for 120",
      category: "space",
      availability: { weekly: [{ day: 0, open: "10:00", close: "16:00" }] },
      eligibility: { memberTypes: ["faculty"] },
    },
    {
      orgUnit: f.dic._id,
      title: "Laser Cutter",
      category: "tool",
      status: "maintenance",
      availability: { weekly: WEEKDAYS },
    },
    {
      orgUnit: f.cse._id,
      title: "Logic Analyser",
      category: "equipment",
      status: "maintenance",
      availability: { weekly: WEEKDAYS },
    },
    {
      orgUnit: f.dic._id,
      title: "Old Lathe",
      category: "tool",
      status: "archived",
    },
  ]);
  return { hall, cutter, analyser, lathe };
}

// Written directly, so any status or past date can be set up without walking the state machine.
const rawBooking = (who, resource, slot, status) =>
  Booking.create({
    resource: resource._id,
    orgUnit: resource.orgUnit,
    borrower: who._id,
    ...slot,
    purpose: "Printing parts for the robotics club",
    status,
  });

describe("resourceService", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  describe("listResources", () => {
    test("members see active resources by title, with open hours and populated refs", async () => {
      await moreResources();
      const result = await list(f.student);
      assert.deepEqual(titles(result), [
        "Arduino IoT Kit",
        "Prusa MK4 3D Printer",
        "Seminar Hall",
      ]);
      assert.deepEqual(result.meta, { page: 1, limit: 20, total: 3 });

      const printer = result.items[1];
      assert.equal(printer._id, String(f.printer._id));
      assert.deepEqual(printer.orgUnit, {
        _id: String(f.dic._id),
        name: "Design and Innovation Centre",
        code: "dic",
        type: "centre",
      });
      assert.deepEqual(printer.eligibility.badges, [
        {
          _id: String(f.badge._id),
          name: "3D Printing Basics",
          code: "3d-printing-basics",
          orgUnit: {
            _id: String(f.dic._id),
            name: "Design and Innovation Centre",
          },
        },
      ]);
      assert.equal(printer.openHours, "Mon–Sat 09:00–17:00");
      for (const field of ["usageRules", "checklist", "createdBy", "__v"])
        assert.equal(field in printer, false, field);
      assert.equal("blackouts" in printer.availability, false);
    });

    test("filters by category, unit, member type (an empty list is open to all) and IST weekday", async () => {
      await moreResources();
      assert.deepEqual(titles(await list(f.student, { category: "space" })), [
        "Seminar Hall",
      ]);
      assert.deepEqual(titles(await list(f.student, { orgUnit: f.cse._id })), [
        "Seminar Hall",
      ]);
      // The printer excludes staff and the hall is faculty-only; the kit has no restriction.
      assert.deepEqual(titles(await list(f.student, { memberType: "staff" })), [
        "Arduino IoT Kit",
      ]);
      assert.equal(
        (await list(f.student, { memberType: "faculty" })).meta.total,
        3,
      );
      // 8 Nov 2026 is a Sunday in IST; z.coerce.date() would pass it as UTC midnight.
      assert.deepEqual(titles(await list(f.student, { date: "2026-11-08" })), [
        "Seminar Hall",
      ]);
      assert.deepEqual(
        titles(await list(f.student, { date: new Date("2026-11-08") })),
        ["Seminar Hall"],
      );
      // Sunday 01:30 IST is still Saturday in UTC: the weekday must be read in IST.
      assert.deepEqual(
        titles(
          await list(f.student, { date: new Date("2026-11-07T20:00:00Z") }),
        ),
        ["Seminar Hall"],
      );
      assert.deepEqual(titles(await list(f.student, { date: "2026-11-03" })), [
        "Arduino IoT Kit",
        "Prusa MK4 3D Printer",
      ]);
      assert.deepEqual(
        titles(
          await list(f.student, { category: "equipment", date: "2026-11-08" }),
        ),
        [],
      );
    });

    test("text search uses the text index and ranks title matches above description matches", async () => {
      await Resource.create([
        {
          orgUnit: f.dic._id,
          title: "Resin Printer",
          category: "equipment",
        },
        {
          orgUnit: f.dic._id,
          title: "Vinyl Cutter",
          description: "Pairs with the printer for stickers",
          category: "tool",
        },
      ]);
      const found = titles(await list(f.student, { q: "printer" }));
      assert.deepEqual(found.slice(0, 2).sort(), [
        "Prusa MK4 3D Printer",
        "Resin Printer",
      ]);
      assert.equal(found[2], "Vinyl Cutter");
      assert.deepEqual(titles(await list(f.student, { q: " arduino " })), [
        "Arduino IoT Kit",
      ]);
      assert.deepEqual(await list(f.student, { q: "oscilloscope" }), {
        items: [],
        meta: { page: 1, limit: 20, total: 0 },
      });
    });

    test("pages through results and caps the limit at 50", async () => {
      await moreResources();
      const first = await list(f.student, { limit: 2 });
      const second = await list(f.student, { limit: "2", page: "2" });
      assert.deepEqual(titles(first), [
        "Arduino IoT Kit",
        "Prusa MK4 3D Printer",
      ]);
      assert.deepEqual(titles(second), ["Seminar Hall"]);
      assert.deepEqual(second.meta, { page: 2, limit: 2, total: 3 });
      assert.equal((await list(f.student, { limit: 500 })).meta.limit, 50);
    });

    test("bad query values are 400s with every problem listed, never a database error", async () => {
      const err = await refused(
        list(f.student, {
          q: { $ne: null },
          category: "boats",
          orgUnit: { $ne: null },
          memberType: "alumni",
          date: "2026-02-31",
          status: "gone",
          page: 0,
          limit: "many",
          eligibleOnly: "maybe",
        }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(pathsOf(err).sort(), [
        "category",
        "date",
        "eligibleOnly",
        "limit",
        "memberType",
        "orgUnit",
        "page",
        "q",
        "status",
      ]);
      assert.equal(err.message, "9 parameters are invalid.");
      const other = await refused(
        list(f.student, { orgUnit: "dic" }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(other.details, [
        { path: "orgUnit", message: "Must be a valid id." },
      ]);
    });

    test("the mock auth's id is a clean 404, not a CastError", async () => {
      const err = await refused(listResources(DEMO_ID), 404, "NOT_FOUND");
      assert.equal(err.message, "User not found.");
    });
  });

  describe("statuses other than active", () => {
    test("a member asking for another status is refused", async () => {
      await moreResources();
      for (const status of ["maintenance", "archived"])
        await refused(list(f.student, { status }), 403, "FORBIDDEN");
    });

    test("a manager sees only their own units, and the cache keeps each manager's list apart", async () => {
      await moreResources();
      // Same query, one after the other: without the unit scope in the cache key, the CSE manager
      // would be served the DIC manager's cached list.
      assert.deepEqual(
        titles(await list(f.manager, { status: "maintenance" })),
        ["Laser Cutter"],
      );
      assert.deepEqual(
        titles(await list(f.cseManager, { status: "maintenance" })),
        ["Logic Analyser"],
      );
      assert.deepEqual(titles(await list(f.admin, { status: "maintenance" })), [
        "Laser Cutter",
        "Logic Analyser",
      ]);
      assert.deepEqual(titles(await list(f.manager, { status: "archived" })), [
        "Old Lathe",
      ]);
      assert.deepEqual(
        titles(await list(f.cseManager, { status: "archived" })),
        [],
      );
      await refused(
        list(f.manager, { status: "maintenance", orgUnit: f.cse._id }),
        403,
        "FORBIDDEN",
      );
      // Active resources are everyone's, whichever unit runs them.
      assert.equal((await list(f.manager)).meta.total, 3);
    });

    test("managers can list several statuses at once, still only for their own units", async () => {
      await moreResources();
      await setResourceStatus(f.manager._id, f.kits._id, {
        status: "maintenance",
        reason: "Restocking the sensors",
      });
      // The /manage/resources table: a row toggled to maintenance must stay on the page.
      const table = await list(f.manager, {
        orgUnit: f.dic._id,
        status: ["active", "maintenance"],
      });
      assert.deepEqual(titles(table), [
        "Arduino IoT Kit",
        "Laser Cutter",
        "Prusa MK4 3D Printer",
      ]);
      assert.equal(table.meta.total, 3);
      assert.deepEqual(
        titles(await list(f.manager, { status: "maintenance,active" })),
        ["Arduino IoT Kit", "Laser Cutter", "Prusa MK4 3D Printer"],
      );
      assert.deepEqual(
        titles(await list(f.cseManager, { status: ["maintenance", "active"] })),
        ["Logic Analyser", "Seminar Hall"],
      );
      assert.equal(
        (await list(f.admin, { status: "active,maintenance,archived" })).meta
          .total,
        6,
      );
      await refused(
        list(f.student, { status: ["active", "maintenance"] }),
        403,
        "FORBIDDEN",
      );
      await refused(
        list(f.manager, {
          status: ["active", "maintenance"],
          orgUnit: f.cse._id,
        }),
        403,
        "FORBIDDEN",
      );
      assert.equal(
        (await list(f.student, { status: ["active"] })).meta.total,
        2,
      );
      for (const status of [["active", "gone"], [], [{ $ne: null }]]) {
        const err = await refused(
          list(f.manager, { status }),
          400,
          "VALIDATION_ERROR",
        );
        assert.deepEqual(pathsOf(err), ["status"]);
      }
    });

    test("managedOrgUnits without the manager role gives no access", async () => {
      await moreResources();
      await User.updateOne(
        { _id: f.student._id },
        { managedOrgUnits: [f.dic._id] },
      );
      await refused(
        list(f.student, { status: "maintenance" }),
        403,
        "FORBIDDEN",
      );
    });
  });

  describe("eligibleOnly", () => {
    test("hides what the viewer can't book, and caches nothing about them", async () => {
      await moreResources();
      const eligible = (who) => list(who, { eligibleOnly: true });
      assert.deepEqual(titles(await eligible(f.student)), [
        "Arduino IoT Kit",
        "Prusa MK4 3D Printer",
      ]);
      // The CSE manager is faculty without the printing badge.
      assert.deepEqual(titles(await eligible(f.cseManager)), [
        "Arduino IoT Kit",
        "Seminar Hall",
      ]);
      // A badge lost after the shared list was cached takes effect at once.
      await UserBadge.deleteMany({ user: f.student._id });
      assert.deepEqual(titles(await eligible(f.student)), ["Arduino IoT Kit"]);
      await getResource(f.student._id, f.printer._id);

      const cacheKeys = await redis.keys("*");
      assert.ok(cacheKeys.some((k) => k.startsWith("cache:resources:v")));
      for (const key of cacheKeys) {
        const value = (await redis.get(key)) ?? "";
        for (const person of [f.student, f.cseManager]) {
          for (const secret of [
            String(person._id),
            person.name,
            person.email,
          ]) {
            assert.equal(key.includes(secret), false, key);
            assert.equal(value.includes(secret), false, key);
          }
        }
        assert.equal(/"(eligible|canManage|userBadges)"/.test(value), false);
      }
    });

    test("leaves out resources where the viewer is at their active-booking limit", async () => {
      await bookAs(f.student, f.printer, TUE);
      assert.deepEqual(titles(await list(f.student, { eligibleOnly: true })), [
        "Arduino IoT Kit",
      ]);
      assert.deepEqual(titles(await list(f.student2, { eligibleOnly: true })), [
        "Arduino IoT Kit",
        "Prusa MK4 3D Printer",
      ]);
    });

    test("a manager's unit scope is part of the shared list's key too", async () => {
      await moreResources();
      // Same query, one manager after the other: without the scope in the eligibleOnly key, the CSE
      // manager would be filtering the DIC manager's cached units.
      const mine = (who) =>
        list(who, { status: ["active", "maintenance"], eligibleOnly: true });
      assert.deepEqual(titles(await mine(f.manager)), ["Arduino IoT Kit"]);
      assert.deepEqual(titles(await mine(f.cseManager)), ["Seminar Hall"]);
    });

    test("pages after filtering", async () => {
      await moreResources(); // the hall is filtered out for a UG student
      const page = (n) =>
        list(f.student, { eligibleOnly: "true", limit: 1, page: n });
      const [one, two, three] = await Promise.all([page(1), page(2), page(3)]);
      assert.deepEqual(titles(one), ["Arduino IoT Kit"]);
      assert.deepEqual(titles(two), ["Prusa MK4 3D Printer"]);
      assert.deepEqual(titles(three), []);
      assert.deepEqual(one.meta, {
        page: 1,
        limit: 1,
        total: 2,
        capped: false,
      });
    });

    test("the shared list stops at 200 resources and says so", async () => {
      await Resource.insertMany(
        Array.from({ length: 200 }, (_, i) => ({
          orgUnit: f.dic._id,
          title: `Bench ${String(i).padStart(3, "0")}`,
          slug: `bench-${i}`,
          category: "tool",
          availability: { weekly: WEEKDAYS },
        })),
      );
      const result = await list(f.student, { eligibleOnly: true });
      assert.equal(result.items.length, 20);
      assert.deepEqual(result.meta, {
        page: 1,
        limit: 20,
        total: 200,
        capped: true,
      });
    });
  });

  describe("cache", () => {
    test("lists and details are served from the cache until a write invalidates them", async () => {
      assert.ok(titles(await list(f.student)).includes("Prusa MK4 3D Printer"));
      await getResource(f.student._id, f.printer._id);
      // Behind the service's back, so nothing is invalidated.
      await Resource.updateOne(
        { _id: f.printer._id },
        { title: "Renamed behind the cache" },
      );
      assert.ok(titles(await list(f.student)).includes("Prusa MK4 3D Printer"));
      assert.equal(
        (await getResource(f.student._id, f.printer._id)).title,
        "Prusa MK4 3D Printer",
      );

      await updateResource(f.manager._id, f.printer._id, {
        description: "Now with a hardened steel nozzle",
      });
      assert.ok(
        titles(await list(f.student)).includes("Renamed behind the cache"),
      );
      const detail = await getResource(f.student._id, f.printer._id);
      assert.equal(detail.title, "Renamed behind the cache");
      assert.equal(detail.description, "Now with a hardened steel nozzle");
    });

    test("canManage is worked out per viewer, after the cache", async () => {
      const canManage = async (who) =>
        (await getResource(who._id, f.printer._id)).canManage;
      assert.equal(await canManage(f.student), false);
      assert.equal(await canManage(f.manager), true);
      assert.equal(await canManage(f.cseManager), false);
      assert.equal(await canManage(f.admin), true);
      const cached = JSON.parse(
        await redis.get(keys.resourceDetail(f.printer._id)),
      );
      assert.equal(cached.title, "Prusa MK4 3D Printer");
      assert.equal("canManage" in cached, false);
    });
  });

  describe("getResource", () => {
    test("returns the populated detail with open hours, without the unit's manager list", async () => {
      const detail = await getResource(f.student._id, f.printer._id);
      assert.equal(detail.orgUnit.code, "dic");
      assert.equal("managers" in detail.orgUnit, false);
      assert.deepEqual(detail.checklist, [
        "Nozzle clean",
        "Build plate undamaged",
      ]);
      assert.equal(
        detail.eligibility.badges[0].orgUnit.name,
        "Design and Innovation Centre",
      );
      assert.equal(detail.openHours, "Mon–Sat 09:00–17:00");
      assert.equal(detail.limits.maxHoursPerWeek, 6);
    });

    test("archived resources are 404 except for the unit's managers; maintenance stays visible", async () => {
      await setResourceStatus(f.manager._id, f.kits._id, {
        status: "maintenance",
        reason: "Restocking the sensors",
      });
      assert.equal(
        (await getResource(f.student._id, f.kits._id)).status,
        "maintenance",
      );

      // Cached while active: the 404 below must not come from a stale detail.
      await getResource(f.student._id, f.printer._id);
      await setResourceStatus(f.manager._id, f.printer._id, {
        status: "archived",
        reason: "Replaced by the MK5",
      });
      for (const who of [f.student, f.cseManager])
        await refused(getResource(who._id, f.printer._id), 404, "NOT_FOUND");
      for (const who of [f.manager, f.admin]) {
        const detail = await getResource(who._id, f.printer._id);
        assert.equal(detail.status, "archived");
        assert.equal(detail.canManage, true);
      }
    });

    test("malformed and unknown ids are 404s", async () => {
      const bad = await refused(
        getResource(f.student._id, DEMO_ID),
        404,
        "NOT_FOUND",
      );
      assert.equal(bad.message, "Resource not found.");
      await refused(getResource(f.student._id, newId()), 404, "NOT_FOUND");
      const who = await refused(
        getResource(DEMO_ID, f.printer._id),
        404,
        "NOT_FOUND",
      );
      assert.equal(who.message, "User not found.");
    });
  });

  describe("getAvailability", () => {
    const TUESDAY = {
      from: ist("2026-11-03T00:00"),
      to: ist("2026-11-04T00:00"),
    };

    test("open windows and busy blocks, with no borrower details", async () => {
      const mine = await bookAs(f.student, f.kits, TUE);
      const theirs = await bookAs(f.student2, f.kits, TUE_LATER);
      assert.equal(mine.booking.status, "approved");
      // Neither holds a unit.
      await rawBooking(f.student3, f.kits, TUE, "cancelled");
      await rawBooking(f.student3, f.kits, TUE_LATER, "waitlisted");

      const result = await getAvailability(f.kits._id, TUESDAY);
      assert.deepEqual(result, {
        quantity: 2,
        openWindows: [
          { start: ist("2026-11-03T09:00"), end: ist("2026-11-03T17:00") },
        ],
        busy: [
          {
            start: ist("2026-11-03T10:00"),
            end: ist("2026-11-03T11:00"),
            inUse: 1,
            full: false,
          },
          {
            start: ist("2026-11-03T11:00"),
            end: ist("2026-11-03T12:00"),
            inUse: 2,
            full: true,
          },
          {
            start: ist("2026-11-03T12:00"),
            end: ist("2026-11-03T13:00"),
            inUse: 1,
            full: false,
          },
        ],
      });
      const json = JSON.stringify(result);
      for (const secret of [
        String(f.student._id),
        String(f.student2._id),
        f.student.name,
        String(mine.booking._id),
        String(theirs.booking._id),
        "purpose",
        "borrower",
      ])
        assert.equal(json.includes(secret), false, secret);
    });

    test("windows span several IST days and blackouts are cut out", async () => {
      await Resource.updateOne(
        { _id: f.printer._id },
        {
          "availability.blackouts": [
            {
              start: ist("2026-11-03T12:00"),
              end: ist("2026-11-03T13:00"),
              reason: "Fire drill",
            },
          ],
        },
      );
      const { openWindows } = await getAvailability(f.printer._id, {
        from: "2026-11-02T00:00:00+05:30",
        to: "2026-11-04T00:00:00+05:30",
      });
      assert.deepEqual(openWindows, [
        { start: ist("2026-11-02T09:00"), end: ist("2026-11-02T17:00") },
        { start: ist("2026-11-03T09:00"), end: ist("2026-11-03T12:00") },
        { start: ist("2026-11-03T13:00"), end: ist("2026-11-03T17:00") },
      ]);
    });

    test("the range must be dates in order and at most 14 days long", async () => {
      const range = (from, to) => getAvailability(f.printer._id, { from, to });
      const twoWeeks = await range(NOW, plus(NOW, 14 * 24 * 60));
      // Mon 2 Nov from 10:00, five more days, Mon–Sat again, then Mon 16 Nov until 10:00.
      assert.equal(twoWeeks.openWindows.length, 13);
      assert.deepEqual(twoWeeks.openWindows[0], {
        start: NOW,
        end: ist("2026-11-02T17:00"),
      });
      assert.deepEqual(twoWeeks.openWindows.at(-1), {
        start: ist("2026-11-16T09:00"),
        end: ist("2026-11-16T10:00"),
      });

      const tooLong = await refused(
        range(NOW, plus(NOW, 14 * 24 * 60 + 1)),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(tooLong.details, [
        { path: "to", message: "The range can be at most 14 days." },
      ]);
      const reversed = await refused(
        range(TUE.end, TUE.start),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(reversed.details, [
        { path: "to", message: "Must be after from." },
      ]);
      await refused(range(NOW, NOW), 400, "VALIDATION_ERROR");
      const missing = await refused(
        getAvailability(f.printer._id),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(pathsOf(missing), ["from", "to"]);
      const garbled = await refused(
        range("soon", { $gt: "" }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(garbled.details, [
        { path: "from", message: "Must be a valid date." },
        { path: "to", message: "Must be a valid date." },
      ]);
    });

    test("archived, unknown and malformed resources are 404s", async () => {
      await setResourceStatus(f.manager._id, f.printer._id, {
        status: "archived",
        reason: "Replaced by the MK5",
      });
      for (const id of [f.printer._id, newId(), DEMO_ID])
        await refused(getAvailability(id, TUESDAY), 404, "NOT_FOUND");
    });
  });

  describe("getEligibility", () => {
    const eligibility = (who, slot, resource = f.printer) =>
      getEligibility(who._id, resource._id, slot, { now: NOW });

    test("without a slot: the member checklist and the quota meter", async () => {
      const fresh = await eligibility(f.student);
      assert.equal(fresh.eligible, true);
      assert.deepEqual(
        fresh.results.map((r) => r.rule),
        [
          "ACCOUNT_VERIFIED",
          "NOT_SUSPENDED",
          "RESOURCE_ACTIVE",
          "MEMBER_TYPE",
          "DEPARTMENT",
          "BADGES",
          "ACTIVE_BOOKINGS",
        ],
      );
      assert.deepEqual(fresh.quota, {
        hoursThisWeek: 0,
        maxHoursPerWeek: 6,
        activeCount: 0,
        maxActiveBookings: 1,
      });

      await bookAs(f.student, f.printer, TUE);
      const booked = await eligibility(f.student);
      assert.deepEqual(booked.quota, {
        hoursThisWeek: 2,
        maxHoursPerWeek: 6,
        activeCount: 1,
        maxActiveBookings: 1,
      });
      assert.equal(booked.eligible, false);
      const active = booked.results.find((r) => r.rule === "ACTIVE_BOOKINGS");
      assert.equal(active.passed, false);
      assert.deepEqual(active.meta, { used: 1, limit: 1 });
    });

    test("names the badge and the unit that issues it", async () => {
      await UserBadge.deleteMany({ user: f.student._id });
      const { eligible, results } = await eligibility(f.student);
      assert.equal(eligible, false);
      const badges = results.find((r) => r.rule === "BADGES");
      assert.equal(badges.message, "Missing badge: 3D Printing Basics.");
      assert.equal(
        badges.fixHint,
        "Request it from Design and Innovation Centre.",
      );
    });

    test("with a slot: the full booking check, exactly as POST /bookings/check", async () => {
      const free = await eligibility(f.student, TUE);
      assert.equal(free.outcome, "pending");
      assert.equal(free.results.length, 12);
      assert.equal(free.waitlistPosition, null);
      assert.equal("quota" in free, false);
      assert.deepEqual(
        free.results.find((r) => r.rule === "WEEKLY_HOURS").meta,
        { used: 0, requested: 2, limit: 6 },
      );

      await bookAs(f.student, f.printer, TUE);
      const taken = await eligibility(f.student2, {
        start: TUE.start.toISOString(),
        end: TUE.end.toISOString(),
      });
      assert.equal(taken.outcome, "slot_taken");
      assert.equal(taken.waitlistPosition, 1);
      assert.equal(await Booking.countDocuments(), 1);
    });

    test("a half-given or malformed slot is 400; malformed ids are 404s", async () => {
      const half = await refused(
        eligibility(f.student, { start: TUE.start }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(half.details, [{ path: "end", message: "Required." }]);
      const garbled = await refused(
        eligibility(f.student, { start: "later", end: TUE.end }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(pathsOf(garbled), ["start"]);

      for (const slot of [undefined, TUE]) {
        const err = await refused(
          getEligibility(DEMO_ID, f.printer._id, slot, { now: NOW }),
          404,
          "NOT_FOUND",
        );
        assert.equal(err.message, "User not found.");
        await refused(
          getEligibility(f.student._id, DEMO_ID, slot, { now: NOW }),
          404,
          "NOT_FOUND",
        );
      }
    });

    test("an archived resource is 404 except for the unit's managers", async () => {
      await setResourceStatus(f.manager._id, f.printer._id, {
        status: "archived",
        reason: "Replaced by the MK5",
      });
      await refused(eligibility(f.student), 404, "NOT_FOUND");
      await refused(eligibility(f.student, TUE), 404, "NOT_FOUND");
      const forManager = await eligibility(f.manager);
      const active = forManager.results.find(
        (r) => r.rule === "RESOURCE_ACTIVE",
      );
      assert.equal(active.message, "This resource is no longer available.");
    });
  });

  describe("createResource", () => {
    const form = (extra = {}) => ({
      orgUnit: f.dic._id,
      title: "Soldering Station",
      category: "tool",
      availability: { weekly: [{ day: 1, open: "09:00", close: "17:00" }] },
      eligibility: { memberTypes: ["ug"], badges: [f.badge._id] },
      limits: { maxHoursPerWeek: 4 },
      checklist: ["Tip tinned"],
      ...extra,
    });

    test("a unit manager lists a resource: populated, createdBy set, audited, listed at once", async () => {
      assert.equal((await list(f.student)).meta.total, 2); // cached
      const created = await createResource(f.manager._id, form(), {
        requestId: "req-create",
      });
      assert.equal(created.status, "active");
      assert.equal(created.orgUnit.code, "dic");
      assert.equal(created.eligibility.badges[0].name, "3D Printing Basics");
      assert.equal(created.openHours, "Mon 09:00–17:00");
      assert.equal(created.canManage, true);
      assert.match(created.slug, /^soldering-station-[a-f\d]{6}$/);
      const saved = await Resource.findById(created._id).lean();
      assert.equal(String(saved.createdBy), String(f.manager._id));
      assert.equal(saved.availability.slotMinutes, 30); // defaults still apply

      const [entry] = await audits("resource.created");
      assert.deepEqual(entry.actor, { id: f.manager._id, role: "manager" });
      assert.deepEqual(entry.entity, { type: "resource", id: saved._id });
      assert.equal(String(entry.orgUnit), String(f.dic._id));
      assert.deepEqual(entry.changes, {
        title: [null, "Soldering Station"],
        status: [null, "active"],
      });
      assert.equal(entry.requestId, "req-create");

      assert.ok(titles(await list(f.student)).includes("Soldering Station"));
      // Who listed it is in the audit log; members' copy of the detail doesn't carry their id.
      assert.equal("createdBy" in created, false);
      const seen = await getResource(f.student._id, created._id);
      assert.equal("createdBy" in seen, false);
      assert.equal(
        (await redis.get(keys.resourceDetail(created._id))).includes(
          String(f.manager._id),
        ),
        false,
      );
    });

    test("ids in upper-case hex name the same unit and badge", async () => {
      await moreResources();
      const upper = (doc) => String(doc._id).toUpperCase();
      const created = await createResource(
        f.manager._id,
        form({
          orgUnit: upper(f.dic),
          eligibility: { badges: [upper(f.badge)] },
        }),
      );
      assert.equal(created.orgUnit.code, "dic");
      assert.equal(created.eligibility.badges[0].code, "3d-printing-basics");
      assert.deepEqual(
        titles(
          await list(f.manager, {
            status: "maintenance",
            orgUnit: upper(f.dic),
          }),
        ),
        ["Laser Cutter"],
      );
    });

    test("an admin can list for any unit and is audited as admin", async () => {
      await createResource(f.admin._id, form({ orgUnit: f.cse._id }));
      const [entry] = await audits("resource.created");
      assert.equal(entry.actor.role, "admin");
      assert.equal(String(entry.orgUnit), String(f.cse._id));
    });

    test("other units' managers and members are refused, and nothing is written", async () => {
      for (const who of [f.cseManager, f.student])
        await refused(createResource(who._id, form()), 403, "FORBIDDEN");
      await refused(createResource(DEMO_ID, form()), 404, "NOT_FOUND");
      assert.equal(await Resource.countDocuments(), 2);
      assert.equal(await AuditLog.countDocuments(), 0);
    });

    test("the unit must exist and be active; departments and badges must exist", async () => {
      const detailsOf = async (who, input) =>
        (await refused(createResource(who._id, input), 400, "VALIDATION_ERROR"))
          .details;
      await OrgUnit.updateOne({ _id: f.cse._id }, { isActive: false });
      assert.deepEqual(await detailsOf(f.admin, form({ orgUnit: f.cse._id })), [
        { path: "orgUnit", message: "This unit is inactive." },
      ]);
      assert.deepEqual(await detailsOf(f.admin, form({ orgUnit: newId() })), [
        { path: "orgUnit", message: "No such unit." },
      ]);
      assert.deepEqual(await detailsOf(f.manager, form({ orgUnit: "dic" })), [
        { path: "orgUnit", message: "Must be a valid id." },
      ]);
      assert.deepEqual(
        await detailsOf(f.manager, form({ orgUnit: undefined })),
        [{ path: "orgUnit", message: "Required." }],
      );
      const refs = await detailsOf(
        f.manager,
        form({
          eligibility: {
            departments: [f.cse._id, newId()],
            badges: [newId(), f.badge._id, "3d-printing"],
          },
        }),
      );
      assert.deepEqual(refs, [
        { path: "eligibility.departments.1", message: "No such department." },
        { path: "eligibility.badges.0", message: "No such badge." },
        { path: "eligibility.badges.2", message: "Must be a valid id." },
      ]);
      assert.equal(await Resource.countDocuments(), 2);
    });

    test("model validation errors come back as 400 field errors", async () => {
      const err = await refused(
        createResource(
          f.manager._id,
          form({
            title: "ab",
            quantity: 0,
            availability: {
              weekly: [{ day: 1, open: "17:00", close: "09:00" }],
            },
          }),
        ),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(pathsOf(err), [
        "availability.weekly.0.close",
        "quantity",
        "title",
      ]);
      assert.equal(err.message, "3 fields are invalid.");
      assert.equal(await Resource.countDocuments(), 2);
    });

    test("fields outside the form are refused, not dropped", async () => {
      const err = await refused(
        createResource(
          f.manager._id,
          form({ status: "archived", createdBy: f.student._id, slug: "mine" }),
        ),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(err.details, [
        {
          path: "status",
          message:
            "Change the status with the status action, which asks for a reason.",
        },
        { path: "createdBy", message: "This field can't be set." },
        { path: "slug", message: "This field can't be set." },
      ]);
      await refused(
        createResource(f.manager._id, ["not", "a", "form"]),
        400,
        "VALIDATION_ERROR",
      );
    });
  });

  describe("updateResource", () => {
    test("changes only the keys a section names, audits before and after, and drops the cached detail", async () => {
      await getResource(f.student._id, f.printer._id); // cached
      const updated = await updateResource(
        f.manager._id,
        f.printer._id,
        {
          title: "Prusa MK4 3D Printer (Bay 2)",
          limits: { maxHoursPerWeek: 8 },
        },
        { requestId: "req-update" },
      );
      assert.equal(updated.canManage, true);
      assert.deepEqual(updated.limits, {
        minDurationMins: 30,
        maxDurationMins: 240,
        maxHoursPerWeek: 8,
        maxActiveBookings: 1,
        leadTimeMins: 120,
        maxAdvanceDays: 14,
      });

      const [entry] = await audits("resource.updated");
      assert.deepEqual(entry.actor, { id: f.manager._id, role: "manager" });
      assert.equal(entry.requestId, "req-update");
      assert.deepEqual(Object.keys(entry.changes).sort(), ["limits", "title"]);
      assert.deepEqual(entry.changes.title, [
        "Prusa MK4 3D Printer",
        "Prusa MK4 3D Printer (Bay 2)",
      ]);
      const [before, after] = entry.changes.limits;
      assert.equal(before.maxHoursPerWeek, 6);
      assert.equal(after.maxHoursPerWeek, 8);
      assert.equal(after.maxActiveBookings, 1);

      assert.equal(
        (await getResource(f.student._id, f.printer._id)).title,
        "Prusa MK4 3D Printer (Bay 2)",
      );
    });

    test("arrays are replaced whole and the rest of the section is kept", async () => {
      const updated = await updateResource(f.manager._id, f.printer._id, {
        availability: { weekly: [{ day: 2, open: "10:00", close: "12:00" }] },
        checklist: ["Nozzle clean"],
      });
      assert.deepEqual(updated.availability.weekly, [
        { day: 2, open: "10:00", close: "12:00" },
      ]);
      assert.equal(updated.availability.slotMinutes, 30);
      assert.equal(updated.openHours, "Tue 10:00–12:00");
      assert.deepEqual(updated.checklist, ["Nozzle clean"]);
    });

    test("orgUnit, status and server-owned fields can't be changed", async () => {
      const patches = [
        [{ orgUnit: f.cse._id }, "orgUnit"],
        [{ status: "archived" }, "status"],
        [{ createdBy: f.student._id }, "createdBy"],
        [{ slug: "mine" }, "slug"],
        [{ _id: newId() }, "_id"],
        [{ limits: { unlimited: true } }, "limits.unlimited"],
        [{ limits: 8 }, "limits"],
      ];
      for (const [patch, path] of patches) {
        const err = await refused(
          updateResource(f.manager._id, f.printer._id, patch),
          400,
          "VALIDATION_ERROR",
        );
        assert.deepEqual(pathsOf(err), [path]);
      }
      const saved = await Resource.findById(f.printer._id).lean();
      assert.equal(String(saved.orgUnit), String(f.dic._id));
      assert.equal(saved.status, "active");
      assert.equal(saved.createdBy, undefined);
      assert.equal(await AuditLog.countDocuments(), 0);
    });

    test("model validation errors are 400 field errors and nothing is saved", async () => {
      const detailsOf = async (patch) =>
        (
          await refused(
            updateResource(f.manager._id, f.printer._id, patch),
            400,
            "VALIDATION_ERROR",
          )
        ).details;
      assert.deepEqual(pathsOf({ details: await detailsOf({ quantity: 0 }) }), [
        "quantity",
      ]);
      assert.deepEqual(
        await detailsOf({
          availability: {
            weekly: [{ day: 1, open: "17:00", close: "09:00" }],
          },
        }),
        [
          {
            path: "availability.weekly.0.close",
            message: "close must be after open",
          },
        ],
      );
      assert.deepEqual(await detailsOf({ limits: { minDurationMins: 300 } }), [
        {
          path: "limits.minDurationMins",
          message: "Minimum duration can't exceed the maximum",
        },
      ]);
      assert.deepEqual(await detailsOf({ quantity: "lots" }), [
        { path: "quantity", message: "Must be a number." },
      ]);
      assert.deepEqual(
        await detailsOf({ eligibility: { badges: [newId()] } }),
        [{ path: "eligibility.badges.0", message: "No such badge." }],
      );
      const saved = await Resource.findById(f.printer._id).lean();
      assert.equal(saved.quantity, 1);
      assert.equal(saved.limits.minDurationMins, 30);
      assert.equal(saved.availability.weekly.length, 6);
      assert.equal(await AuditLog.countDocuments(), 0);
    });

    test("only the unit's managers and admins can edit; an admin is audited as admin", async () => {
      const patch = { usageRules: "Stay with your print." };
      for (const who of [f.cseManager, f.student])
        await refused(
          updateResource(who._id, f.printer._id, patch),
          403,
          "FORBIDDEN",
        );
      await refused(
        updateResource(DEMO_ID, f.printer._id, patch),
        404,
        "NOT_FOUND",
      );
      await refused(
        updateResource(f.manager._id, DEMO_ID, patch),
        404,
        "NOT_FOUND",
      );
      await updateResource(f.admin._id, f.printer._id, patch);
      const [entry] = await audits("resource.updated");
      assert.equal(entry.actor.role, "admin");
      assert.deepEqual(entry.changes, {
        usageRules: [null, "Stay with your print."],
      });
    });

    test("null or misshapen list entries and keys inside a list are refused", async () => {
      const window = { day: 1, open: "09:00", close: "12:00" };
      const closure = {
        start: ist("2026-11-03T12:00"),
        end: ist("2026-11-03T13:00"),
      };
      const cases = [
        [
          { availability: { weekly: [null] } },
          [{ path: "availability.weekly.0", message: "Must be an object." }],
        ],
        [
          { availability: { weekly: [window, "09:00-17:00"] } },
          [{ path: "availability.weekly.1", message: "Must be an object." }],
        ],
        [
          { availability: { "weekly.0": null } },
          [
            {
              path: "availability.weekly.0",
              message: "This field can't be set.",
            },
          ],
        ],
        [
          { availability: { "weekly.40": window } },
          [
            {
              path: "availability.weekly.40",
              message: "This field can't be set.",
            },
          ],
        ],
        [
          { availability: { "blackouts.3": closure } },
          [
            {
              path: "availability.blackouts.3",
              message: "This field can't be set.",
            },
          ],
        ],
        [
          { availability: { blackouts: [closure, null] } },
          [{ path: "availability.blackouts.1", message: "Must be an object." }],
        ],
        [
          { availability: { weekly: window } },
          [{ path: "availability.weekly", message: "Must be a list." }],
        ],
        [
          { checklist: [null, "Nozzle clean", 7] },
          [
            { path: "checklist.0", message: "Must be text." },
            { path: "checklist.2", message: "Must be text." },
          ],
        ],
        [
          { images: [null] },
          [{ path: "images.0", message: "Must be an object." }],
        ],
        // Holes in a sparse list (from an internal caller; JSON has none).
        [
          { checklist: Object.assign([], { 1: "Nozzle clean" }) },
          [{ path: "checklist.0", message: "Must be text." }],
        ],
        [
          { eligibility: { badges: Object.assign([], { 1: f.badge._id }) } },
          [{ path: "eligibility.badges.0", message: "Must be a valid id." }],
        ],
      ];
      for (const [patch, details] of cases) {
        const err = await refused(
          updateResource(f.manager._id, f.printer._id, patch),
          400,
          "VALIDATION_ERROR",
        );
        assert.deepEqual(err.details, details, JSON.stringify(patch));
      }
      await refused(
        createResource(f.manager._id, {
          orgUnit: f.dic._id,
          title: "Soldering Station",
          category: "tool",
          availability: { weekly: [null] },
        }),
        400,
        "VALIDATION_ERROR",
      );

      const saved = await Resource.findById(f.printer._id).lean();
      assert.equal(saved.availability.weekly.length, 6);
      assert.equal(saved.availability.weekly.includes(null), false);
      assert.deepEqual(saved.checklist, [
        "Nozzle clean",
        "Build plate undamaged",
      ]);
      assert.equal(await AuditLog.countDocuments(), 0);
      // Every read that summarises open hours still works.
      assert.equal((await list(f.student)).meta.total, 2);
      assert.equal(
        (await getResource(f.student._id, f.printer._id)).openHours,
        "Mon–Sat 09:00–17:00",
      );
      await getAvailability(f.printer._id, {
        from: ist("2026-11-03T00:00"),
        to: ist("2026-11-04T00:00"),
      });
    });

    test("keys inside an id list can't skip the existence check or reach the database", async () => {
      const ghost = newId();
      const err = await refused(
        updateResource(f.manager._id, f.printer._id, {
          eligibility: { "badges.0": ghost, "departments.0": ghost },
        }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(err.details, [
        { path: "eligibility.badges.0", message: "This field can't be set." },
        {
          path: "eligibility.departments.0",
          message: "This field can't be set.",
        },
      ]);
      const positional = await refused(
        updateResource(f.manager._id, f.printer._id, {
          eligibility: { "badges.$": f.badge._id },
        }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(pathsOf(positional), ["eligibility.badges.$"]);
      const saved = await Resource.findById(f.printer._id).lean();
      assert.deepEqual(saved.eligibility.badges.map(String), [
        String(f.badge._id),
      ]);
      assert.deepEqual(saved.eligibility.departments, []);
    });

    test("null clears a list to empty, so the member-type filter still finds it", async () => {
      await updateResource(f.manager._id, f.kits._id, {
        eligibility: { memberTypes: null },
        checklist: null,
        images: null,
      });
      const saved = await Resource.findById(f.kits._id).lean();
      assert.deepEqual(saved.eligibility.memberTypes, []);
      assert.deepEqual(saved.checklist, []);
      assert.deepEqual(saved.images, []);
      assert.deepEqual(titles(await list(f.student, { memberType: "ug" })), [
        "Arduino IoT Kit",
        "Prusa MK4 3D Printer",
      ]);

      // A null written some other way is read as "open to all" by the engine, so the filter agrees.
      await Resource.collection.updateOne(
        { _id: f.kits._id },
        { $set: { "eligibility.memberTypes": null } },
      );
      assert.deepEqual(titles(await list(f.student, { memberType: "staff" })), [
        "Arduino IoT Kit",
      ]);
    });

    test("resending the same closures changes nothing and isn't audited", async () => {
      const closure = {
        start: ist("2026-11-03T12:00"),
        end: ist("2026-11-03T13:00"),
        reason: "Fire drill",
      };
      await updateResource(f.manager._id, f.printer._id, {
        availability: { blackouts: [closure] },
      });
      const first = await Resource.findById(f.printer._id).lean();
      const version = await redis.get(keys.cacheVersion("resources"));
      await getResource(f.student._id, f.printer._id); // cached

      // What a listing form sends back: the same closure, without its _id.
      await updateResource(f.manager._id, f.printer._id, {
        availability: { blackouts: [{ ...closure }], slotMinutes: 30 },
      });
      assert.equal((await audits("resource.updated")).length, 1);
      assert.equal(await redis.get(keys.cacheVersion("resources")), version);
      assert.notEqual(
        await redis.get(keys.resourceDetail(f.printer._id)),
        null,
      );
      const second = await Resource.findById(f.printer._id).lean();
      assert.equal(
        String(second.availability.blackouts[0]._id),
        String(first.availability.blackouts[0]._id),
      );
      assert.equal(+second.updatedAt, +first.updatedAt);

      // A real change to a closure is still a change.
      await updateResource(f.manager._id, f.printer._id, {
        availability: { blackouts: [{ ...closure, reason: "Exam hall" }] },
      });
      const entries = await audits("resource.updated");
      assert.equal(entries.length, 2);
      const [before, after] = entries[1].changes.availability;
      assert.equal(before.blackouts[0].reason, "Fire drill");
      assert.equal(after.blackouts[0].reason, "Exam hall");
    });

    test("a patch that changes nothing writes nothing and isn't audited", async () => {
      const result = await updateResource(f.manager._id, f.printer._id, {
        title: "Prusa MK4 3D Printer",
        limits: { maxHoursPerWeek: 6 },
      });
      assert.equal(result.title, "Prusa MK4 3D Printer");
      assert.equal(await AuditLog.countDocuments(), 0);
      const saved = await Resource.findById(f.printer._id).lean();
      assert.equal(+saved.updatedAt, +f.printer.updatedAt);
    });
  });

  describe("setResourceStatus", () => {
    test("maintenance needs a reason, is audited, and counts the bookings still ahead", async () => {
      await bookAs(f.student, f.printer, TUE);
      await bookAs(f.student2, f.printer, WED);
      // Neither is ahead and holding the slot.
      await rawBooking(
        f.student3,
        f.printer,
        { start: ist("2026-10-30T10:00"), end: ist("2026-10-30T12:00") },
        "completed",
      );
      await rawBooking(f.student3, f.printer, TUE_LATER, "cancelled");
      assert.ok(titles(await list(f.student)).includes("Prusa MK4 3D Printer"));

      const noReason = await refused(
        setResourceStatus(f.manager._id, f.printer._id, {
          status: "maintenance",
          reason: "  ",
        }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(pathsOf(noReason), ["reason"]);

      const result = await setResourceStatus(
        f.manager._id,
        f.printer._id,
        { status: "maintenance", reason: " Replacing the hotend " },
        { requestId: "req-status", now: NOW },
      );
      assert.equal(result.affectedBookings, 2);
      assert.equal(result.resource.status, "maintenance");
      assert.equal(result.resource.canManage, true);

      const [entry] = await audits("resource.status_changed");
      assert.deepEqual(entry.actor, { id: f.manager._id, role: "manager" });
      assert.equal(entry.reason, "Replacing the hotend");
      assert.deepEqual(entry.changes, { status: ["active", "maintenance"] });
      assert.deepEqual(entry.meta, { affectedBookings: 2 });
      assert.equal(entry.requestId, "req-status");

      // Nothing is cancelled for the managers, and members stop seeing it at once.
      assert.equal(await Booking.countDocuments({ status: "pending" }), 2);
      assert.ok(
        !titles(await list(f.student)).includes("Prusa MK4 3D Printer"),
      );
    });

    test("back to active needs no reason, and the same status again is a no-op", async () => {
      await setResourceStatus(f.manager._id, f.printer._id, {
        status: "maintenance",
        reason: "Replacing the hotend",
      });
      const back = await setResourceStatus(f.admin._id, f.printer._id, {
        status: "active",
      });
      assert.equal(back.resource.status, "active");
      const entries = await audits("resource.status_changed");
      assert.deepEqual(
        entries.map((e) => e.changes.status),
        [
          ["active", "maintenance"],
          ["maintenance", "active"],
        ],
      );
      assert.equal(entries[1].actor.role, "admin");
      assert.equal(entries[1].reason, undefined);

      await setResourceStatus(f.manager._id, f.printer._id, {
        status: "active",
      });
      assert.equal(await AuditLog.countDocuments(), 2);
    });

    test("bad values are 400s; other units' managers and members are refused", async () => {
      const set = (who, input, id = f.printer._id) =>
        setResourceStatus(who._id, id, input);
      const bad = await refused(
        set(f.manager, { status: "broken", reason: "Something happened" }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(pathsOf(bad), ["status"]);
      await refused(set(f.manager, {}), 400, "VALIDATION_ERROR");
      await refused(
        set(f.manager, { status: "maintenance", reason: "x".repeat(501) }),
        400,
        "VALIDATION_ERROR",
      );
      await refused(
        set(f.manager, { status: "maintenance", reason: { $ne: "" } }),
        400,
        "VALIDATION_ERROR",
      );
      for (const who of [f.student, f.cseManager])
        await refused(
          set(who, { status: "maintenance", reason: "Taking it offline" }),
          403,
          "FORBIDDEN",
        );
      await refused(
        setResourceStatus(f.manager._id, DEMO_ID, { status: "active" }),
        404,
        "NOT_FOUND",
      );
      assert.equal((await Resource.findById(f.printer._id)).status, "active");

      await set(f.manager, { status: "archived", reason: "Replaced by MK5" });
      await refused(set(f.cseManager, { status: "active" }), 404, "NOT_FOUND");
    });
  });

  describe("listResourceBookings", () => {
    test("the unit's managers see borrowers' name, member type and department, never email", async () => {
      await bookAs(f.student, f.printer, TUE);
      await bookAs(f.student2, f.printer, WED);
      const result = await listResourceBookings(f.manager._id, f.printer._id);
      assert.deepEqual(result.meta, { page: 1, limit: 20, total: 2 });
      assert.deepEqual(
        result.items.map((b) => b.borrower.name),
        ["Ananya Rao", "Kabir Singh"],
      );
      const { borrower } = result.items[0];
      assert.deepEqual(Object.keys(borrower).sort(), [
        "_id",
        "department",
        "memberType",
        "name",
      ]);
      assert.deepEqual(borrower.memberType, "ug");
      assert.equal(borrower.department.code, "cse");
      assert.equal(JSON.stringify(result).includes("@"), false);

      const query = (q) =>
        listResourceBookings(f.manager._id, f.printer._id, q);
      assert.equal((await query({ status: "approved" })).meta.total, 0);
      assert.deepEqual(
        (await query({ from: ist("2026-11-04T00:00") })).items.map(
          (b) => b.borrower.name,
        ),
        ["Kabir Singh"],
      );
      const second = await query({ limit: 1, page: 2 });
      assert.deepEqual(
        second.items.map((b) => b.borrower.name),
        ["Kabir Singh"],
      );
      assert.equal(second.meta.total, 2);
      const bad = await refused(
        query({ status: "lost", from: "soon" }),
        400,
        "VALIDATION_ERROR",
      );
      assert.deepEqual(pathsOf(bad), ["status", "from"]);
    });

    test("other units' managers and members are refused; admins see every unit", async () => {
      await bookAs(f.student, f.printer, TUE);
      for (const who of [f.cseManager, f.student])
        await refused(
          listResourceBookings(who._id, f.printer._id),
          403,
          "FORBIDDEN",
        );
      await refused(
        listResourceBookings(f.manager._id, DEMO_ID),
        404,
        "NOT_FOUND",
      );
      assert.equal(
        (await listResourceBookings(f.admin._id, f.printer._id)).meta.total,
        1,
      );
    });
  });
});
