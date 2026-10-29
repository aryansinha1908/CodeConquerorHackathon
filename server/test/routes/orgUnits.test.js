// /api/v1/org-units over HTTP (architecture.md §6 OrgUnits): the whole app on port 0, a real MongoDB
// through fixtures.js (skipped without TEST_MONGODB_URI) and ioredis-mock for the cache. The
// service's rules are tested in test/integration/orgUnitService.test.js; these check the wiring:
// auth, suspension, the envelope, and that the service's answers reach the client.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import logger from "../../src/lib/logger.js";
import { AuditLog, OrgUnit, User } from "../../src/models/index.js";
import { skip, useTestDatabase } from "../integration/fixtures.js";
import { useApi } from "./http.js";

logger.level = "silent";

let f;

const codes = (res) => res.body.data.map((u) => u.code);

function assertError(res, status, code) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, code);
  assert.ok(res.body.requestId);
}

const WORKSHOP = {
  name: "Central Workshop",
  code: "workshop",
  type: "central_facility",
  location: { building: "Workshop Block" },
};

const suspend = (user) =>
  User.updateOne(
    { _id: user._id },
    {
      suspendedUntil: new Date(Date.now() + 86_400_000),
      suspensionReason: "Testing",
    },
  );

describe("/api/v1/org-units", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const api = useApi();
  const list = (user, query = "") =>
    api.call("GET", `/org-units${query}`, { user });

  test("any signed-in user gets the active units by name, without managers", async () => {
    await OrgUnit.create({ ...WORKSHOP, isActive: false });
    const res = await list(f.student);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.ok(res.body.requestId);
    assert.deepEqual(codes(res), ["cse", "dic"]);
    const [cse] = res.body.data;
    assert.deepEqual(Object.keys(cse).sort(), [
      "_id",
      "code",
      "isActive",
      "name",
      "type",
    ]);
    assert.deepEqual(cse, {
      _id: String(f.cse._id),
      name: "Computer Science and Engineering",
      code: "cse",
      type: "department",
      isActive: true,
    });

    // Only the literal "true" adds the inactive ones.
    assert.deepEqual(codes(await list(f.student, "?includeInactive=yes")), [
      "cse",
      "dic",
    ]);
    const all = await list(f.student, "?includeInactive=true");
    // By name: Central Workshop, Computer Science…, Design and Innovation Centre.
    assert.deepEqual(codes(all), ["workshop", "cse", "dic"]);
    const workshop = all.body.data.find((u) => u.code === "workshop");
    assert.equal(workshop.isActive, false);
    assert.deepEqual(workshop.location, { building: "Workshop Block" });
    assert.ok(all.body.data.every((u) => !("managers" in u)));
  });

  test("admins also get each unit's manager ids; a manager doesn't", async () => {
    const admin = await list(f.admin);
    assert.equal(admin.status, 200);
    const dic = admin.body.data.find((u) => u.code === "dic");
    assert.deepEqual(dic.managers, [String(f.manager._id)]);

    const manager = await list(f.manager);
    assert.ok(manager.body.data.every((u) => !("managers" in u)));

    // The role is read from the database: a token that still says admin doesn't count.
    await User.updateOne({ _id: f.admin._id }, { roles: ["member"] });
    const demoted = await list(f.admin);
    assert.ok(demoted.body.data.every((u) => !("managers" in u)));
  });

  test("signed out is 401 UNAUTHENTICATED on every route", async () => {
    const id = f.dic._id;
    for (const [method, path, json] of [
      ["GET", "/org-units"],
      ["POST", "/org-units", WORKSHOP],
      ["PATCH", `/org-units/${id}`, { name: "Renamed" }],
      ["PUT", `/org-units/${id}/managers`, { managerIds: [] }],
    ]) {
      const res = await api.call(method, path, { json });
      assertError(res, 401, "UNAUTHENTICATED");
    }
  });

  test("POST: an admin creates a unit → 201, audited under the request id, listed at once", async () => {
    assert.deepEqual(codes(await list(f.student)), ["cse", "dic"]); // cached
    const res = await api.call("POST", "/org-units", {
      user: f.admin,
      json: WORKSHOP,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(res.body.requestId, res.headers.get("x-request-id"));
    assert.equal(res.body.data.code, "workshop");
    assert.equal(res.body.data.isActive, true);
    assert.deepEqual(res.body.data.location, { building: "Workshop Block" });

    const entry = await AuditLog.findOne({ action: "org_unit.created" }).lean();
    assert.equal(entry.requestId, res.body.requestId);
    assert.deepEqual(codes(await list(f.student)), ["workshop", "cse", "dic"]);
  });

  test("POST: a manager or member is 403; a duplicate code is 400 with details", async () => {
    for (const user of [f.manager, f.student]) {
      const res = await api.call("POST", "/org-units", {
        user,
        json: WORKSHOP,
      });
      assertError(res, 403, "FORBIDDEN");
    }
    const taken = await api.call("POST", "/org-units", {
      user: f.admin,
      json: { name: "Another Centre", code: "dic", type: "centre" },
    });
    assertError(taken, 400, "VALIDATION_ERROR");
    assert.deepEqual(taken.body.error.details, [
      { path: "code", message: "Already used by another org unit." },
    ]);
    assert.equal(await OrgUnit.countDocuments(), 2);
  });

  test("PATCH: an admin renames a unit; the code can't change; an unknown id is 404", async () => {
    const res = await api.call("PATCH", `/org-units/${f.dic._id}`, {
      user: f.admin,
      json: { name: "Design & Innovation Centre" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.name, "Design & Innovation Centre");
    assert.equal(res.body.data.code, "dic");
    const entry = await AuditLog.findOne({ action: "org_unit.updated" }).lean();
    assert.equal(entry.requestId, res.body.requestId);

    const recode = await api.call("PATCH", `/org-units/${f.dic._id}`, {
      user: f.admin,
      json: { code: "innovation" },
    });
    assertError(recode, 400, "VALIDATION_ERROR");
    assert.deepEqual(recode.body.error.details, [
      { path: "code", message: "An org unit's code can't change." },
    ]);

    const missing = await api.call("PATCH", `/org-units/${f.student._id}`, {
      user: f.admin,
      json: { name: "Nowhere" },
    });
    assertError(missing, 404, "NOT_FOUND");
    const member = await api.call("PATCH", `/org-units/${f.dic._id}`, {
      user: f.manager,
      json: { name: "Mine now" },
    });
    assertError(member, 403, "FORBIDDEN");
  });

  test("PUT managers: an admin staffs a unit and the user becomes a manager of it", async () => {
    const res = await api.call("PUT", `/org-units/${f.dic._id}/managers`, {
      user: f.admin,
      json: { managerIds: [String(f.manager._id), String(f.student3._id)] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.managers, [
      String(f.manager._id),
      String(f.student3._id),
    ]);
    const promoted = await User.findById(f.student3._id).lean();
    assert.ok(promoted.roles.includes("manager"));
    assert.deepEqual(promoted.managedOrgUnits.map(String), [String(f.dic._id)]);
    const entry = await AuditLog.findOne({
      action: "org_unit.managers_changed",
    }).lean();
    assert.equal(entry.requestId, res.body.requestId);
  });

  test("PUT managers: no list, or an id that isn't a user, is 400 with details; a manager is 403", async () => {
    const none = await api.call("PUT", `/org-units/${f.dic._id}/managers`, {
      user: f.admin,
      json: {},
    });
    assertError(none, 400, "VALIDATION_ERROR");
    assert.deepEqual(none.body.error.details, [
      { path: "managerIds", message: "Must be a list of user ids." },
    ]);
    const stranger = await api.call("PUT", `/org-units/${f.dic._id}/managers`, {
      user: f.admin,
      json: { managerIds: [String(f.manager._id), String(f.dic._id)] },
    });
    assertError(stranger, 400, "VALIDATION_ERROR");
    assert.deepEqual(stranger.body.error.details, [
      { path: "managerIds.1", message: `No user has the id ${f.dic._id}.` },
    ]);
    const manager = await api.call("PUT", `/org-units/${f.dic._id}/managers`, {
      user: f.manager,
      json: { managerIds: [] },
    });
    assertError(manager, 403, "FORBIDDEN");
  });

  test("a suspended admin still reads but can't change a unit", async () => {
    await suspend(f.admin);
    assert.equal((await list(f.admin)).status, 200);
    const res = await api.call("PATCH", `/org-units/${f.dic._id}`, {
      user: f.admin,
      json: { name: "Renamed" },
    });
    assertError(res, 403, "FORBIDDEN");
    assert.match(res.body.error.message, /suspended/);
    assert.equal(
      (await OrgUnit.findById(f.dic._id).lean()).name,
      "Design and Innovation Centre",
    );
  });
});
