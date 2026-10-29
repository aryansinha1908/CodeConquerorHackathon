// The seed script (scripts/seed.js, backend.md §9) against a real MongoDB; see fixtures.js for how
// to run it. The expected tables below are copied from backend.md §9 and architecture.md §1.2, not
// from seedData.js, so a slip in the data shows up here. The demo bookings (scripts/seedBookings.js)
// are checked against §9's "every state" and frontend.md §11's seeded extras.
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
import { STATUSES, isOverdue } from "../../src/engines/stateMachine.js";
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
import { managesUnit } from "../../src/services/access.js";
import {
  checkBooking,
  checkIn,
  confirmReturn,
  createBooking,
  listForManager,
} from "../../src/services/bookingService.js";
import { setOrgUnitManagers } from "../../src/services/orgUnitService.js";
import { passwordProblem, seed } from "../../scripts/seed.js";
import {
  SEED_REQUEST_ID,
  STORIES,
  openDay,
  seedBookings,
} from "../../scripts/seedBookings.js";
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
// Collects the seed's warnings (a skipped demo booking says why), so a failure can show them.
function collector() {
  const warnings = [];
  return {
    info() {},
    warn: (m) => warnings.push(String(m)),
    error() {},
    warnings,
  };
}
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

// What the demo bookings' flows write, which every run removes and makes again (seedBookings.js).
const BOOKING_COLLECTIONS = [
  "bookings",
  "conditionreports",
  "incidents",
  "notifications",
];
const aboutBookings = (entry) =>
  ["booking", "incident"].includes(entry.entity?.type);

// Every document in every collection, every field included (password hashes, timestamps).
// withoutBookings leaves out the demo bookings and everything their flows wrote.
async function snapshot({ withoutBookings = false } = {}) {
  const out = {};
  for (const collection of await mongoose.connection.db.collections()) {
    const name = collection.collectionName;
    if (withoutBookings && BOOKING_COLLECTIONS.includes(name)) continue;
    let docs = await collection.find({}).sort({ _id: 1 }).toArray();
    if (withoutBookings && name === "auditlogs")
      docs = docs.filter((entry) => !aboutBookings(entry));
    out[name] = plain(docs);
  }
  return out;
}

// How many documents the booking flows left, per collection, audit entries included.
async function bookingVolume() {
  return {
    bookings: await Booking.countDocuments(),
    reports: await ConditionReport.countDocuments(),
    incidents: await Incident.countDocuments(),
    notifications: await Notification.countDocuments(),
    audit: await AuditLog.countDocuments({
      "entity.type": { $in: ["booking", "incident"] },
    }),
  };
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

// backend.md §9 asks for "about 15" bookings; the stories make 16, and a re-run remakes them all.
const DEMO_BOOKINGS = 16;
const FRESH = {
  orgUnits: { created: 18, updated: 0, unchanged: 0 },
  badges: { created: 7, updated: 0, unchanged: 0 },
  users: { created: 6, updated: 0, unchanged: 0 },
  managedUnits: { changed: 2, unchanged: 0 },
  resources: { created: 13, updated: 0, unchanged: 0 },
  userBadges: { created: 2, updated: 0, unchanged: 0, removed: 0 },
  bookings: { removed: 0, created: DEMO_BOOKINGS, skipped: 0 },
};
const AGAIN = {
  orgUnits: { created: 0, updated: 0, unchanged: 18 },
  badges: { created: 0, updated: 0, unchanged: 7 },
  users: { created: 0, updated: 0, unchanged: 6 },
  managedUnits: { changed: 0, unchanged: 2 },
  resources: { created: 0, updated: 0, unchanged: 13 },
  userBadges: { created: 0, updated: 0, unchanged: 2, removed: 0 },
  bookings: { removed: DEMO_BOOKINGS, created: DEMO_BOOKINGS, skipped: 0 },
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
    assert.equal(await Booking.countDocuments(), DEMO_BOOKINGS);

    // Every seeded document is audited once, as the system, without any value in it. (The bookings'
    // own trails are checked in the tests below.)
    const audits = (await AuditLog.find({}).lean()).filter(
      (entry) => !aboutBookings(entry),
    );
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

  test("a second run, even a day later, writes nothing but the demo bookings, which it remakes without piling up", async () => {
    await clearDatabase();
    await run();
    const before = await snapshot({ withoutBookings: true });
    const volume = await bookingVolume();
    const firstIds = ids(
      (await Booking.find({}, { _id: 1 }).lean()).map((b) => b._id),
    );

    assert.deepEqual(await run({ now: plus(NOW, DAY / 60_000) }), AGAIN);
    assert.deepEqual(await snapshot({ withoutBookings: true }), before);
    // The same stories again, a day on: as many documents as before, none of the old ones left.
    assert.deepEqual(await bookingVolume(), volume);
    const again = await Booking.find({ _id: { $in: firstIds } }).lean();
    assert.deepEqual(again, []);
    assert.equal(
      await AuditLog.countDocuments({
        "entity.id": {
          $in: firstIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      }),
      0,
    );
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

    // The demo bookings leave the judge script's slot alone: nothing holds the printer tomorrow
    // 10:00–12:00, and student 2 (step 6) holds no active printer booking, so the waitlist offer and
    // not ACTIVE_BOOKINGS answers them.
    const printerDoc = await resourceBy("FDM 3D Printer");
    assert.deepEqual(
      await Booking.find({
        resource: printerDoc._id,
        start: { $lt: TUE.end },
        end: { $gt: TUE.start },
      }).lean(),
      [],
    );
    assert.equal(
      await Booking.countDocuments({
        resource: printerDoc._id,
        borrower: student2._id,
        status: { $in: ["pending", "approved", "checked_in"] },
      }),
      0,
    );
    assert.ok(
      await Booking.exists({
        resource: printerDoc._id,
        borrower: student2._id,
      }),
      "student 2 has printer history",
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
      bookings: { removed: 0, created: DEMO_BOOKINGS, skipped: 0 },
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

    const after = await snapshot({ withoutBookings: true });
    assert.deepEqual((await run()).managedUnits, { changed: 0, unchanged: 2 });
    assert.deepEqual(await snapshot({ withoutBookings: true }), after);
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

  // ── Demo bookings (scripts/seedBookings.js) ──────────────────────────────

  test("the demo bookings cover every status for every demo borrower, with the judge script's extras", async () => {
    await clearDatabase();
    const log = collector();
    assert.deepEqual(
      (await run({ log })).bookings,
      FRESH.bookings,
      log.warnings.join("\n"),
    );
    const [student, student2, faculty, manager, admin] = await Promise.all(
      ["student", "student2", "faculty", "manager", "admin"].map(userBy),
    );
    const bookings = await Booking.find({})
      .populate("resource", "title")
      .lean();
    const byStatus = (status) => bookings.filter((b) => b.status === status);
    assert.deepEqual(
      [...new Set(bookings.map((b) => b.status))].sort(),
      [...STATUSES].sort(),
    );

    // Every demo login that can book has bookings of its own; the admin decides and confirms where
    // no demo manager runs the unit.
    for (const user of [student, student2, faculty, manager])
      assert.ok(
        bookings.some((b) => String(b.borrower) === String(user._id)),
        user.email,
      );
    assert.ok(
      bookings.some((b) => String(b.decision?.by) === String(admin._id)),
    );
    assert.ok(
      bookings.some(
        (b) => String(b.returnConfirmation?.by) === String(admin._id),
      ),
    );

    // frontend.md §11 seeded extras: a rejected request with its reason, from the unit's manager...
    const [rejected] = byStatus("rejected");
    assert.equal(rejected.decision.action, "reject");
    assert.equal(String(rejected.decision.by), String(manager._id));
    assert.ok(rejected.decision.reason.length > 20);
    // ...a no-show the system marked after the grace period...
    const [noShow] = byStatus("no_show");
    assert.ok(noShow.start < NOW);
    assert.ok(
      await AuditLog.exists({
        "entity.id": noShow._id,
        action: "booking.no_show",
        "actor.role": "system",
      }),
    );
    // ...and an overdue loan still out, with the delay incident the sweeper opened.
    const inUse = byStatus("checked_in");
    const overdue = inUse.filter((b) => isOverdue(b, NOW));
    assert.equal(overdue.length, 1);
    assert.equal(overdue[0].flags.overdue, true);
    const delay = await Incident.find({ booking: overdue[0]._id }).lean();
    assert.deepEqual(
      delay.map((i) => [i.type, i.source, i.status, i.reportedBy]),
      [["delay", "system", "open", null]],
    );
    assert.deepEqual(overdue[0].incidents.map(String), [String(delay[0]._id)]);
    // Another loan is out right now and not yet due.
    assert.ok(
      inUse.some((b) => b.start < NOW && b.end > NOW && !b.flags.overdue),
    );

    // Flagged on return, with the manager's open damage incident.
    const [flagged] = byStatus("flagged");
    assert.equal(flagged.returnConfirmation.outcome, "issue");
    const damage = await Incident.find({ booking: flagged._id }).lean();
    assert.deepEqual(
      damage.map((i) => [i.type, i.source, i.status, String(i.reportedBy)]),
      [["damage", "manager", "open", String(manager._id)]],
    );
    assert.deepEqual(flagged.incidents.map(String), [String(damage[0]._id)]);

    // Returned and waiting for the demo manager's confirmation (their Handovers page).
    const [returned] = byStatus("checked_out");
    assert.ok(returned.checkOut.report);
    assert.equal(returned.returnConfirmation?.outcome, undefined);
    assert.ok(managesUnit(manager, returned.orgUnit));
    for (const done of byStatus("completed"))
      assert.equal(done.returnConfirmation.outcome, "ok");

    // Upcoming ones are upcoming, and the waitlisted request sits in the same conflict group as the
    // pending one it waits behind (Manage → Requests).
    for (const b of [
      ...byStatus("approved"),
      ...byStatus("pending"),
      ...byStatus("waitlisted"),
    ])
      assert.ok(b.start > NOW, `${b.status} ${b.resource.title}`);
    const [waitlisted] = byStatus("waitlisted");
    const { groups } = await listForManager(admin._id, { status: "pending" });
    const group = groups.find((g) =>
      g.bookings.some((x) => String(x._id) === String(waitlisted._id)),
    );
    assert.deepEqual(
      group.bookings.map((x) => [x.status, x.waitlistPosition ?? null]),
      [
        ["pending", null],
        ["waitlisted", 1],
      ],
    );

    // Cancelled by its borrower; expired with nobody having decided.
    const [cancelled] = byStatus("cancelled");
    assert.equal(String(cancelled.cancellation.by), String(cancelled.borrower));
    const [expired] = byStatus("expired");
    assert.equal(expired.decision?.action, undefined);
    assert.ok(expired.start < NOW);
  });

  test("every demo booking's history is real: an audit trail from the request to its status, in order and in the past", async () => {
    await clearDatabase();
    await run();
    for (const booking of await Booking.find({}).lean()) {
      const label = `${booking.status} booking ${booking._id}`;
      const trail = await AuditLog.find({
        "entity.type": "booking",
        "entity.id": booking._id,
      })
        .sort({ at: 1, _id: 1 })
        .lean();

      // Requested by its borrower through the service, with the seed's request id.
      assert.equal(trail[0].action, "booking.requested", label);
      assert.equal(trail[0].requestId, SEED_REQUEST_ID, label);
      assert.equal(String(trail[0].actor.id), String(booking.borrower), label);
      assert.deepEqual(booking.createdAt, trail[0].at, label);

      // Each status change starts where the one before ended; the last ends at the booking's status.
      let status = null;
      for (const entry of trail.filter((e) => e.changes?.status)) {
        assert.equal(
          entry.changes.status[0],
          status,
          `${label}: ${entry.action}`,
        );
        status = entry.changes.status[1];
      }
      assert.equal(status, booking.status, label);

      // Stamped when it happened: in order, never after the seed's now, the booking's updatedAt
      // matching its last step.
      const moments = trail.map((e) => e.at.getTime());
      assert.deepEqual(
        moments,
        [...moments].sort((a, b) => a - b),
        label,
      );
      assert.ok(moments.at(-1) <= NOW.getTime(), label);
      assert.deepEqual(booking.updatedAt, trail.at(-1).at, label);

      // A condition report for each handover, written at the handover.
      const reports = await ConditionReport.find({
        booking: booking._id,
      }).lean();
      for (const [phase, field] of [
        ["check_in", "checkIn"],
        ["check_out", "checkOut"],
      ]) {
        const report = reports.find((r) => r.phase === phase);
        assert.equal(
          Boolean(report),
          Boolean(booking[field]?.at),
          `${label} ${phase}`,
        );
        if (report) {
          assert.equal(String(booking[field].report), String(report._id));
          assert.deepEqual(report.at, booking[field].at, `${label} ${phase}`);
        }
      }

      // Its notifications went out at the moments of its steps.
      const notices = await Notification.find({
        link: { $regex: String(booking._id) },
      }).lean();
      for (const notice of notices)
        assert.ok(
          moments.includes(notice.createdAt.getTime()),
          `${label}: ${notice.type}`,
        );
    }
    // Each borrower heard about their bookings; the demo manager about the DIC's.
    const manager = await userBy("manager");
    assert.ok(
      await Notification.exists({
        user: manager._id,
        type: "booking.checked_out",
      }),
    );
    assert.ok(
      await Notification.exists({
        user: (await userBy("student2"))._id,
        type: "booking.rejected",
      }),
    );
  });

  test("a re-run remakes only the seeded bookings: a demo session's own booking and its trail stay", async () => {
    await clearDatabase();
    await run();
    const [student, manager] = await Promise.all(
      ["student", "manager"].map(userBy),
    );
    const room = await resourceBy("Discussion Room A");

    // A demo session: the student books the room for tomorrow evening, with the request id the
    // nearest a request header could get to the seed's...
    const own = await createBooking(
      student._id,
      {
        resourceId: room._id,
        start: ist("2026-11-03T18:00"),
        end: ist("2026-11-03T19:00"),
        purpose: "Booked by hand during a demo session.",
      },
      { now: NOW, requestId: "seed-demo-bookings" },
    );
    const ownTrail = plain(
      await AuditLog.find({ "entity.id": own.booking._id }).lean(),
    );
    assert.equal(ownTrail.length, 1);
    assert.equal(
      await Notification.countDocuments({
        link: `/bookings/${own.booking._id}`,
      }),
      1,
    );
    // ...and the manager confirms the seeded return that was waiting for them.
    const waiting = await Booking.findOne({ status: "checked_out" }).lean();
    await confirmReturn(
      waiting._id,
      manager._id,
      { outcome: "ok" },
      { now: NOW },
    );

    assert.deepEqual((await run()).bookings, AGAIN.bookings);

    // The student's booking, its audit entry and its notification are untouched.
    assert.ok(await Booking.exists({ _id: own.booking._id }));
    assert.deepEqual(
      plain(await AuditLog.find({ "entity.id": own.booking._id }).lean()),
      ownTrail,
    );
    assert.equal(
      await Notification.countDocuments({
        link: `/bookings/${own.booking._id}`,
      }),
      1,
    );
    // The seeded return went with its whole story, the manager's confirmation and notice included.
    assert.equal(await Booking.exists({ _id: waiting._id }), null);
    assert.equal(
      await AuditLog.countDocuments({ "entity.id": waiting._id }),
      0,
    );
    assert.equal(
      await ConditionReport.countDocuments({ booking: waiting._id }),
      0,
    );
    assert.equal(
      await Notification.countDocuments({
        link: { $regex: String(waiting._id) },
      }),
      0,
    );
    // And the stories are back: a return waits for the manager again.
    assert.equal(await Booking.countDocuments({ status: "checked_out" }), 1);
    assert.equal(await Booking.countDocuments(), DEMO_BOOKINGS + 1);
  });

  test("a re-run frees the slots its bookings held: whoever waited behind one is promoted", async () => {
    await clearDatabase();
    await run();
    // The faculty member asks for the room the student's seeded booking holds and joins its waitlist.
    const story = STORIES.find((s) => s.key === "room-approved");
    const room = await resourceBy(story.resource);
    const faculty = await userBy("faculty");
    const { booking: waiting } = await createBooking(
      faculty._id,
      {
        resourceId: room._id,
        ...story.slot(NOW),
        purpose: "Project review with my students.",
        joinWaitlist: true,
      },
      { now: NOW },
    );
    assert.equal(waiting.status, "waitlisted");

    // A day later the seed runs again: the seeded holder goes, and its story moves to a later day.
    const later = plus(NOW, DAY / 60_000);
    assert.deepEqual((await run({ now: later })).bookings, AGAIN.bookings);
    const promoted = await Booking.findById(waiting._id).lean();
    // The room approves on its own, so the promoted request is approved at once.
    assert.equal(promoted.status, "approved");
    assert.ok(
      await AuditLog.exists({
        "entity.id": waiting._id,
        action: "booking.promoted",
      }),
    );
    assert.ok(
      await Notification.exists({
        user: faculty._id,
        link: `/bookings/${waiting._id}`,
        type: "booking.promoted",
      }),
    );
    // The next run keeps it: it isn't seed data.
    await run({ now: later });
    assert.equal(
      (await Booking.findById(waiting._id).lean()).status,
      "approved",
    );
  });

  test("a story whose slot someone else took is skipped with a warning; the others go on", async () => {
    await clearDatabase();
    // Everything but the bookings, as a run without Redis leaves it.
    const base = await run({ bookings: false });
    assert.equal(base.bookings, undefined);
    assert.equal(await Booking.countDocuments(), 0);
    // Before the next run, the admin books the Meeting Room slot that the faculty member's pending
    // request is meant to hold.
    const meeting = STORIES.find((s) => s.key === "meeting-pending");
    const taken = await createBooking(
      (await userBy("admin"))._id,
      {
        resourceId: (await resourceBy("Meeting Room"))._id,
        ...meeting.slot(NOW),
        purpose: "Campus admin review meeting.",
      },
      { now: NOW },
    );

    const log = collector();
    assert.deepEqual((await run({ log })).bookings, {
      removed: 0,
      created: DEMO_BOOKINGS - 1,
      skipped: 1,
    });
    assert.equal(log.warnings.length, 1);
    assert.match(
      log.warnings[0],
      /"meeting-pending" skipped: .*held by an earlier request/,
    );
    // Nothing is left of the skipped story; the student still joins the waitlist, behind the admin.
    assert.equal(
      await Booking.countDocuments({
        borrower: (await userBy("faculty"))._id,
        status: "pending",
      }),
      0,
    );
    const { groups } = await listForManager((await userBy("admin"))._id, {
      status: "pending",
    });
    const group = groups.find(
      (g) => String(g.bookings[0]._id) === String(taken.booking._id),
    );
    assert.deepEqual(
      group.bookings.map((b) => b.status),
      ["pending", "waitlisted"],
    );
    // The admin's own booking isn't seed data: the next run keeps it.
    await run();
    assert.ok(await Booking.exists({ _id: taken.booking._id }));
  });

  test("someone else's overdue loan is flagged at the real time, never backdated with the seed's story", async () => {
    await clearDatabase();
    await run({ bookings: false });
    // A loan the student checked in two open days ago and never returned, with the API's sweeper
    // stopped, so it isn't flagged yet. Made at the real clock, like any member's booking.
    const kit = await resourceBy("IoT Starter Kit");
    const student = await userBy("student");
    const day = openDay(NOW, -2);
    const slot = { start: plus(day, 10 * 60), end: plus(day, 16 * 60) };
    const { booking } = await createBooking(
      student._id,
      {
        resourceId: kit._id,
        ...slot,
        purpose: "Sensor practice for the IoT lab.",
      },
      { now: plus(slot.start, -24 * 60) },
    );
    await checkIn(
      booking._id,
      student._id,
      {
        items: kit.checklist.map((label) => ({ label, ok: true })),
        overall: "good",
      },
      { now: plus(slot.start, 5) },
    );

    const log = collector();
    log.info = (m) => log.warnings.push(`info: ${m}`);
    const seededAt = new Date();
    assert.deepEqual((await run({ log })).bookings, FRESH.bookings);
    const seeded = new Date();
    const whileSeeding = (t) => t >= seededAt && t <= seeded;
    assert.ok(
      log.warnings.includes(
        "info: Flagged 1 overdue return the sweeper hadn't caught yet.",
      ),
    );
    // Flagged by the catch-up run, stamped with the real time, not with the seeded loan's moment.
    const entry = await AuditLog.findOne({
      "entity.id": booking._id,
      action: "booking.overdue",
    }).lean();
    assert.ok(whileSeeding(entry.at), `stamped ${entry.at.toISOString()}`);
    const notices = await Notification.find({
      link: `/bookings/${booking._id}/check-out`,
    }).lean();
    assert.equal(notices.length, 1);
    assert.ok(whileSeeding(notices[0].createdAt));

    // The next run leaves the loan, its incident and its notification alone.
    await run();
    assert.equal(
      (await Booking.findById(booking._id).lean()).flags.overdue,
      true,
    );
    assert.equal(await Incident.countDocuments({ booking: booking._id }), 1);
    assert.equal(await Notification.countDocuments({ _id: notices[0]._id }), 1);
    assert.equal(
      await AuditLog.countDocuments({ "entity.id": booking._id }),
      3,
    );
  });

  test("the stories hold whatever day and hour the seed runs, Sundays and late nights included", async () => {
    await clearDatabase();
    await run();
    // A whole IST week from NOW's Monday, early, mid-morning, afternoon and late.
    for (let day = 0; day < 7; day++) {
      for (const hhmm of ["00:10", "10:30", "16:45", "23:55"]) {
        const now = plus(ist(`2026-11-02T${hhmm}`), day * 24 * 60);
        const log = collector();
        const counts = await seedBookings({ now, log });
        const label = `${now.toISOString()} ${log.warnings.join("; ")}`;
        assert.deepEqual(counts, AGAIN.bookings, label);
        assert.deepEqual(
          (await Booking.distinct("status")).sort(),
          [...STATUSES].sort(),
          label,
        );
        assert.equal(
          await AuditLog.countDocuments({
            "entity.type": { $in: ["booking", "incident"] },
            at: { $gt: now },
          }),
          0,
          label,
        );
      }
    }
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
        // Booking takes the Redis lock, so the demo bookings wait for a run with Redis.
        assert.match(
          output,
          /Demo bookings skipped: booking takes the Redis resource lock/,
        );
        assert.doesNotMatch(output, /Demo bookings: \d/);
        assert.doesNotMatch(output, new RegExp(PASSWORD));

        const { db } = connection;
        assert.equal(await db.collection("orgunits").countDocuments(), 18);
        assert.equal(await db.collection("users").countDocuments(), 6);
        assert.equal(await db.collection("resources").countDocuments(), 13);
        assert.equal(await db.collection("bookings").countDocuments(), 0);

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
