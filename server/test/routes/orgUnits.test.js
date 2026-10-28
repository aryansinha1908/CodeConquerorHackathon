// GET /api/v1/org-units over HTTP (architecture.md §6 OrgUnits): the whole app on port 0, a real
// MongoDB through fixtures.js (skipped without TEST_MONGODB_URI) and ioredis-mock for the cache.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import app from "../../src/app.js";
import logger from "../../src/lib/logger.js";
import { OrgUnit, User } from "../../src/models/index.js";
import { signAccessToken } from "../../src/services/authTokens.js";
import { skip, useTestDatabase } from "../integration/fixtures.js";

logger.level = "silent";
process.env.ACCESS_TOKEN_SECRET = "test-access-secret";

let f;
let server;
let origin;

async function list(user, query = "") {
  const headers = user
    ? { authorization: `Bearer ${signAccessToken(user)}` }
    : {};
  const res = await fetch(`${origin}/api/v1/org-units${query}`, { headers });
  return { status: res.status, body: await res.json() };
}

const codes = (res) => res.body.data.map((u) => u.code);

describe("/api/v1/org-units", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  before(async () => {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.close();
    await once(server, "close");
  });

  test("any signed-in user gets the active units by name, without managers", async () => {
    await OrgUnit.create({
      name: "Central Workshop",
      code: "workshop",
      type: "central_facility",
      location: { building: "Workshop Block" },
      isActive: false,
    });
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

  test("signed out is 401 UNAUTHENTICATED", async () => {
    const res = await list(null);
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "UNAUTHENTICATED");
  });
});
