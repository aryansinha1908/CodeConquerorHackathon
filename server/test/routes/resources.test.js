// /api/v1/resources over HTTP (architecture.md §6 Resources): the whole app on port 0, a real MongoDB
// through fixtures.js (skipped without TEST_MONGODB_URI) and ioredis-mock. The service's rules are
// tested in test/integration/resourceService.test.js; these check the wiring: auth, suspension, the
// envelope, how params, body and query reach the service, and that its answers reach the client.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import logger from "../../src/lib/logger.js";
import { AuditLog, Resource, User } from "../../src/models/index.js";
import { TUE, bookAs, skip, useTestDatabase } from "../integration/fixtures.js";
import { useApi } from "./http.js";

logger.level = "silent";

let f;

function assertError(res, status, code) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, code);
  assert.ok(res.body.requestId);
}

function assertOk(res, status = 200) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.equal(res.body.requestId, res.headers.get("x-request-id"));
}

const query = (params) => `?${new URLSearchParams(params)}`;

const form = (extra = {}) => ({
  orgUnit: String(f.dic._id),
  title: "Soldering Station",
  category: "tool",
  availability: { weekly: [{ day: 1, open: "09:00", close: "17:00" }] },
  eligibility: { memberTypes: ["ug"], badges: [String(f.badge._id)] },
  limits: { maxHoursPerWeek: 4 },
  checklist: ["Tip tinned"],
  ...extra,
});

describe("/api/v1/resources", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const api = useApi();

  test("signed out is 401 UNAUTHENTICATED on every route", async () => {
    const id = f.printer._id;
    for (const [method, path, json] of [
      ["GET", "/resources"],
      ["POST", "/resources", {}],
      ["GET", `/resources/${id}`],
      ["PATCH", `/resources/${id}`, { title: "Renamed" }],
      ["PATCH", `/resources/${id}/status`, { status: "active" }],
      ["GET", `/resources/${id}/availability`],
      ["GET", `/resources/${id}/eligibility`],
      ["GET", `/resources/${id}/bookings`],
    ]) {
      const res = await api.call(method, path, { json });
      assertError(res, 401, "UNAUTHENTICATED");
    }
  });

  test("GET /resources: the active cards with { page, limit, total } in meta", async () => {
    const res = await api.call("GET", "/resources", { user: f.student });
    assertOk(res);
    assert.deepEqual(
      res.body.data.map((r) => r.title),
      ["Arduino IoT Kit", "Prusa MK4 3D Printer"],
    );
    assert.deepEqual(res.body.meta, { page: 1, limit: 20, total: 2 });
    const [kits] = res.body.data;
    assert.equal(kits.orgUnit.code, "dic");
    assert.equal(kits.openHours, "Mon–Sat 09:00–17:00");
    assert.ok(!("createdBy" in kits) && !("checklist" in kits));

    // Query values reach the service as they are.
    const paged = await api.call("GET", `/resources${query({ limit: 1 })}`, {
      user: f.student,
    });
    assertOk(paged);
    assert.equal(paged.body.data.length, 1);
    assert.deepEqual(paged.body.meta, { page: 1, limit: 1, total: 2 });
  });

  test("GET /resources: a member asking for non-active ones is 403; a bad filter is 400 with details", async () => {
    const hidden = await api.call(
      "GET",
      `/resources${query({ status: "maintenance" })}`,
      { user: f.student },
    );
    assertError(hidden, 403, "FORBIDDEN");
    const bad = await api.call(
      "GET",
      `/resources${query({ category: "boats", page: "0" })}`,
      { user: f.student },
    );
    assertError(bad, 400, "VALIDATION_ERROR");
    assert.deepEqual(bad.body.error.details, [
      {
        path: "category",
        message: "Must be one of: space, equipment, computing, tool.",
      },
      { path: "page", message: "Must be a whole number from 1 to 10000." },
    ]);
    // Express's query parser makes a repeated key a list; the service refuses it, never a 500.
    const twice = await api.call("GET", "/resources?q=a&q=b", {
      user: f.student,
    });
    assertError(twice, 400, "VALIDATION_ERROR");
    assert.deepEqual(twice.body.error.details, [
      { path: "q", message: "Must be text." },
    ]);
  });

  test("GET /resources/:id: the detail with canManage; an unknown id is 404", async () => {
    const member = await api.call("GET", `/resources/${f.printer._id}`, {
      user: f.student,
    });
    assertOk(member);
    assert.equal(member.body.data.title, "Prusa MK4 3D Printer");
    assert.equal(member.body.data.canManage, false);
    assert.deepEqual(member.body.data.checklist, [
      "Nozzle clean",
      "Build plate undamaged",
    ]);
    assert.equal(
      member.body.data.eligibility.badges[0].name,
      "3D Printing Basics",
    );
    assert.ok(!("meta" in member.body));

    const manager = await api.call("GET", `/resources/${f.printer._id}`, {
      user: f.manager,
    });
    assert.equal(manager.body.data.canManage, true);

    for (const id of [f.dic._id, "not-an-id"]) {
      const res = await api.call("GET", `/resources/${id}`, {
        user: f.student,
      });
      assertError(res, 404, "NOT_FOUND");
    }
  });

  test("POST /resources: the unit's manager lists one → 201, audited under the request id", async () => {
    const res = await api.call("POST", "/resources", {
      user: f.manager,
      json: form(),
    });
    assertOk(res, 201);
    assert.equal(res.body.data.title, "Soldering Station");
    assert.equal(res.body.data.status, "active");
    assert.equal(res.body.data.orgUnit.code, "dic");
    assert.equal(res.body.data.canManage, true);
    const entry = await AuditLog.findOne({ action: "resource.created" }).lean();
    assert.equal(entry.requestId, res.body.requestId);

    const listed = await api.call("GET", "/resources", { user: f.student });
    assert.equal(listed.body.meta.total, 3);
  });

  test("POST /resources: another unit's manager is 403; a refused field is 400 with details", async () => {
    const other = await api.call("POST", "/resources", {
      user: f.cseManager,
      json: form(),
    });
    assertError(other, 403, "FORBIDDEN");
    const refused = await api.call("POST", "/resources", {
      user: f.manager,
      json: form({ status: "archived", title: "ab" }),
    });
    assertError(refused, 400, "VALIDATION_ERROR");
    assert.deepEqual(refused.body.error.details, [
      {
        path: "status",
        message:
          "Change the status with the status action, which asks for a reason.",
      },
    ]);
    assert.equal(await Resource.countDocuments(), 2);
  });

  test("PATCH /resources/:id: the manager edits it; a member is 403; a suspended manager is 403", async () => {
    const res = await api.call("PATCH", `/resources/${f.printer._id}`, {
      user: f.manager,
      json: { title: "Prusa MK4 (Bay 2)", limits: { maxHoursPerWeek: 8 } },
    });
    assertOk(res);
    assert.equal(res.body.data.title, "Prusa MK4 (Bay 2)");
    assert.equal(res.body.data.limits.maxHoursPerWeek, 8);
    assert.equal(res.body.data.limits.maxActiveBookings, 1); // the rest of the section is kept
    const entry = await AuditLog.findOne({ action: "resource.updated" }).lean();
    assert.equal(entry.requestId, res.body.requestId);

    const member = await api.call("PATCH", `/resources/${f.printer._id}`, {
      user: f.student,
      json: { title: "Mine" },
    });
    assertError(member, 403, "FORBIDDEN");

    await User.updateOne(
      { _id: f.manager._id },
      { suspendedUntil: new Date(Date.now() + 86_400_000) },
    );
    const suspended = await api.call("PATCH", `/resources/${f.printer._id}`, {
      user: f.manager,
      json: { title: "Suspended edit" },
    });
    assertError(suspended, 403, "FORBIDDEN");
    assert.match(suspended.body.error.message, /suspended/);
    assert.equal(
      (await Resource.findById(f.printer._id).lean()).title,
      "Prusa MK4 (Bay 2)",
    );
  });

  test("PATCH /resources/:id/status: → { resource, affectedBookings }; no reason is 400 with details", async () => {
    const missing = await api.call(
      "PATCH",
      `/resources/${f.printer._id}/status`,
      { user: f.manager, json: { status: "maintenance" } },
    );
    assertError(missing, 400, "VALIDATION_ERROR");
    assert.deepEqual(missing.body.error.details, [
      {
        path: "reason",
        message: "Say why, so members and the audit log know.",
      },
    ]);

    const res = await api.call("PATCH", `/resources/${f.printer._id}/status`, {
      user: f.manager,
      json: { status: "maintenance", reason: "Nozzle replacement" },
    });
    assertOk(res);
    assert.deepEqual(Object.keys(res.body.data).sort(), [
      "affectedBookings",
      "resource",
    ]);
    assert.equal(res.body.data.resource.status, "maintenance");
    assert.equal(res.body.data.affectedBookings, 0);
    const entry = await AuditLog.findOne({
      action: "resource.status_changed",
    }).lean();
    assert.equal(entry.requestId, res.body.requestId);
    assert.equal(entry.reason, "Nozzle replacement");

    const other = await api.call(
      "PATCH",
      `/resources/${f.printer._id}/status`,
      { user: f.cseManager, json: { status: "active" } },
    );
    assertError(other, 403, "FORBIDDEN");
  });

  test("GET /resources/:id/availability: from and to from the query → { quantity, openWindows, busy }", async () => {
    await bookAs(f.student, f.kits, TUE);
    const range = { from: TUE.start.toISOString(), to: TUE.end.toISOString() };
    const res = await api.call(
      "GET",
      `/resources/${f.kits._id}/availability${query(range)}`,
      { user: f.student2 },
    );
    assertOk(res);
    assert.deepEqual(res.body.data, {
      quantity: 2,
      openWindows: [range].map(({ from, to }) => ({ start: from, end: to })),
      busy: [{ start: range.from, end: range.to, inUse: 1, full: false }],
    });

    const open = await api.call(
      "GET",
      `/resources/${f.kits._id}/availability${query({ from: range.from })}`,
      { user: f.student2 },
    );
    assertError(open, 400, "VALIDATION_ERROR");
    assert.deepEqual(open.body.error.details, [
      { path: "to", message: "Required." },
    ]);
  });

  test("GET /resources/:id/eligibility: the checklist and quota, or the slot check with start and end", async () => {
    const res = await api.call(
      "GET",
      `/resources/${f.printer._id}/eligibility`,
      { user: f.student },
    );
    assertOk(res);
    assert.equal(typeof res.body.data.eligible, "boolean");
    assert.ok(res.body.data.results.some((r) => r.rule === "BADGES"));
    assert.ok(!res.body.data.results.some((r) => r.rule === "OPEN_HOURS"));
    assert.deepEqual(Object.keys(res.body.data.quota).sort(), [
      "activeCount",
      "hoursThisWeek",
      "maxActiveBookings",
      "maxHoursPerWeek",
    ]);
    assert.equal(res.body.data.quota.maxHoursPerWeek, 6);

    const slot = await api.call(
      "GET",
      `/resources/${f.printer._id}/eligibility${query({
        start: TUE.start.toISOString(),
        end: TUE.end.toISOString(),
      })}`,
      { user: f.student },
    );
    assertOk(slot);
    assert.deepEqual(Object.keys(slot.body.data).sort(), [
      "eligible",
      "outcome",
      "results",
      "waitlistPosition",
    ]);
    assert.ok(slot.body.data.results.some((r) => r.rule === "OPEN_HOURS"));

    const half = await api.call(
      "GET",
      `/resources/${f.printer._id}/eligibility${query({ start: "tomorrow" })}`,
      { user: f.student },
    );
    assertError(half, 400, "VALIDATION_ERROR");
    assert.deepEqual(half.body.error.details, [
      { path: "start", message: "Must be a valid date." },
      { path: "end", message: "Required." },
    ]);
  });

  test("GET /resources/:id/bookings: the unit's managers get the list without emails; a member is 403", async () => {
    await bookAs(f.student, f.kits, TUE);
    const res = await api.call("GET", `/resources/${f.kits._id}/bookings`, {
      user: f.manager,
    });
    assertOk(res);
    assert.deepEqual(res.body.meta, { page: 1, limit: 20, total: 1 });
    const [booking] = res.body.data;
    assert.equal(booking.status, "approved");
    assert.equal(booking.borrower.name, "Ananya Rao");
    assert.equal(booking.borrower.department.code, "cse");
    assert.ok(!("email" in booking.borrower));

    const member = await api.call("GET", `/resources/${f.kits._id}/bookings`, {
      user: f.student,
    });
    assertError(member, 403, "FORBIDDEN");
    const bad = await api.call(
      "GET",
      `/resources/${f.kits._id}/bookings${query({ status: "lost" })}`,
      { user: f.manager },
    );
    assertError(bad, 400, "VALIDATION_ERROR");
    assert.equal(bad.body.error.details[0].path, "status");
  });
});
