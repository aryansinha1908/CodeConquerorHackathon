// Org unit service against a real MongoDB; see fixtures.js for how to run it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { keys } from "../../src/lib/redisKeys.js";
import {
  AuditLog,
  Badge,
  OrgUnit,
  Resource,
  User,
} from "../../src/models/index.js";
import { managesUnit } from "../../src/services/access.js";
import {
  createOrgUnit,
  listOrgUnits,
  setOrgUnitManagers,
  updateOrgUnit,
} from "../../src/services/orgUnitService.js";
import { getResource } from "../../src/services/resourceService.js";
import { failure, redis, skip, useTestDatabase } from "./fixtures.js";

let f; // fixtures, rebuilt for every test

const WORKSHOP = {
  name: "Central Workshop",
  code: "Workshop",
  type: "central_facility",
  location: { building: "Workshop Block", notes: "Ground floor" },
};

const audits = () =>
  AuditLog.find({ "entity.type": "org_unit" }).sort({ at: 1 }).lean();
const unitOf = (unit) => OrgUnit.findById(unit._id).lean();
const userOf = (user) => User.findById(user._id).lean();
const ids = (list) => (list ?? []).map(String);
const names = (units) => units.map((u) => u.name);
const catalogue = async () =>
  JSON.parse(await redis.get(keys.catalogue("orgunits")));
const listVersion = async () =>
  Number(await redis.get(keys.cacheVersion("resources"))) || 0;

function assertError(err, status, code) {
  assert.equal(err.status, status, err.message);
  assert.equal(err.code, code);
}

describe("orgUnitService", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  describe("catalogue", () => {
    test("lists active units by name; includeInactive (literally true) adds the rest", async () => {
      await OrgUnit.create({ ...WORKSHOP, isActive: false });

      const active = await listOrgUnits();
      assert.deepEqual(names(active), [
        "Computer Science and Engineering",
        "Design and Innovation Centre",
      ]);
      assert.deepEqual(names(await listOrgUnits({ includeInactive: true })), [
        "Central Workshop",
        "Computer Science and Engineering",
        "Design and Innovation Centre",
      ]);
      // A query-string "true" that wasn't parsed doesn't count.
      assert.equal((await listOrgUnits({ includeInactive: "true" })).length, 2);

      // Members get no user ids; the admin screen asks for the managers explicitly.
      const dic = active.find((u) => u.code === "dic");
      assert.deepEqual(Object.keys(dic).sort(), [
        "_id",
        "code",
        "isActive",
        "name",
        "type",
      ]);
      const staffed = await listOrgUnits({ includeManagers: true });
      assert.deepEqual(ids(staffed.find((u) => u.code === "dic").managers), [
        String(f.manager._id),
      ]);
      assert.equal(
        (await listOrgUnits({ includeManagers: "true" })).some(
          (u) => "managers" in u,
        ),
        false,
      );
    });

    test("one shared entry holds every unit, and reads are served from it", async () => {
      await OrgUnit.create({ ...WORKSHOP, isActive: false });
      await listOrgUnits();
      assert.equal((await catalogue()).length, 3);

      // Written behind the cache's back: the cached list is still served.
      await OrgUnit.updateOne({ _id: f.dic._id }, { name: "Renamed Directly" });
      assert.ok(
        names(await listOrgUnits()).includes("Design and Innovation Centre"),
      );
      assert.ok(
        names(await listOrgUnits({ includeInactive: true })).includes(
          "Central Workshop",
        ),
      );
    });

    test("every write invalidates the catalogue", async () => {
      const unit = await createOrgUnit(f.admin._id, WORKSHOP);
      assert.ok(names(await listOrgUnits()).includes("Central Workshop"));

      await updateOrgUnit(f.admin._id, unit._id, { name: "Main Workshop" });
      assert.ok(names(await listOrgUnits()).includes("Main Workshop"));

      await updateOrgUnit(f.admin._id, unit._id, { isActive: false });
      assert.ok(!names(await listOrgUnits()).includes("Main Workshop"));
      assert.ok(
        names(await listOrgUnits({ includeInactive: true })).includes(
          "Main Workshop",
        ),
      );

      await setOrgUnitManagers(f.admin._id, f.dic._id, [f.student._id]);
      const dic = (await listOrgUnits({ includeManagers: true })).find(
        (u) => u.code === "dic",
      );
      assert.deepEqual(ids(dic.managers), [String(f.student._id)]);
    });
  });

  describe("access", () => {
    test("managers and students get 403 for every change, and nothing changes", async () => {
      for (const who of [f.manager, f.cseManager, f.student]) {
        const attempts = [
          () => createOrgUnit(who._id, WORKSHOP),
          () => updateOrgUnit(who._id, f.dic._id, { name: "Taken Over" }),
          () => setOrgUnitManagers(who._id, f.dic._id, [who._id]),
          // Refused before the unit is looked up, so a 403 says nothing about which ids exist.
          () =>
            updateOrgUnit(who._id, new mongoose.Types.ObjectId(), {
              name: "Xy",
            }),
        ];
        for (const attempt of attempts) {
          const err = await failure(attempt());
          assertError(err, 403, "FORBIDDEN");
          assert.equal(err.message, "Only an admin can manage org units.");
        }
      }
      assert.equal(await OrgUnit.countDocuments(), 2);
      assert.equal((await unitOf(f.dic)).name, "Design and Innovation Centre");
      assert.deepEqual(ids((await unitOf(f.dic)).managers), [
        String(f.manager._id),
      ]);
      assert.deepEqual((await userOf(f.student)).roles, ["member"]);
      assert.equal((await audits()).length, 0);
    });

    test("an actor id that isn't a user (the mock auth's id) is a 404, not a cast error", async () => {
      for (const actorId of [
        "demo-user-id-001",
        new mongoose.Types.ObjectId(),
      ]) {
        for (const attempt of [
          () => createOrgUnit(actorId, WORKSHOP),
          () => updateOrgUnit(actorId, f.dic._id, { name: "Xy" }),
          () => setOrgUnitManagers(actorId, f.dic._id, []),
        ]) {
          const err = await failure(attempt());
          assertError(err, 404, "NOT_FOUND");
          assert.equal(err.message, "User not found.");
        }
      }
    });

    test("a unit id that isn't valid or doesn't exist is a 404", async () => {
      for (const unitId of ["not-an-id", new mongoose.Types.ObjectId()]) {
        for (const attempt of [
          () => updateOrgUnit(f.admin._id, unitId, { name: "Xy" }),
          () => setOrgUnitManagers(f.admin._id, unitId, []),
        ]) {
          const err = await failure(attempt());
          assertError(err, 404, "NOT_FOUND");
          assert.equal(err.message, "Org unit not found.");
        }
      }
    });
  });

  describe("create", () => {
    test("an admin creates a unit, audited as org_unit.created", async () => {
      const unit = await createOrgUnit(f.admin._id, WORKSHOP, {
        requestId: "req-create",
      });
      assert.equal(unit.code, "workshop");
      assert.equal(unit.isActive, true);
      assert.deepEqual(unit.managers, []);

      const [entry] = await audits();
      assert.equal(entry.action, "org_unit.created");
      assert.deepEqual(entry.actor, { id: f.admin._id, role: "admin" });
      assert.deepEqual(entry.entity, { type: "org_unit", id: unit._id });
      assert.equal(String(entry.orgUnit), String(unit._id));
      assert.equal(entry.requestId, "req-create");
      assert.deepEqual(entry.changes, {
        name: [null, "Central Workshop"],
        code: [null, "workshop"],
        type: [null, "central_facility"],
        location: [null, WORKSHOP.location],
        isActive: [null, true],
      });
    });

    test("a code already in use is a 400 on the code field, whatever its case, and nothing is saved", async () => {
      const err = await failure(
        createOrgUnit(f.admin._id, {
          name: "Another DIC",
          code: " DIC ",
          type: "centre",
        }),
      );
      assertError(err, 400, "VALIDATION_ERROR");
      assert.equal(
        err.message,
        'An org unit with the code "dic" already exists.',
      );
      assert.deepEqual(err.details, [
        { path: "code", message: "Already used by another org unit." },
      ]);
      assert.equal(await OrgUnit.countDocuments(), 2);
      assert.equal((await audits()).length, 0);
    });

    test("invalid fields are a 400 with one detail per field", async () => {
      const err = await failure(
        createOrgUnit(f.admin._id, {
          name: "X",
          code: "no spaces",
          type: "lab",
          location: { notes: "n".repeat(301) },
        }),
      );
      assertError(err, 400, "VALIDATION_ERROR");
      assert.equal(err.message, "4 fields are invalid.");
      assert.deepEqual(
        err.details.map((d) => d.path),
        ["code", "location.notes", "name", "type"],
      );

      const empty = await failure(createOrgUnit(f.admin._id, {}));
      assertError(empty, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        empty.details.map((d) => d.path),
        ["code", "name", "type"],
      );
      assert.equal(await OrgUnit.countDocuments(), 2);
      assert.equal((await audits()).length, 0);
    });

    test("managers and unknown fields can't be set on create, and location must be an object", async () => {
      const err = await failure(
        createOrgUnit(f.admin._id, {
          ...WORKSHOP,
          managers: [f.student._id],
          ownerId: "x",
        }),
      );
      assertError(err, 400, "VALIDATION_ERROR");
      assert.equal(err.message, "2 fields can't be set here.");
      assert.deepEqual(err.details, [
        { path: "managers", message: "Managers are assigned separately." },
        { path: "ownerId", message: "This field can't be set." },
      ]);

      const located = await failure(
        createOrgUnit(f.admin._id, { ...WORKSHOP, location: "Workshop Block" }),
      );
      assertError(located, 400, "VALIDATION_ERROR");
      assert.deepEqual(located.details, [
        { path: "location", message: "Must be an object." },
      ]);
      assert.equal(await OrgUnit.countDocuments(), 2);
    });
  });

  describe("update", () => {
    test("a rename is audited with before and after and refreshes the resource caches", async () => {
      const otherDetail = keys.resourceDetail(new mongoose.Types.ObjectId());
      await Promise.all([
        listOrgUnits(),
        redis.set(keys.resourceDetail(f.printer._id), "{}"),
        redis.set(keys.resourceDetail(f.kits._id), "{}"),
        redis.set(otherDetail, "{}"),
      ]);
      const version = await listVersion();

      const updated = await updateOrgUnit(
        f.admin._id,
        f.dic._id,
        {
          name: "Design & Innovation Centre",
          location: { building: "Old Library" },
        },
        { requestId: "req-rename" },
      );
      assert.equal(updated.name, "Design & Innovation Centre");
      assert.equal(updated.code, "dic");
      assert.equal((await unitOf(f.dic)).name, "Design & Innovation Centre");

      const [entry] = await audits();
      assert.equal(entry.action, "org_unit.updated");
      assert.deepEqual(entry.actor, { id: f.admin._id, role: "admin" });
      assert.deepEqual(entry.entity, { type: "org_unit", id: f.dic._id });
      assert.equal(String(entry.orgUnit), String(f.dic._id));
      assert.equal(entry.requestId, "req-rename");
      assert.deepEqual(entry.changes, {
        name: ["Design and Innovation Centre", "Design & Innovation Centre"],
        location: [null, { building: "Old Library" }],
      });

      assert.equal(await redis.get(keys.catalogue("orgunits")), null);
      assert.equal(await listVersion(), version + 1);
      assert.equal(await redis.get(keys.resourceDetail(f.printer._id)), null);
      assert.equal(await redis.get(keys.resourceDetail(f.kits._id)), null);
      assert.equal(await redis.get(otherDetail), "{}");
    });

    test("deactivating or a new type refreshes the resource caches; a location change leaves them alone", async () => {
      const version = await listVersion();
      await updateOrgUnit(f.admin._id, f.cse._id, { isActive: false });
      assert.equal(await listVersion(), version + 1);
      assert.deepEqual(names(await listOrgUnits()), [
        "Design and Innovation Centre",
      ]);
      const [entry] = await audits();
      assert.deepEqual(entry.changes, { isActive: [true, false] });

      await redis.set(keys.resourceDetail(f.printer._id), "{}");
      await listOrgUnits();
      await updateOrgUnit(f.admin._id, f.dic._id, {
        location: { building: "Old Library", notes: "First floor" },
      });
      assert.equal(await listVersion(), version + 1);
      assert.equal(await redis.get(keys.resourceDetail(f.printer._id)), "{}");
      assert.equal(await redis.get(keys.catalogue("orgunits")), null);

      // Cards and details show the unit's type, so it is refreshed like a rename.
      await redis.del(keys.resourceDetail(f.printer._id));
      await getResource(f.student._id, f.printer._id);
      await updateOrgUnit(f.admin._id, f.dic._id, { type: "department" });
      assert.equal(await listVersion(), version + 2);
      assert.equal(
        (await getResource(f.student._id, f.printer._id)).orgUnit.type,
        "department",
      );
    });

    test("a rename also refreshes other units' resources that name the unit in their rules", async () => {
      const scope = await Resource.create({
        orgUnit: f.cse._id,
        title: "Oscilloscope",
        category: "equipment",
        eligibility: { departments: [f.dic._id], badges: [f.badge._id] },
      });
      const unrelated = await Resource.create({
        orgUnit: f.cse._id,
        title: "Logic Analyser",
        category: "equipment",
      });
      const before = await getResource(f.student._id, scope._id);
      assert.equal(
        before.eligibility.departments[0].name,
        "Design and Innovation Centre",
      );
      await getResource(f.student._id, unrelated._id);

      await updateOrgUnit(f.admin._id, f.dic._id, { name: "Innovation Hub" });
      const after = await getResource(f.student._id, scope._id);
      assert.equal(after.eligibility.departments[0].name, "Innovation Hub");
      assert.equal(after.eligibility.badges[0].orgUnit.name, "Innovation Hub");
      // A resource that doesn't mention the unit keeps its cached detail.
      assert.notEqual(
        await redis.get(keys.resourceDetail(unrelated._id)),
        null,
      );

      // Only a badge issued by the unit counts, not any badge.
      const cseBadge = await Badge.create({
        name: "Oscilloscope Safety",
        code: "scope-safety",
        orgUnit: f.cse._id,
      });
      await Resource.updateOne(
        { _id: unrelated._id },
        { "eligibility.badges": [cseBadge._id] },
      );
      await redis.set(keys.resourceDetail(unrelated._id), "{}");
      await updateOrgUnit(f.admin._id, f.dic._id, { name: "Design Hub" });
      assert.equal(await redis.get(keys.resourceDetail(unrelated._id)), "{}");
    });

    test("location is replaced as a whole", async () => {
      await updateOrgUnit(f.admin._id, f.dic._id, {
        location: { building: "Old Library", notes: "First floor" },
      });
      await updateOrgUnit(f.admin._id, f.dic._id, {
        location: { notes: "Moved to the annexe" },
      });
      const { location } = await unitOf(f.dic);
      assert.deepEqual(location, { notes: "Moved to the annexe" });
    });

    test("the code can't change; resending the current code is fine", async () => {
      const err = await failure(
        updateOrgUnit(f.admin._id, f.dic._id, { code: "dic2" }),
      );
      assertError(err, 400, "VALIDATION_ERROR");
      assert.equal(err.message, "1 field can't be set here.");
      assert.deepEqual(err.details, [
        { path: "code", message: "An org unit's code can't change." },
      ]);
      assert.equal((await unitOf(f.dic)).code, "dic");

      const updated = await updateOrgUnit(f.admin._id, f.dic._id, {
        code: "DIC",
        name: "Design Centre",
      });
      assert.equal(updated.name, "Design Centre");
      const [entry] = await audits();
      assert.deepEqual(Object.keys(entry.changes), ["name"]);
    });

    test("managers, ids and unknown fields can't be patched", async () => {
      const err = await failure(
        updateOrgUnit(f.admin._id, f.dic._id, {
          managers: [f.student._id],
          _id: new mongoose.Types.ObjectId(),
          createdAt: new Date(0),
        }),
      );
      assertError(err, 400, "VALIDATION_ERROR");
      assert.deepEqual(err.details, [
        { path: "_id", message: "This field can't be set." },
        { path: "createdAt", message: "This field can't be set." },
        { path: "managers", message: "Managers are assigned separately." },
      ]);
      assert.deepEqual(ids((await unitOf(f.dic)).managers), [
        String(f.manager._id),
      ]);
      assert.equal((await audits()).length, 0);
    });

    test("invalid values are a 400 with field details and nothing is saved", async () => {
      const err = await failure(
        updateOrgUnit(f.admin._id, f.dic._id, {
          name: "",
          type: "lab",
          isActive: "maybe",
          location: { building: "b".repeat(121) },
        }),
      );
      assertError(err, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        err.details.map((d) => d.path),
        ["isActive", "location.building", "name", "type"],
      );
      assert.equal(
        err.details.find((d) => d.path === "isActive").message,
        "Must be true or false.",
      );

      // Mongoose keeps the old value when a cast fails, so this alone must still be refused.
      const castOnly = await failure(
        updateOrgUnit(f.admin._id, f.dic._id, { isActive: "maybe" }),
      );
      assertError(castOnly, 400, "VALIDATION_ERROR");

      const unit = await unitOf(f.dic);
      assert.equal(unit.name, "Design and Innovation Centre");
      assert.equal(unit.type, "centre");
      assert.equal(unit.isActive, true);
      assert.equal((await audits()).length, 0);
    });

    test("a patch that changes nothing writes, audits and invalidates nothing", async () => {
      await listOrgUnits();
      const unit = await updateOrgUnit(f.admin._id, f.dic._id, {
        name: "Design and Innovation Centre",
        type: "centre",
      });
      assert.equal(unit.name, "Design and Innovation Centre");
      assert.equal((await audits()).length, 0);
      assert.notEqual(await redis.get(keys.catalogue("orgunits")), null);
    });
  });

  describe("managers", () => {
    test("assigning gives the unit and the manager role; unassigning takes both away", async () => {
      await listOrgUnits();
      const unit = await setOrgUnitManagers(
        f.admin._id,
        f.dic._id,
        [f.manager._id, f.student._id, String(f.student._id)],
        { requestId: "req-managers" },
      );
      assert.deepEqual(ids(unit.managers), [
        String(f.manager._id),
        String(f.student._id),
      ]);
      const student = await userOf(f.student);
      assert.deepEqual(student.roles, ["member", "manager"]);
      assert.deepEqual(ids(student.managedOrgUnits), [String(f.dic._id)]);
      assert.ok(managesUnit(student, f.dic._id));
      assert.equal(await redis.get(keys.catalogue("orgunits")), null);

      const [entry] = await audits();
      assert.equal(entry.action, "org_unit.managers_changed");
      assert.deepEqual(entry.actor, { id: f.admin._id, role: "admin" });
      assert.deepEqual(entry.entity, { type: "org_unit", id: f.dic._id });
      assert.equal(entry.requestId, "req-managers");
      assert.deepEqual(entry.changes, {
        managers: [
          [String(f.manager._id)],
          [String(f.manager._id), String(f.student._id)],
        ],
      });

      await setOrgUnitManagers(f.admin._id, f.dic._id, [f.student._id]);
      const manager = await userOf(f.manager);
      assert.deepEqual(manager.roles, ["member"]);
      assert.deepEqual(manager.managedOrgUnits, []);
      assert.ok(!managesUnit(manager, f.dic._id));
      assert.deepEqual((await userOf(f.student)).roles, ["member", "manager"]);
      assert.deepEqual(ids((await unitOf(f.dic)).managers), [
        String(f.student._id),
      ]);
    });

    test("someone who still manages another unit keeps the manager role", async () => {
      await setOrgUnitManagers(f.admin._id, f.cse._id, [
        f.cseManager._id,
        f.manager._id,
      ]);
      assert.deepEqual(ids((await userOf(f.manager)).managedOrgUnits), [
        String(f.dic._id),
        String(f.cse._id),
      ]);

      await setOrgUnitManagers(f.admin._id, f.dic._id, []);
      const manager = await userOf(f.manager);
      assert.deepEqual(manager.roles, ["member", "manager"]);
      assert.deepEqual(ids(manager.managedOrgUnits), [String(f.cse._id)]);
      assert.ok(managesUnit(manager, f.cse._id));
      assert.ok(!managesUnit(manager, f.dic._id));
      assert.deepEqual((await unitOf(f.dic)).managers, []);

      // From an empty list back to one manager: the role is added once, not twice.
      await setOrgUnitManagers(f.admin._id, f.dic._id, [f.manager._id]);
      const again = await userOf(f.manager);
      assert.deepEqual(again.roles, ["member", "manager"]);
      assert.deepEqual(ids(again.managedOrgUnits), [
        String(f.cse._id),
        String(f.dic._id),
      ]);
      assert.deepEqual(ids((await unitOf(f.dic)).managers), [
        String(f.manager._id),
      ]);
    });

    test("no other role is touched: an admin stays an admin, a manager-only user becomes a member", async () => {
      await setOrgUnitManagers(f.admin._id, f.dic._id, [f.admin._id]);
      let admin = await userOf(f.admin);
      assert.deepEqual(admin.roles, ["admin", "manager"]);
      assert.deepEqual(ids(admin.managedOrgUnits), [String(f.dic._id)]);

      await setOrgUnitManagers(f.admin._id, f.dic._id, []);
      admin = await userOf(f.admin);
      assert.deepEqual(admin.roles, ["admin"]);
      assert.deepEqual(admin.managedOrgUnits, []);

      const technician = await User.create({
        name: "Lab Technician",
        email: "technician@demo.campuscommons.test",
        passwordHash: "x".repeat(60),
        roles: ["manager"],
        managedOrgUnits: [f.cse._id],
      });
      await OrgUnit.updateOne(
        { _id: f.cse._id },
        { managers: [f.cseManager._id, technician._id] },
      );
      await setOrgUnitManagers(f.admin._id, f.cse._id, [f.cseManager._id]);
      assert.deepEqual((await userOf(technician)).roles, ["member"]);
      assert.deepEqual((await userOf(f.cseManager)).roles, [
        "member",
        "manager",
      ]);
    });

    test("bad ids are a 400 naming each entry, and nothing changes", async () => {
      const unknown = new mongoose.Types.ObjectId();
      const err = await failure(
        setOrgUnitManagers(f.admin._id, f.dic._id, [
          f.student._id,
          "demo-user-id-001",
          unknown,
          { $ne: null },
          String(unknown),
        ]),
      );
      assertError(err, 400, "VALIDATION_ERROR");
      assert.equal(err.message, "3 manager ids aren't users.");
      assert.deepEqual(err.details, [
        { path: "managerIds.1", message: "Must be a valid id." },
        { path: "managerIds.2", message: `No user has the id ${unknown}.` },
        { path: "managerIds.3", message: "Must be a valid id." },
      ]);
      assert.deepEqual(ids((await unitOf(f.dic)).managers), [
        String(f.manager._id),
      ]);
      assert.deepEqual((await userOf(f.student)).roles, ["member"]);
      assert.equal((await audits()).length, 0);

      const notAList = await failure(
        setOrgUnitManagers(f.admin._id, f.dic._id, String(f.student._id)),
      );
      assertError(notAList, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        notAList.details.map((d) => d.path),
        ["managerIds"],
      );

      const tooMany = Array.from(
        { length: 51 },
        () => new mongoose.Types.ObjectId(),
      );
      assertError(
        await failure(setOrgUnitManagers(f.admin._id, f.dic._id, tooMany)),
        400,
        "VALIDATION_ERROR",
      );
    });

    test("the same managers again (in any order) write and audit nothing", async () => {
      await setOrgUnitManagers(f.admin._id, f.dic._id, [
        f.manager._id,
        f.student._id,
      ]);
      await setOrgUnitManagers(f.admin._id, f.dic._id, [
        f.student._id,
        f.manager._id,
      ]);
      assert.equal((await audits()).length, 1);
      assert.deepEqual(ids((await unitOf(f.dic)).managers), [
        String(f.manager._id),
        String(f.student._id),
      ]);
    });

    test("two admins setting managers at once leave the unit and its users agreeing", async () => {
      const results = await Promise.allSettled([
        setOrgUnitManagers(f.admin._id, f.dic._id, [f.student._id]),
        setOrgUnitManagers(f.admin._id, f.dic._id, [f.student2._id]),
      ]);
      for (const r of results.filter((r) => r.status === "rejected")) {
        assertError(r.reason, 409, "INVALID_TRANSITION");
      }
      const managers = ids((await unitOf(f.dic)).managers);
      assert.equal(managers.length, 1);
      for (const who of [f.manager, f.student, f.student2]) {
        const user = await userOf(who);
        const listed = managers.includes(String(who._id));
        assert.equal(
          ids(user.managedOrgUnits).includes(String(f.dic._id)),
          listed,
        );
        assert.equal(user.roles.includes("manager"), listed);
      }
    });

    // The unit and its users are separate writes, so these break the user sync on purpose.
    const realUpdateMany = User.updateMany;
    const passThrough = (args) => realUpdateMany.apply(User, args);
    const pulls = (update) => Boolean(update?.$pull?.managedOrgUnits);
    const adds = (update) => Boolean(update?.$addToSet?.managedOrgUnits);
    const holdsUnit = async (who, unit = f.dic) =>
      managesUnit(await userOf(who), unit._id);

    test("a user sync that fails part-way is finished by calling again with the same list", async (t) => {
      let failNext = pulls;
      t.mock.method(User, "updateMany", function (...args) {
        if (failNext?.(args[1])) {
          failNext = null;
          return Promise.reject(new Error("connection reset"));
        }
        return passThrough(args);
      });
      await listOrgUnits();

      const err = await failure(
        setOrgUnitManagers(f.admin._id, f.dic._id, [f.student._id]),
      );
      assert.equal(err.message, "connection reset");
      // The unit's list was written, and that change is on record.
      assert.deepEqual(ids((await unitOf(f.dic)).managers), [
        String(f.student._id),
      ]);
      assert.equal(await holdsUnit(f.manager), true);

      await setOrgUnitManagers(f.admin._id, f.dic._id, [f.student._id]);
      assert.equal(await holdsUnit(f.manager), false);
      assert.deepEqual((await userOf(f.manager)).roles, ["member"]);
      assert.equal(await holdsUnit(f.student), true);
      assert.equal(await redis.get(keys.catalogue("orgunits")), null);
      const entries = await audits();
      assert.deepEqual(
        entries.map((e) => e.changes.managers),
        [
          [[String(f.manager._id)], [String(f.student._id)]],
          // The repair: the removed manager still held the unit until now.
          [
            [String(f.student._id), String(f.manager._id)],
            [String(f.student._id)],
          ],
        ],
      );

      // The other direction: the new manager is listed but never got the unit or the role.
      failNext = adds;
      await failure(
        setOrgUnitManagers(f.admin._id, f.dic._id, [f.student2._id]),
      );
      assert.equal(await holdsUnit(f.student2), false);
      await setOrgUnitManagers(f.admin._id, f.dic._id, [f.student2._id]);
      assert.equal(await holdsUnit(f.student2), true);
      assert.equal(await holdsUnit(f.student), false);

      // Nothing out of step: the same list again changes and audits nothing.
      const count = (await audits()).length;
      await setOrgUnitManagers(f.admin._id, f.dic._id, [f.student2._id]);
      assert.equal((await audits()).length, count);
    });

    test("users who hold the unit without being on its list lose it", async () => {
      // As a role edit made elsewhere (PATCH /admin/users/:id/roles) could leave them.
      await User.updateOne(
        { _id: f.student._id },
        { roles: ["member", "manager"], managedOrgUnits: [f.dic._id] },
      );
      assert.equal(await holdsUnit(f.student), true);

      await setOrgUnitManagers(f.admin._id, f.dic._id, [f.manager._id]);
      assert.equal(await holdsUnit(f.student), false);
      assert.deepEqual((await userOf(f.student)).roles, ["member"]);
      assert.equal(await holdsUnit(f.manager), true);
      const [entry] = await audits();
      assert.deepEqual(entry.changes, {
        managers: [
          [String(f.manager._id), String(f.student._id)],
          [String(f.manager._id)],
        ],
      });

      await User.updateOne(
        { _id: f.student._id },
        { roles: ["member", "manager"], managedOrgUnits: [f.dic._id] },
      );
      await setOrgUnitManagers(f.admin._id, f.dic._id, []);
      assert.equal(await holdsUnit(f.student), false);
      assert.equal(await holdsUnit(f.manager), false);
    });

    test("an admin whose user sync lands late can't undo a later admin's list", async (t) => {
      let release;
      const gate = new Promise((resolve) => (release = resolve));
      let held = false;
      t.mock.method(User, "updateMany", function (...args) {
        const [filter, update] = args;
        const targets = (filter?._id?.$in ?? []).map(String);
        if (!held && adds(update) && targets.includes(String(f.student._id))) {
          held = true;
          return gate.then(() => passThrough(args));
        }
        return passThrough(args);
      });

      // Admin A's unit write lands, but adding the student is delayed.
      const first = setOrgUnitManagers(f.admin._id, f.dic._id, [
        f.student._id,
      ]).catch((err) => err);
      for (let i = 0; !held && i < 300; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(held);
      // Admin B reads the student's list and replaces it before A's sync finishes.
      await setOrgUnitManagers(f.admin._id, f.dic._id, [f.manager._id]);
      release();
      const outcome = await first;
      if (outcome instanceof Error)
        assertError(outcome, 409, "INVALID_TRANSITION");

      assert.deepEqual(ids((await unitOf(f.dic)).managers), [
        String(f.manager._id),
      ]);
      assert.equal(await holdsUnit(f.manager), true);
      assert.equal(await holdsUnit(f.student), false);
      assert.deepEqual((await userOf(f.student)).roles, ["member"]);
    });
  });
});
