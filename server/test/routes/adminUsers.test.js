// GET /api/v1/admin/users over HTTP: the whole app on port 0, a real MongoDB through fixtures.js
// (skipped without TEST_MONGODB_URI) and ioredis-mock. The service's rules are tested in
// test/integration/userService.test.js; these check the wiring: auth, the admin role, the envelope
// with meta, and that a bad query reaches the client as 400 with details.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import logger from "../../src/lib/logger.js";
import { User } from "../../src/models/index.js";
import { skip, useTestDatabase } from "../integration/fixtures.js";
import { useApi } from "./http.js";

logger.level = "silent";

let f; // fixtures, rebuilt for every test

function assertError(res, status, code) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, code);
  assert.ok(res.body.requestId);
}

describe("GET /api/v1/admin/users", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const api = useApi();

  test("an admin searches users: list + meta, with emails and roles but nothing about the ID card", async () => {
    await User.updateOne(
      { _id: f.student._id },
      { "verification.idCardPublicId": "campuscommons/id-cards/secret" },
    );
    const res = await api.call("GET", "/admin/users?q=ANANYA", {
      user: f.admin,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.meta, { page: 1, limit: 20, total: 1 });
    assert.deepEqual(res.body.data, [
      {
        _id: String(f.student._id),
        name: "Ananya Rao",
        email: "student@demo.campuscommons.test",
        roles: ["member"],
        memberType: "ug",
        department: {
          _id: String(f.cse._id),
          code: "cse",
          name: "Computer Science and Engineering",
        },
        verification: { status: "approved" },
        managedOrgUnits: [],
        suspendedUntil: null,
      },
    ]);
    assert.equal(JSON.stringify(res.body).includes("secret"), false);

    const managers = await api.call(
      "GET",
      "/admin/users?role=manager&verification=approved&limit=1&page=2",
      { user: f.admin },
    );
    assert.equal(managers.status, 200, JSON.stringify(managers.body));
    assert.deepEqual(managers.body.meta, { page: 2, limit: 1, total: 2 });
    assert.equal(managers.body.data.length, 1);
  });

  test("signed out is 401, members and managers are 403, a bad query is 400 with details", async () => {
    assertError(await api.call("GET", "/admin/users"), 401, "UNAUTHENTICATED");
    for (const user of [f.student, f.manager])
      assertError(
        await api.call("GET", "/admin/users", { user }),
        403,
        "FORBIDDEN",
      );
    const bad = await api.call(
      "GET",
      "/admin/users?role=owner&role=admin&verification=done&limit=0",
      { user: f.admin },
    );
    assertError(bad, 400, "VALIDATION_ERROR");
    assert.deepEqual(
      bad.body.error.details.map((d) => d.path),
      ["role", "verification", "limit"],
    );
  });
});
