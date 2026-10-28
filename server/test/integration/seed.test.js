// The seed script (scripts/seed.js, backend.md §9) against a real MongoDB; see fixtures.js for how
// to run it. The expected tables below are copied from backend.md §9 and architecture.md §1.2, not
// from seedData.js, so a slip in the data shows up here.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { keys } from "../../src/lib/redisKeys.js";
import { DAY } from "../../src/lib/time.js";
import {
  AuditLog,
  Badge,
  Booking,
  OrgUnit,
  Resource,
  User,
  UserBadge,
} from "../../src/models/index.js";
import { managesUnit } from "../../src/services/access.js";
import { checkBooking } from "../../src/services/bookingService.js";
import { setOrgUnitManagers } from "../../src/services/orgUnitService.js";
import { passwordProblem, seed } from "../../scripts/seed.js";
import {
  NOW,
  TUE,
  ist,
  plus,
  redis,
  skip,
  useTestDatabase,
} from "./fixtures.js";

const PASSWORD = "Judge-demo-2026";
const SEED_SCRIPT = fileURLToPath(
  new URL("../../scripts/seed.js", import.meta.url),
);
const quiet = { info() {}, warn() {}, error() {} };
const run = (options = {}) =>
  seed({ password: PASSWORD, log: quiet, now: NOW, ...options });

const email = (login) => `${login}@demo.campuscommons.test`;
const ids = (list) => (list ?? []).map(String).sort();
const codesOf = async (unitIds) =>
  (await OrgUnit.find({ _id: { $in: unitIds } }, { code: 1 }).lean())
    .map((u) => u.code)
    .sort();
const userBy = (login) =>
  User.findOne({ email: email(login) })
    .select("+passwordHash")
    .lean();
const unitBy = (code) => OrgUnit.findOne({ code }).lean();
const resourceBy = (title) => Resource.findOne({ title }).lean();

// Raw driver calls: the AuditLog model refuses deletes by design.
async function clearDatabase() {
  for (const collection of await mongoose.connection.db.collections())
    await collection.deleteMany({});
  await redis.flushall();
}

// As JSON: ObjectIds become hex strings and Dates ISO strings, so two reads compare by value.
const plain = (value) => JSON.parse(JSON.stringify(value));

// Every document in every collection, every field included (password hashes, timestamps).
async function snapshot() {
  const out = {};
  for (const collection of await mongoose.connection.db.collections()) {
    out[collection.collectionName] = plain(
      await collection.find({}).sort({ _id: 1 }).toArray(),
    );
  }
  return out;
}

// User.managedOrgUnits and OrgUnit.managers say the same thing, for every unit.
async function assertManagersInSync() {
  for (const unit of await OrgUnit.find({}).lean()) {
    const holders = await User.find(
      { managedOrgUnits: unit._id },
      { _id: 1 },
    ).lean();
    assert.deepEqual(
      ids(holders.map((u) => u._id)),
      ids(unit.managers),
      `managers of ${unit.code}`,
    );
  }
}

const UNITS = {
  department: [
    "cse",
    "ece",
    "ee",
    "mech",
    "civil",
    "mme",
    "prod",
    "chem",
    "phys",
    "maths",
    "mca",
    "hssm",
  ],
  centre: ["dic", "ciic"],
  central_facility: ["cw", "cc", "lib", "sac"],
};

// backend.md §9: issuer, validity in days ("1 year" = 365, "6 months" = 180), self-serve.
const BADGE_TABLE = {
  "workshop-safety-induction": ["Workshop Safety Induction", "cw", 365, false],
  "3d-printing-basics": ["3D Printing Basics", "dic", 365, false],
  "laser-cutter-operation": ["Laser Cutter Operation", "dic", 180, false],
  "gpu-usage-policy": ["GPU Usage Policy", "cc", 365, true],
  "electronics-lab-safety": ["Electronics Lab Safety", "ece", 365, true],
  "survey-instrument-training": [
    "Survey Instrument Training",
    "civil",
    365,
    false,
  ],
  "drone-flight-safety": ["Drone Flight Safety", "sac", 180, false],
};

const ALL = ["faculty", "pg", "rs", "staff", "ug"];
const SENIOR = ["faculty", "pg", "rs"];
const H = 60;
// backend.md §9: unit, mode, quantity, member types, badges, approval, high risk, then the caps it
// names: max length (minutes), hours a week, active bookings (null where it names none).
const RESOURCE_TABLE = {
  "FDM 3D Printer": [
    "dic",
    "slot",
    1,
    ALL,
    ["3d-printing-basics"],
    "manual",
    false,
    4 * H,
    6,
    1,
  ],
  "CO₂ Laser Cutter": [
    "dic",
    "slot",
    1,
    ALL,
    ["laser-cutter-operation"],
    "manual",
    true,
    2 * H,
    4,
    null,
  ],
  "Centre Lathe": [
    "cw",
    "slot",
    2,
    ALL,
    ["workshop-safety-induction"],
    "manual",
    true,
    3 * H,
    6,
    null,
  ],
  "Arc Welding Bay": [
    "cw",
    "slot",
    1,
    ALL,
    ["workshop-safety-induction"],
    "manual",
    true,
    2 * H,
    null,
    null,
  ],
  "GPU Workstation": [
    "cc",
    "slot",
    2,
    ALL,
    ["gpu-usage-policy"],
    "auto",
    false,
    8 * H,
    16,
    1,
  ],
  "Digital Storage Oscilloscope": [
    "ece",
    "slot",
    3,
    ALL,
    ["electronics-lab-safety"],
    "auto",
    false,
    3 * H,
    null,
    null,
  ],
  "IoT Starter Kit": [
    "cse",
    "loan",
    5,
    ALL,
    [],
    "auto",
    false,
    3 * 24 * H,
    null,
    1,
  ],
  "Total Station": [
    "civil",
    "loan",
    1,
    SENIOR,
    ["survey-instrument-training"],
    "manual",
    false,
    2 * 24 * H,
    null,
    null,
  ],
  "Optical Microscope": [
    "mme",
    "slot",
    1,
    SENIOR,
    [],
    "manual",
    false,
    3 * H,
    null,
    null,
  ],
  "Discussion Room A": [
    "lib",
    "slot",
    1,
    ALL,
    [],
    "auto",
    false,
    2 * H,
    4,
    null,
  ],
  "DSLR Camera Kit": [
    "sac",
    "loan",
    2,
    ALL,
    [],
    "manual",
    false,
    2 * 24 * H,
    null,
    null,
  ],
  "Camera Drone": [
    "sac",
    "loan",
    1,
    ALL,
    ["drone-flight-safety"],
    "manual",
    true,
    24 * H,
    null,
    null,
  ],
  "Meeting Room": [
    "ciic",
    "slot",
    1,
    ALL,
    [],
    "manual",
    false,
    3 * H,
    null,
    null,
  ],
};

// backend.md §9 demo users: roles, member type, department, verification, badges held, units managed.
const USER_TABLE = {
  student: [
    ["member"],
    "ug",
    "cse",
    "approved",
    ["electronics-lab-safety"],
    [],
  ],
  student2: [["member"], "ug", "mech", "approved", ["3d-printing-basics"], []],
  faculty: [["member"], "faculty", "ece", "approved", [], []],
  manager: [
    ["manager", "member"],
    "faculty",
    "mech",
    "approved",
    [],
    ["cw", "dic"],
  ],
  admin: [["admin", "member"], "staff", null, "approved", [], []],
  newstudent: [["member"], "ug", "ee", "pending", [], []],
};

const FRESH = {
  orgUnits: { created: 18, updated: 0, unchanged: 0 },
  badges: { created: 7, updated: 0, unchanged: 0 },
  users: { created: 6, updated: 0, unchanged: 0 },
  managedUnits: { changed: 2, unchanged: 0 },
  resources: { created: 13, updated: 0, unchanged: 0 },
  userBadges: { created: 2, updated: 0, unchanged: 0, removed: 0 },
};
const AGAIN = {
  orgUnits: { created: 0, updated: 0, unchanged: 18 },
  badges: { created: 0, updated: 0, unchanged: 7 },
  users: { created: 0, updated: 0, unchanged: 6 },
  managedUnits: { changed: 0, unchanged: 2 },
  resources: { created: 0, updated: 0, unchanged: 13 },
  userBadges: { created: 0, updated: 0, unchanged: 2, removed: 0 },
};

const heldBadgeCodes = async (user) => {
  const rows = await UserBadge.find({ user: user._id })
    .populate("badge", "code")
    .lean();
  return rows.map((r) => r.badge.code).sort();
};

const failedRules = (evaluation) =>
  evaluation.results.filter((r) => !r.passed).map((r) => r.rule);

describe("seed script", { skip }, () => {
  let f; // fixtures.js data, rebuilt before every test
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  test("an empty database gets the 18 units, 7 badges, 13 resources and 6 demo users", async () => {
    await clearDatabase();
    assert.deepEqual(await run(), FRESH);

    const units = await OrgUnit.find({}).lean();
    assert.equal(units.length, 18);
    for (const [type, codes] of Object.entries(UNITS)) {
      assert.deepEqual(
        units
          .filter((u) => u.type === type)
          .map((u) => u.code)
          .sort(),
        [...codes].sort(),
        type,
      );
    }
    for (const unit of units) {
      assert.match(unit.code, /^[a-z0-9-]{2,20}$/);
      assert.equal(unit.isActive, true);
    }
    assert.equal((await unitBy("dic")).name, "Design and Innovation Centre");

    const badges = await Badge.find({}).populate("orgUnit", "code").lean();
    assert.equal(badges.length, 7);
    for (const badge of badges) {
      const [name, issuer, validityDays, selfServe] = BADGE_TABLE[badge.code];
      assert.deepEqual(
        [badge.name, badge.orgUnit.code, badge.validityDays, badge.selfServe],
        [name, issuer, validityDays, selfServe],
        badge.code,
      );
      assert.equal(badge.evidenceRequired, false);
    }

    const resources = await Resource.find({})
      .populate("orgUnit", "code")
      .populate("eligibility.badges", "code")
      .lean();
    assert.deepEqual(
      resources.map((r) => r.title).sort(),
      Object.keys(RESOURCE_TABLE).sort(),
    );
    for (const r of resources) {
      const [
        unit,
        mode,
        qty,
        types,
        badgeCodes,
        approval,
        high,
        maxMins,
        perWeek,
        active,
      ] = RESOURCE_TABLE[r.title];
      assert.deepEqual(
        [
          r.orgUnit.code,
          r.bookingMode,
          r.quantity,
          [...r.eligibility.memberTypes].sort(),
          r.eligibility.badges.map((b) => b.code),
          r.eligibility.approvalMode,
          r.riskLevel === "high",
          r.limits.maxDurationMins,
          r.limits.maxHoursPerWeek ?? null,
          r.limits.maxActiveBookings ?? null,
        ],
        [
          unit,
          mode,
          qty,
          types,
          badgeCodes,
          approval,
          high,
          maxMins,
          perWeek,
          active,
        ],
        r.title,
      );
      assert.equal(r.status, "active");
    }

    assert.equal(await User.countDocuments(), 6);
    assert.equal(await UserBadge.countDocuments(), 2);
    // Bookings come in a later phase.
    assert.equal(await Booking.countDocuments(), 0);

    // Every seeded document is audited once, as the system, without any value in it.
    const audits = await AuditLog.find({}).lean();
    const perAction = {};
    for (const entry of audits)
      perAction[entry.action] = (perAction[entry.action] ?? 0) + 1;
    assert.deepEqual(perAction, {
      "org_unit.seeded": 18,
      "badge.seeded": 7,
      "user.seeded": 6,
      "org_unit.managers_changed": 2,
      "resource.seeded": 13,
      "user_badge.seeded": 2,
    });
    for (const entry of audits.filter((a) => a.action.endsWith(".seeded")))
      assert.equal(entry.actor.role, "system");
    assert.doesNotMatch(JSON.stringify(audits), /\$2[aby]\$/); // no bcrypt hash
  });

  test("a second run, even a day later, writes nothing: same ids, same fields, same counts", async () => {
    await clearDatabase();
    await run();
    const before = await snapshot();

    assert.deepEqual(await run({ now: plus(NOW, DAY / 60_000) }), AGAIN);
    assert.deepEqual(await snapshot(), before);
  });

  test("demo users have the documented profiles, verified emails and the seed password at cost 12", async () => {
    await clearDatabase();
    await run();

    for (const [
      login,
      [roles, memberType, dept, verification, held, manages],
    ] of Object.entries(USER_TABLE)) {
      const user = await userBy(login);
      assert.ok(user, login);
      assert.deepEqual([...user.roles].sort(), roles, `${login} roles`);
      assert.equal(user.memberType, memberType, login);
      assert.equal(
        user.department ? (await OrgUnit.findById(user.department)).code : null,
        dept,
        login,
      );
      assert.equal(user.emailVerified, true, login);
      assert.equal(user.verification.status, verification, login);
      assert.deepEqual(await heldBadgeCodes(user), held, `${login} badges`);
      assert.deepEqual(await codesOf(user.managedOrgUnits), manages, login);
      assert.equal(user.strikes, 0);
      assert.equal(user.suspendedUntil, null);

      assert.equal(bcrypt.getRounds(user.passwordHash), 12, login);
      assert.equal(await bcrypt.compare(PASSWORD, user.passwordHash), true);
      assert.equal(
        await bcrypt.compare("Wrong-pass-1", user.passwordHash),
        false,
      );
    }

    // The admin's verification queue has one entry, waiting since the seed ran.
    const pending = await User.find({
      "verification.status": "pending",
    }).lean();
    assert.deepEqual(
      pending.map((u) => u.email),
      [email("newstudent")],
    );
    assert.deepEqual(pending[0].verification.submittedAt, NOW);

    // Holdings are active grants that run for the badge's validity from the seed's `now`.
    const holding = await UserBadge.findOne({
      user: (await userBy("student"))._id,
    }).lean();
    assert.equal(holding.status, "active");
    assert.deepEqual(holding.expiresAt, new Date(NOW.getTime() + 365 * DAY));
  });

  test("the manager manages DIC and Central Workshop, and every unit's list agrees with its users", async () => {
    await clearDatabase();
    await run();

    const manager = await userBy("manager");
    const [dic, cw] = [await unitBy("dic"), await unitBy("cw")];
    assert.deepEqual(ids(dic.managers), [String(manager._id)]);
    assert.deepEqual(ids(cw.managers), [String(manager._id)]);
    assert.ok(managesUnit(manager, dic._id));
    assert.ok(managesUnit(manager, cw._id));
    assert.ok(!managesUnit(manager, (await unitBy("cse"))._id));
    await assertManagersInSync();

    // Assigned through the service, so the audit log shows it, by the admin.
    const admin = await userBy("admin");
    const changes = await AuditLog.find({
      action: "org_unit.managers_changed",
    }).lean();
    assert.deepEqual(
      ids(changes.map((c) => c.entity.id)),
      ids([dic._id, cw._id]),
    );
    for (const entry of changes) {
      assert.deepEqual(
        plain(entry.actor),
        plain({ id: admin._id, role: "admin" }),
      );
    }
  });

  test("every resource passes model validation, and its rules name existing badges and units", async () => {
    await clearDatabase();
    await run();
    const admin = await userBy("admin");

    for (const resource of await Resource.find({})) {
      await resource.validate(); // throws on any schema problem
      const r = resource.toObject();
      assert.ok(r.slug, r.title);
      assert.ok(r.description && r.usageRules, r.title);
      assert.ok(r.location.building && r.location.room, r.title);
      assert.ok(
        r.checklist.length >= 2 && r.checklist.length <= 5,
        `${r.title} checklist`,
      );
      assert.ok(r.eligibility.memberTypes.length > 0, r.title);
      assert.ok(r.availability.weekly.length > 0, r.title);
      assert.deepEqual(r.availability.blackouts, []);
      // backend.md §7 resources.create: maxHoursPerWeek ≥ maxDuration / 60.
      if (r.limits.maxHoursPerWeek != null) {
        assert.ok(
          r.limits.maxHoursPerWeek >= r.limits.maxDurationMins / 60,
          r.title,
        );
      }
      assert.ok(r.limits.minDurationMins <= r.limits.maxDurationMins);
      assert.equal(String(r.createdBy), String(admin._id));

      assert.ok(await OrgUnit.exists({ _id: r.orgUnit }), r.title);
      assert.equal(
        await Badge.countDocuments({ _id: { $in: r.eligibility.badges } }),
        r.eligibility.badges.length,
        `${r.title} badges`,
      );
      assert.equal(
        await OrgUnit.countDocuments({
          _id: { $in: r.eligibility.departments },
        }),
        r.eligibility.departments.length,
        `${r.title} departments`,
      );
    }
  });

  test("the golden path's eligibility works on the seeded data (frontend.md §11)", async () => {
    await clearDatabase();
    await run();
    const [student, student2, faculty, newstudent] = await Promise.all(
      ["student", "student2", "faculty", "newstudent"].map(userBy),
    );
    const check = async (user, title, slot = TUE) =>
      checkBooking(
        user._id,
        { resourceId: (await resourceBy(title))._id, ...slot },
        { now: NOW },
      );

    // Tomorrow 10:00–12:00 on the printer: the student lacks the badge, student 2 holds it.
    const printer = await check(student, "FDM 3D Printer");
    assert.deepEqual(failedRules(printer), ["BADGES"]);
    assert.match(
      printer.results.find((r) => r.rule === "BADGES").message,
      /Missing badge: 3D Printing Basics/,
    );
    assert.equal((await check(student2, "FDM 3D Printer")).outcome, "pending");
    // The student's Electronics Lab Safety opens the auto-approved oscilloscope.
    assert.equal(
      (await check(student, "Digital Storage Oscilloscope")).outcome,
      "approved",
    );
    // A two-day loan of an IoT kit, picked up and returned in opening hours.
    const loan = { start: TUE.start, end: ist("2026-11-05T10:00") };
    assert.equal(
      (await check(student, "IoT Starter Kit", loan)).outcome,
      "approved",
    );
    // PG / RS / Faculty only: the UG student is turned away, the faculty member only lacks training.
    assert.deepEqual(failedRules(await check(student, "Total Station", loan)), [
      "MEMBER_TYPE",
      "BADGES",
    ]);
    assert.deepEqual(failedRules(await check(faculty, "Total Station", loan)), [
      "BADGES",
    ]);
    assert.equal(
      (await check(faculty, "Optical Microscope")).outcome,
      "pending",
    );
    // The pending verification blocks booking.
    assert.deepEqual(
      failedRules(await check(newstudent, "Discussion Room A")),
      ["ACCOUNT_VERIFIED"],
    );
  });

  test("clears the catalogue caches, every resource list and the seeded resources' details", async () => {
    await clearDatabase();
    await run();
    const printer = await resourceBy("FDM 3D Printer");
    await redis.set(keys.catalogue("orgunits"), "[]");
    await redis.set(keys.catalogue("badges"), "[]");
    await redis.set(keys.resourceDetail(printer._id), "{}");
    const version = Number(await redis.get(keys.cacheVersion("resources")));

    await run();
    assert.equal(await redis.get(keys.catalogue("orgunits")), null);
    assert.equal(await redis.get(keys.catalogue("badges")), null);
    assert.equal(await redis.get(keys.resourceDetail(printer._id)), null);
    assert.equal(
      Number(await redis.get(keys.cacheVersion("resources"))),
      version + 1,
    );
  });

  test("over existing data: adopts matching documents, keeps the rest and keeps the units' real managers", async () => {
    // fixtures.js already holds DIC, CSE, student@, student2@, manager@ and admin@ (same emails as
    // the demo users), plus student3@ and cse-manager@, a badge and two resources that aren't seed
    // data. Ravi (cse-manager) also manages DIC here, next to the demo manager.
    await setOrgUnitManagers(f.admin._id, f.dic._id, [
      f.manager._id,
      f.cseManager._id,
    ]);
    const others = async () => ({
      users: await User.find({ _id: { $in: [f.student3._id] } })
        .select("+passwordHash")
        .lean(),
      resources: await Resource.find({
        _id: { $in: [f.printer._id, f.kits._id] },
      }).lean(),
      rows: await UserBadge.find({ user: f.student3._id }).lean(),
    });
    const before = plain(await others());

    assert.deepEqual(await run(), {
      // DIC and CSE already match the spec.
      orgUnits: { created: 16, updated: 0, unchanged: 2 },
      // 3D Printing Basics had no validity or description.
      badges: { created: 6, updated: 1, unchanged: 0 },
      users: { created: 2, updated: 4, unchanged: 0 },
      // DIC already listed the demo manager; Central Workshop gets them.
      managedUnits: { changed: 1, unchanged: 1 },
      resources: { created: 13, updated: 0, unchanged: 0 },
      // student2's 3D Printing Basics never expired, so it is granted afresh; the student's copy goes.
      userBadges: { created: 1, updated: 1, unchanged: 0, removed: 1 },
    });

    // Same documents, matched by code and email.
    assert.equal(String((await unitBy("dic"))._id), String(f.dic._id));
    assert.equal(
      String((await Badge.findOne({ code: "3d-printing-basics" }))._id),
      String(f.badge._id),
    );
    assert.equal(String((await userBy("student"))._id), String(f.student._id));
    assert.equal(await User.countDocuments(), 8);
    assert.deepEqual(await heldBadgeCodes(f.student), [
      "electronics-lab-safety",
    ]);

    // Data that isn't the seed's is untouched.
    assert.deepEqual(plain(await others()), before);
    assert.equal(await Resource.countDocuments(), 15);

    // Real managers stay, on both sides.
    assert.deepEqual(
      ids((await unitBy("dic")).managers),
      ids([f.manager._id, f.cseManager._id]),
    );
    assert.deepEqual(
      ids((await unitBy("cse")).managers),
      ids([f.cseManager._id]),
    );
    assert.deepEqual(
      await codesOf((await userBy("cse-manager")).managedOrgUnits),
      ["cse", "dic"],
    );
    assert.deepEqual(await codesOf((await userBy("manager")).managedOrgUnits), [
      "cw",
      "dic",
    ]);
    await assertManagersInSync();

    const after = await snapshot();
    assert.deepEqual((await run()).managedUnits, { changed: 0, unchanged: 2 });
    assert.deepEqual(await snapshot(), after);
  });

  test("a run after a demo session puts the demo data back to the spec", async () => {
    await clearDatabase();
    await run();
    const admin = await userBy("admin");
    const [student, faculty, newstudent] = await Promise.all(
      ["student", "faculty", "newstudent"].map(userBy),
    );
    const [ece, cw] = [await unitBy("ece"), await unitBy("cw")];
    const printer = await resourceBy("FDM 3D Printer");
    const image = {
      url: "https://example.test/printer.jpg",
      publicId: "printer",
    };

    // What a demo leaves behind.
    await UserBadge.updateOne(
      { user: student._id },
      { status: "revoked", reason: "Testing" },
    );
    await UserBadge.create({
      user: student._id,
      badge: (await Badge.findOne({ code: "3d-printing-basics" }))._id,
      status: "active",
    });
    await Resource.updateOne(
      { _id: printer._id },
      {
        status: "maintenance",
        quantity: 3,
        checklist: ["Nozzle clean"],
        images: [image],
        "availability.blackouts": [
          { start: TUE.start, end: TUE.end, reason: "Servicing" },
        ],
        "limits.maxHoursPerWeek": 20,
      },
    );
    await User.updateOne(
      { _id: newstudent._id },
      {
        "verification.status": "approved",
        "verification.reviewedBy": admin._id,
      },
    );
    await User.updateOne(
      { _id: student._id },
      {
        strikes: 2,
        suspendedUntil: plus(NOW, 7 * 24 * 60),
        suspensionReason: "Late returns",
      },
    );
    await setOrgUnitManagers(admin._id, ece._id, [faculty._id]);
    await setOrgUnitManagers(admin._id, cw._id, []);
    // A half-finished assignment: the Computer Centre lists student 2, who doesn't hold it.
    await OrgUnit.updateOne(
      { code: "cc" },
      { managers: [(await userBy("student2"))._id] },
    );
    await OrgUnit.updateOne({ code: "dic" }, { isActive: false, name: "DIC" });
    await Badge.updateOne(
      { code: "laser-cutter-operation" },
      { selfServe: true },
    );

    const later = plus(NOW, (3 * DAY) / 60_000);
    const counts = await run({ now: later });
    assert.deepEqual(counts.orgUnits, {
      created: 0,
      updated: 1,
      unchanged: 17,
    });
    assert.deepEqual(counts.badges, { created: 0, updated: 1, unchanged: 6 });
    assert.deepEqual(counts.users, { created: 0, updated: 3, unchanged: 3 });
    assert.deepEqual(counts.managedUnits, { changed: 3, unchanged: 1 });
    assert.deepEqual(counts.resources, {
      created: 0,
      updated: 1,
      unchanged: 12,
    });
    assert.deepEqual(counts.userBadges, {
      created: 0,
      updated: 1,
      unchanged: 1,
      removed: 1,
    });

    const dic = await unitBy("dic");
    assert.deepEqual(
      [dic.name, dic.isActive],
      ["Design and Innovation Centre", true],
    );
    assert.equal(
      (await Badge.findOne({ code: "laser-cutter-operation" })).selfServe,
      false,
    );

    // The student lacks 3D Printing Basics again and holds a fresh Electronics Lab Safety.
    assert.deepEqual(await heldBadgeCodes(student), ["electronics-lab-safety"]);
    const holding = await UserBadge.findOne({ user: student._id }).lean();
    assert.equal(holding.status, "active");
    assert.equal(holding.reason, undefined);
    assert.deepEqual(holding.expiresAt, new Date(later.getTime() + 365 * DAY));
    const studentNow = await userBy("student");
    assert.deepEqual(
      [
        studentNow.strikes,
        studentNow.suspendedUntil,
        studentNow.suspensionReason,
      ],
      [0, null, undefined],
    );

    // The printer is back, but the photo a manager uploaded stays (the seed defines no images).
    const printerNow = await resourceBy("FDM 3D Printer");
    assert.deepEqual(
      [
        printerNow.status,
        printerNow.quantity,
        printerNow.availability.blackouts,
        printerNow.limits.maxHoursPerWeek,
      ],
      ["active", 1, [], 6],
    );
    assert.equal(printerNow.checklist.length, 4);
    assert.equal(printerNow.slug, printer.slug);
    assert.deepEqual(
      printerNow.images.map((i) => i.url),
      [image.url],
    );

    // The verification queue is full again, from the new run.
    const queued = await userBy("newstudent");
    assert.equal(queued.verification.status, "pending");
    assert.equal(queued.verification.reviewedBy, undefined);
    assert.deepEqual(queued.verification.submittedAt, later);

    // Faculty is a plain member again; the manager runs DIC and Central Workshop again.
    const facultyNow = await userBy("faculty");
    assert.deepEqual(
      [facultyNow.roles, ids(facultyNow.managedOrgUnits)],
      [["member"], []],
    );
    assert.deepEqual(ids((await unitBy("ece")).managers), []);
    assert.deepEqual(ids((await unitBy("cc")).managers), []);
    assert.deepEqual(await codesOf((await userBy("manager")).managedOrgUnits), [
      "cw",
      "dic",
    ]);
    await assertManagersInSync();

    // The removed badge row is in the audit log, as the system.
    const removed = await AuditLog.findOne({
      action: "user_badge.removed",
    }).lean();
    assert.equal(removed.actor.role, "system");
    assert.equal(String(removed.meta.user), String(student._id));

    assert.deepEqual(await run({ now: later }), AGAIN);
  });

  test("refuses a password bcrypt or the login policy can't take", async () => {
    await assert.rejects(seed({ password: "", log: quiet }), /not set/);
    await assert.rejects(
      seed({ password: "short1", log: quiet }),
      /at least 8/,
    );
    await assert.rejects(
      seed({ password: "lettersonly", log: quiet }),
      /letter and one digit/,
    );
    await assert.rejects(
      seed({ password: `a1${"é".repeat(40)}`, log: quiet }),
      /72 bytes/,
    );
    assert.equal(await OrgUnit.countDocuments({ code: "cw" }), 0);
  });
});

// ── The CLI (npm run seed) ──────────────────────────────────────────────────

// Runs scripts/seed.js with exactly `env`, from an empty directory, so dotenv finds no .env and
// nothing from server/.env can leak in.
async function runCli(env) {
  const cwd = await mkdtemp(join(tmpdir(), "seed-cli-"));
  try {
    const child = spawn(process.execPath, [SEED_SCRIPT], {
      cwd,
      env: { PATH: process.env.PATH, ...env },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    return { code, output };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("npm run seed", () => {
  test("exits 1 and names what's missing without MONGODB_URI or SEED_PASSWORD", async () => {
    const none = await runCli({});
    assert.equal(none.code, 1);
    assert.match(none.output, /MONGODB_URI and SEED_PASSWORD are not set/);

    const noPassword = await runCli({
      MONGODB_URI: "mongodb://seeder:hunter2-secret@127.0.0.1:1/campuscommons",
    });
    assert.equal(noPassword.code, 1);
    assert.match(noPassword.output, /SEED_PASSWORD is not set/);
    assert.doesNotMatch(noPassword.output, /hunter2/);

    const weak = await runCli({
      MONGODB_URI: "mongodb://127.0.0.1:1/campuscommons",
      SEED_PASSWORD: "password",
    });
    assert.equal(weak.code, 1);
    assert.match(weak.output, /letter and one digit/);
  });

  test("checks the password policy before connecting", () => {
    assert.equal(passwordProblem(PASSWORD), null);
    assert.match(passwordProblem(undefined), /not set/);
  });

  test(
    "never prints the connection string's credentials when the database refuses them",
    { skip },
    async () => {
      const url = new URL(process.env.TEST_MONGODB_URI);
      url.username = "seeder";
      url.password = "hunter2-secret";
      url.pathname = "/campuscommons_seed_denied";
      const { code, output } = await runCli({
        MONGODB_URI: url.toString(),
        SEED_PASSWORD: PASSWORD,
        REDIS_URL: "redis://:redis-secret@127.0.0.1:1",
      });
      assert.equal(code, 1, output);
      assert.match(output, /Seed failed/);
      for (const secret of ["hunter2", "redis-secret", PASSWORD])
        assert.doesNotMatch(output, new RegExp(secret));
    },
  );

  test(
    "seeds the database end to end and says which one, even with Redis down",
    { skip },
    async () => {
      const dbName = `campuscommons_seedcli_${randomUUID().slice(0, 8)}`;
      const url = new URL(process.env.TEST_MONGODB_URI);
      url.pathname = `/${dbName}`;
      const connection = await mongoose
        .createConnection(url.toString())
        .asPromise();
      try {
        const { code, output } = await runCli({
          MONGODB_URI: url.toString(),
          SEED_PASSWORD: PASSWORD,
          REDIS_URL: "redis://127.0.0.1:1",
        });
        assert.equal(code, 0, output);
        assert.match(output, new RegExp(`Seeding the "${dbName}" database`));
        assert.match(output, /Resources: 13 created/);
        assert.match(output, /Caches can't be cleared without Redis/);
        assert.doesNotMatch(output, new RegExp(PASSWORD));

        const { db } = connection;
        assert.equal(await db.collection("orgunits").countDocuments(), 18);
        assert.equal(await db.collection("users").countDocuments(), 6);
        assert.equal(await db.collection("resources").countDocuments(), 13);

        const again = await runCli({
          MONGODB_URI: url.toString(),
          SEED_PASSWORD: PASSWORD,
          REDIS_URL: "redis://127.0.0.1:1",
        });
        assert.equal(again.code, 0, again.output);
        assert.match(
          again.output,
          /Resources: 0 created, 0 updated, 13 unchanged/,
        );
      } finally {
        await connection.dropDatabase().catch(() => {});
        await connection.close();
      }
    },
  );
});
