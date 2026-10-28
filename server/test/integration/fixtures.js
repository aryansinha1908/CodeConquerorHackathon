// Shared setup for the integration tests. They run against a real MongoDB and are skipped unless
// TEST_MONGODB_URI is set, e.g.
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 node --test test/integration
// Each test file creates its own database (campuscommons_test_<random>) and drops it at the end.
// Redis is ioredis-mock, so locks and caches behave without a Redis server.
import { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import RedisMock from "ioredis-mock";
import { useRedisClient } from "../../src/config/redis.js";
import { setLogger } from "../../src/lib/log.js";
import {
  Badge,
  Notification,
  OrgUnit,
  Resource,
  User,
  UserBadge,
} from "../../src/models/index.js";
import { createBooking } from "../../src/services/bookingService.js";

const uri = process.env.TEST_MONGODB_URI;
export const skip = uri
  ? false
  : "set TEST_MONGODB_URI to run (a throwaway database is created and dropped)";

export const warnings = [];
setLogger({ info() {}, warn: (...args) => warnings.push(args), error() {} });

export const redis = new RedisMock();
export const ist = (s) => new Date(`${s}:00+05:30`);
export const plus = (date, minutes) =>
  new Date(date.getTime() + minutes * 60_000);
export const NOW = ist("2026-11-02T10:00"); // Monday
export const TUE = {
  start: ist("2026-11-03T10:00"),
  end: ist("2026-11-03T12:00"),
};
export const TUE_LATER = {
  start: ist("2026-11-03T11:00"),
  end: ist("2026-11-03T13:00"),
};

export const failure = (promise) =>
  promise.then(
    () => assert.fail("expected the service to refuse"),
    (err) => err,
  );

// Fictional people and inventory; real NIT JSR unit names only.
export async function seed() {
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

// Call inside the top-level describe. onSeed receives fresh fixtures before every test.
export function useTestDatabase(onSeed) {
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
    onSeed(await seed());
  });
}

export const bookAs = (who, resource, slot, extra = {}, now = NOW) =>
  createBooking(
    who._id,
    {
      resourceId: resource._id,
      ...slot,
      purpose: "Printing parts for the robotics club",
      ...extra,
    },
    { now },
  );

export const checklistOk = (resource) => ({
  items: resource.checklist.map((label) => ({ label, ok: true })),
  photos: [],
  overall: "good",
});

export const notificationsFor = (user) =>
  Notification.find({ user: user._id }).sort({ createdAt: 1 }).lean();
