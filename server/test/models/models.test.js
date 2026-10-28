import { describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
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
import { STATUSES } from "../../src/engines/stateMachine.js";

// No database needed: validate() runs the same validators and pre("validate") hooks as save(),
// and the audit-log hooks throw before a query would wait for a connection.
mongoose.set("bufferTimeoutMS", 200);

const id = () => new mongoose.Types.ObjectId();
const ist = (s) => new Date(`${s}:00+05:30`);
const errorPaths = (doc) =>
  doc.validate().then(
    () => [],
    (err) => Object.keys(err.errors ?? {}).sort(),
  );
const indexKeys = (model) => model.schema.indexes().map(([keys]) => keys);

const validUser = (extra = {}) =>
  new User({
    name: "Test Student",
    email: "  2024UGCS999@nitjsr.ac.in ",
    passwordHash: "$2b$12$abcdefghijklmnopqrstuv",
    ...extra,
  });

const validResource = (extra = {}) =>
  new Resource({
    orgUnit: id(),
    title: "Prusa MK4 3D Printer",
    category: "equipment",
    availability: {
      weekly: [{ day: 1, open: "09:00", close: "17:00" }],
      blackouts: [],
    },
    limits: { minDurationMins: 30, maxDurationMins: 240 },
    checklist: ["Nozzle clean", "Build plate undamaged"],
    ...extra,
  });

describe("User", () => {
  test("applies the documented defaults and normalises the email", async () => {
    const user = validUser();
    assert.deepEqual(await errorPaths(user), []);
    assert.equal(user.email, "2024ugcs999@nitjsr.ac.in");
    assert.deepEqual([...user.roles], ["member"]);
    assert.equal(user.verification.status, "unsubmitted");
    assert.equal(user.emailVerified, false);
    assert.equal(user.strikes, 0);
    assert.equal(user.suspendedUntil, null);
    assert.equal(user.notificationPrefs.email, true);
  });

  test("rejects unknown roles and member types, and empty role lists", async () => {
    assert.deepEqual(
      await errorPaths(
        validUser({ roles: ["superuser"], memberType: "alumni" }),
      ),
      ["memberType", "roles.0"],
    );
    assert.deepEqual(await errorPaths(validUser({ roles: [] })), ["roles"]);
  });

  test("toJSON never exposes the password hash or the ID-card asset", async () => {
    const user = validUser({
      verification: { status: "pending", idCardPublicId: "idcards/abc" },
    });
    const json = user.toJSON();
    assert.equal(json.passwordHash, undefined);
    assert.equal(json.verification.idCardPublicId, undefined);
    assert.equal(json.verification.status, "pending");
    assert.equal(json.__v, undefined);
  });

  test("password hash and ID-card asset are excluded from queries by default", async () => {
    assert.equal(User.schema.path("passwordHash").options.select, false);
    assert.equal(
      User.schema.path("verification.idCardPublicId").options.select,
      false,
    );
  });
});

describe("OrgUnit and Badge", () => {
  test("codes are lower-case slugs", async () => {
    const unit = new OrgUnit({
      name: "Design and Innovation Centre",
      code: "DIC",
      type: "centre",
    });
    assert.deepEqual(await errorPaths(unit), []);
    assert.equal(unit.code, "dic");
    assert.deepEqual(
      await errorPaths(
        new OrgUnit({ name: "Bad", code: "has space", type: "lab" }),
      ),
      ["code", "type"],
    );
  });

  test("a badge never expires unless validityDays is set", async () => {
    const badge = new Badge({
      name: "3D Printing Basics",
      code: "3d-printing-basics",
      orgUnit: id(),
    });
    assert.deepEqual(await errorPaths(badge), []);
    assert.equal(badge.validityDays, null);
    assert.deepEqual(
      await errorPaths(
        new Badge({ ...badge.toObject(), _id: id(), validityDays: 1.5 }),
      ),
      ["validityDays"],
    );
  });
});

describe("Resource", () => {
  test("valid listing gets defaults and a unique slug", async () => {
    const resource = validResource();
    assert.deepEqual(await errorPaths(resource), []);
    assert.match(resource.slug, /^prusa-mk4-3d-printer-[a-f\d]{6}$/);
    assert.equal(resource.bookingMode, "slot");
    assert.equal(resource.quantity, 1);
    assert.equal(resource.status, "active");
    assert.equal(resource.eligibility.approvalMode, "manual");
    assert.equal(resource.availability.slotMinutes, 30);
  });

  test("opening windows must open before they close, with HH:mm times", async () => {
    const resource = validResource({
      availability: {
        weekly: [
          { day: 1, open: "17:00", close: "09:00" },
          { day: 7, open: "9am", close: "17:00" },
        ],
      },
    });
    assert.deepEqual(await errorPaths(resource), [
      "availability.weekly.0.close",
      "availability.weekly.1.day",
      "availability.weekly.1.open",
    ]);
  });

  test("blackouts must end after they start", async () => {
    const resource = validResource({
      availability: {
        weekly: [],
        blackouts: [
          { start: ist("2026-11-03T12:00"), end: ist("2026-11-03T11:00") },
        ],
      },
    });
    assert.deepEqual(await errorPaths(resource), [
      "availability.blackouts.0.end",
    ]);
  });

  test("limits are whole numbers and the minimum can't exceed the maximum", async () => {
    assert.deepEqual(
      await errorPaths(
        validResource({
          limits: { minDurationMins: 300, maxDurationMins: 240 },
        }),
      ),
      ["limits.minDurationMins"],
    );
    assert.deepEqual(await errorPaths(validResource({ quantity: 1.5 })), [
      "quantity",
    ]);
  });

  test("checklist is capped at 10 items and categories are enforced", async () => {
    const checklist = Array.from({ length: 11 }, (_, i) => `Item ${i + 1}`);
    assert.deepEqual(
      await errorPaths(validResource({ checklist, category: "vehicle" })),
      ["category", "checklist"],
    );
  });

  test("declares the search and filter indexes", async () => {
    const keys = indexKeys(Resource);
    assert.ok(keys.some((k) => k.title === "text" && k.description === "text"));
    assert.ok(keys.some((k) => k.orgUnit === 1 && k.status === 1));
    assert.ok(keys.some((k) => k.category === 1 && k.status === 1));
  });
});

describe("Booking", () => {
  const validBooking = (extra = {}) =>
    new Booking({
      resource: id(),
      orgUnit: id(),
      borrower: id(),
      start: ist("2026-11-03T10:00"),
      end: ist("2026-11-03T12:00"),
      purpose: "Printing parts for the robotics club",
      ...extra,
    });

  test("starts pending and only accepts state-machine statuses", async () => {
    const booking = validBooking();
    assert.deepEqual(await errorPaths(booking), []);
    assert.equal(booking.status, "pending");
    assert.equal(booking.flags.overdue, false);
    assert.deepEqual(Booking.schema.path("status").enumValues, STATUSES);
    assert.deepEqual(await errorPaths(validBooking({ status: "overdue" })), [
      "status",
    ]);
  });

  test("end must be after start, and purpose is 10–300 characters", async () => {
    assert.deepEqual(
      await errorPaths(
        validBooking({ end: ist("2026-11-03T10:00"), purpose: "print" }),
      ),
      ["end", "purpose"],
    );
  });

  test("declares the overlap, quota, queue and sweeper indexes", async () => {
    const keys = indexKeys(Booking).map((k) => Object.keys(k).join(","));
    for (const expected of [
      "resource,status,start,end",
      "borrower,status,start",
      "orgUnit,status,createdAt",
      "status,start",
      "status,end",
    ]) {
      assert.ok(keys.includes(expected), expected);
    }
  });
});

describe("UserBadge and ConditionReport", () => {
  test("one row per user and badge; one report per booking phase", async () => {
    const [, ubOptions] = UserBadge.schema
      .indexes()
      .find(([k]) => k.user === 1 && k.badge === 1);
    assert.equal(ubOptions.unique, true);
    const [, crOptions] = ConditionReport.schema
      .indexes()
      .find(([k]) => k.booking === 1 && k.phase === 1);
    assert.equal(crOptions.unique, true);
  });

  test("a condition report allows at most 3 photos", async () => {
    const photo = {
      url: "https://res.cloudinary.com/demo/p.jpg",
      publicId: "reports/p",
    };
    const report = new ConditionReport({
      booking: id(),
      resource: id(),
      phase: "check_in",
      items: [{ label: "Nozzle clean", ok: true }],
      photos: [photo, photo, photo, photo],
      overall: "good",
      submittedBy: id(),
    });
    assert.deepEqual(await errorPaths(report), ["photos"]);
  });
});

describe("Incident", () => {
  const validIncident = (extra = {}) =>
    new Incident({
      resource: id(),
      orgUnit: id(),
      reportedBy: id(),
      source: "manager",
      type: "damage",
      severity: "medium",
      description: "Build plate scratched near the front edge.",
      ...extra,
    });

  test("only the system may raise an incident without a reporter", async () => {
    assert.deepEqual(await errorPaths(validIncident({ reportedBy: null })), [
      "reportedBy",
    ]);
    assert.deepEqual(
      await errorPaths(
        validIncident({ reportedBy: null, source: "system", type: "delay" }),
      ),
      [],
    );
  });

  test("resolving needs a human decision with a rationale", async () => {
    assert.deepEqual(await errorPaths(validIncident({ status: "resolved" })), [
      "resolution.decidedBy",
      "resolution.outcome",
      "resolution.rationale",
    ]);
    const resolved = validIncident({
      status: "resolved",
      resolution: {
        outcome: "warning",
        rationale: "Minor wear, borrower informed.",
        decidedBy: id(),
        at: new Date(),
      },
    });
    assert.deepEqual(await errorPaths(resolved), []);
  });
});

describe("Notification", () => {
  const notification = (link) =>
    new Notification({
      user: id(),
      type: "booking.approved",
      title: "Booking approved",
      link,
    });

  test("links must be in-app paths", async () => {
    assert.deepEqual(await errorPaths(notification("/bookings/123")), []);
    for (const link of [
      "https://evil.example",
      "//evil.example",
      "javascript:alert(1)",
    ]) {
      assert.deepEqual(await errorPaths(notification(link)), ["link"], link);
    }
  });

  test("expires after 60 days", async () => {
    const [, options] = Notification.schema
      .indexes()
      .find(([k]) => k.createdAt === 1);
    assert.equal(options.expireAfterSeconds, 60 * 24 * 60 * 60);
  });
});

describe("AuditLog", () => {
  const entry = (extra = {}) =>
    new AuditLog({
      actor: { id: id(), role: "manager" },
      action: "booking.rejected",
      entity: { type: "booking", id: id() },
      reason: "Printer reserved for the M.Des jury",
      changes: { status: ["pending", "rejected"] },
      ...extra,
    });

  test("validates the entity.verb action format and the nested entity", async () => {
    assert.deepEqual(await errorPaths(entry()), []);
    assert.equal(entry().entity.type, "booking");
    assert.deepEqual(
      await errorPaths(
        entry({ action: "Rejected booking", entity: { type: "booking" } }),
      ),
      ["action", "entity.id"],
    );
  });

  test("system entries have no actor id", async () => {
    const system = entry({
      actor: { role: "system" },
      action: "booking.no_show",
    });
    assert.deepEqual(await errorPaths(system), []);
    assert.equal(system.actor.id, null);
  });

  test("every update and delete path is refused", async () => {
    const attempts = {
      updateOne: () => AuditLog.updateOne({}, { reason: "edited" }),
      updateMany: () => AuditLog.updateMany({}, { reason: "edited" }),
      findOneAndUpdate: () =>
        AuditLog.findOneAndUpdate({}, { reason: "edited" }),
      replaceOne: () => AuditLog.replaceOne({}, {}),
      findOneAndReplace: () => AuditLog.findOneAndReplace({}, {}),
      deleteOne: () => AuditLog.deleteOne({}),
      deleteMany: () => AuditLog.deleteMany({}),
      findOneAndDelete: () => AuditLog.findOneAndDelete({}),
      bulkWrite: () => AuditLog.bulkWrite([{ deleteOne: { filter: {} } }]),
      "document save": () => {
        const existing = AuditLog.hydrate(entry().toObject());
        existing.reason = "edited";
        return existing.save();
      },
      "document deleteOne": () =>
        AuditLog.hydrate(entry().toObject()).deleteOne(),
      "document updateOne": () =>
        AuditLog.hydrate(entry().toObject()).updateOne({ reason: "edited" }),
    };
    for (const [name, attempt] of Object.entries(attempts)) {
      await assert.rejects(attempt, /append-only/, name);
    }
  });

  test("declares the timeline, unit and actor indexes", async () => {
    const keys = indexKeys(AuditLog).map((k) => Object.keys(k).join(","));
    assert.deepEqual(keys, [
      "entity.type,entity.id,at",
      "orgUnit,at",
      "actor.id,at",
    ]);
  });
});
