// GET /api/v1/audit over HTTP (architecture.md §6 "Audit, uploads, admin, health", §7.2, §13.2): the
// whole app on port 0, a real MongoDB through fixtures.js (skipped without TEST_MONGODB_URI) and
// ioredis-mock. The query and its scope are tested in test/integration/auditService.test.js; this
// covers the routing, the middleware and the envelope.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import logger from "../../src/lib/logger.js";
import { AuditLog } from "../../src/models/index.js";
import { record } from "../../src/services/auditService.js";
import { skip, useTestDatabase } from "../integration/fixtures.js";
import { useApi } from "./http.js";

logger.level = "silent";

let f; // fixtures, rebuilt for every test

function assertEnvelope(res, status) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.ok("data" in res.body);
  assert.ok(res.body.requestId);
  assert.equal(res.body.requestId, res.headers.get("x-request-id"));
}

function assertError(res, status, code) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, code);
  assert.ok(res.body.requestId);
}

const actions = (res) => res.body.data.map((e) => e.action);

describe("/api/v1/audit", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const api = useApi();

  // Oldest first: a DIC entry, a CSE entry, and a user event with no unit (admin-only), with the
  // hash-chain fields C-02 will fill in, which the route leaves out.
  const history = async () => {
    await record({
      actor: { id: f.manager._id, role: "manager" },
      action: "resource.updated",
      entity: { type: "resource", id: f.printer._id },
      orgUnit: f.dic._id,
      changes: { title: ["Prusa MK3", "Prusa MK4 3D Printer"] },
      requestId: "req-dic",
    });
    await record({
      actor: { id: f.cseManager._id, role: "manager" },
      action: "resource.created",
      entity: { type: "resource", id: new mongoose.Types.ObjectId() },
      orgUnit: f.cse._id,
    });
    await AuditLog.create({
      actor: { id: f.admin._id, role: "admin" },
      action: "user.suspended",
      entity: { type: "user", id: f.student3._id },
      reason: "Repeated no-shows",
      prevHash: "0".repeat(64),
      hash: "f".repeat(64),
    });
  };

  test("signed out is 401 UNAUTHENTICATED", async () => {
    assertError(await api.call("GET", "/audit"), 401, "UNAUTHENTICATED");
  });

  test("an admin reads every entry, newest first, actors with their name only", async () => {
    await history();
    const res = await api.call("GET", "/audit", { user: f.admin });
    assertEnvelope(res, 200);
    assert.deepEqual(res.body.meta, { page: 1, limit: 20, total: 3 });
    assert.deepEqual(actions(res), [
      "user.suspended",
      "resource.created",
      "resource.updated",
    ]);
    const [suspended, , updated] = res.body.data;
    assert.deepEqual(suspended.actor, {
      id: String(f.admin._id),
      role: "admin",
      name: "Campus Admin",
    });
    assert.equal("hash" in suspended, false);
    assert.equal("prevHash" in suspended, false);
    assert.deepEqual(updated.orgUnit, {
      _id: String(f.dic._id),
      name: "Design and Innovation Centre",
      code: "dic",
    });
    assert.deepEqual(updated.changes, {
      title: ["Prusa MK3", "Prusa MK4 3D Printer"],
    });
    assert.equal(updated.requestId, "req-dic");

    const filtered = await api.call(
      "GET",
      `/audit?entityType=resource&orgUnit=${f.cse._id}&limit=5`,
      { user: f.admin },
    );
    assertEnvelope(filtered, 200);
    assert.deepEqual(actions(filtered), ["resource.created"]);
    assert.deepEqual(filtered.body.meta, { page: 1, limit: 5, total: 1 });
  });

  test("a manager reads their own units' entries only; another unit is 403", async () => {
    await history();
    const res = await api.call("GET", "/audit", { user: f.manager });
    assertEnvelope(res, 200);
    assert.deepEqual(actions(res), ["resource.updated"]);
    assert.equal(res.body.meta.total, 1);

    assertError(
      await api.call("GET", `/audit?orgUnit=${f.cse._id}`, { user: f.manager }),
      403,
      "FORBIDDEN",
    );
  });

  test("a member is 403, pointed to the booking timeline", async () => {
    await history();
    const res = await api.call("GET", "/audit", { user: f.student });
    assertError(res, 403, "FORBIDDEN");
    assert.match(res.body.error.message, /timeline/);
  });

  test("bad filters are 400 with details", async () => {
    const res = await api.call(
      "GET",
      "/audit?action=Approved&entityId=nope&from=2026-11-03T10:00:00Z&to=2026-11-02T10:00:00Z",
      { user: f.admin },
    );
    assertError(res, 400, "VALIDATION_ERROR");
    assert.deepEqual(
      res.body.error.details.map((d) => d.path),
      ["entityId", "action", "to"],
    );
  });
});
