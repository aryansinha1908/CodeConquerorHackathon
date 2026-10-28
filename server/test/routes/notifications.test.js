// /api/v1/notifications over HTTP (architecture.md §6 Notifications): the whole app on port 0, a real
// MongoDB through fixtures.js (skipped without TEST_MONGODB_URI) and ioredis-mock. The reading rules
// are tested in test/integration/notifyService.test.js; this covers the routing (read-all isn't taken
// for an id), the middleware and the envelope. Someone else's notification is 404, not 403
// (progress.md §5), so the 403 here is the suspension check on the mutating routes.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import logger from "../../src/lib/logger.js";
import { Notification, User } from "../../src/models/index.js";
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

// Oldest first, a minute apart, so "newest first" has an order to check.
async function inbox(user, titles) {
  const start = Date.now() - titles.length * 60_000;
  return Notification.insertMany(
    titles.map((title, i) => ({
      user: user._id,
      type: "booking.approved",
      title,
      body: `${title}.`,
      link: "/bookings",
      createdAt: new Date(start + i * 60_000),
    })),
  );
}

describe("/api/v1/notifications", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const api = useApi();

  const unread = async (user) =>
    (await api.call("GET", "/notifications/unread-count", { user })).body.data
      .count;

  test("signed out is 401 UNAUTHENTICATED on every route", async () => {
    for (const [method, path] of [
      ["GET", "/notifications"],
      ["GET", "/notifications/unread-count"],
      ["PATCH", "/notifications/read-all"],
      ["PATCH", "/notifications/0123456789abcdef01234567/read"],
    ])
      assertError(await api.call(method, path), 401, "UNAUTHENTICATED");
  });

  test("GET /notifications: only the viewer's, newest first, with meta.unread", async () => {
    const [first] = await inbox(f.student, ["One", "Two", "Three"]);
    await inbox(f.student2, ["Someone else's"]);
    await Notification.updateOne({ _id: first._id }, { readAt: new Date() });

    const res = await api.call("GET", "/notifications", { user: f.student });
    assertEnvelope(res, 200);
    assert.deepEqual(res.body.meta, {
      page: 1,
      limit: 20,
      total: 3,
      unread: 2,
    });
    assert.deepEqual(
      res.body.data.map((n) => n.title),
      ["Three", "Two", "One"],
    );
    assert.equal("user" in res.body.data[0], false);
    assert.deepEqual(Object.keys(res.body.data[0]).sort(), [
      "_id",
      "body",
      "createdAt",
      "link",
      "readAt",
      "title",
      "type",
      "updatedAt",
    ]);

    const page = await api.call("GET", "/notifications?unread=true&limit=1", {
      user: f.student,
    });
    assertEnvelope(page, 200);
    assert.deepEqual(page.body.meta, {
      page: 1,
      limit: 1,
      total: 2,
      unread: 2,
    });
    assert.deepEqual(
      page.body.data.map((n) => n.title),
      ["Three"],
    );
  });

  test("GET /notifications: bad query values are 400 with details", async () => {
    const res = await api.call("GET", "/notifications?unread=maybe&page=0", {
      user: f.student,
    });
    assertError(res, 400, "VALIDATION_ERROR");
    assert.deepEqual(res.body.error.details, [
      { path: "unread", message: "Must be true or false." },
      { path: "page", message: "Must be a whole number from 1 to 10000." },
    ]);
  });

  test("GET /notifications/unread-count → { count }", async () => {
    await inbox(f.student, ["One", "Two"]);
    const res = await api.call("GET", "/notifications/unread-count", {
      user: f.student,
    });
    assertEnvelope(res, 200);
    assert.deepEqual(res.body.data, { count: 2 });
    assert.equal("meta" in res.body, false);
    assert.equal(await unread(f.student2), 0);
  });

  test("PATCH /notifications/:id/read → the notification; someone else's is 404", async () => {
    const [mine] = await inbox(f.student, ["Mine"]);
    const [theirs] = await inbox(f.student2, ["Theirs"]);

    const res = await api.call("PATCH", `/notifications/${mine._id}/read`, {
      user: f.student,
    });
    assertEnvelope(res, 200);
    assert.equal(res.body.data._id, String(mine._id));
    assert.ok(res.body.data.readAt);
    // Again: the first readAt stays.
    const again = await api.call("PATCH", `/notifications/${mine._id}/read`, {
      user: f.student,
    });
    assert.equal(again.body.data.readAt, res.body.data.readAt);

    for (const id of [theirs._id, "not-an-id"])
      assertError(
        await api.call("PATCH", `/notifications/${id}/read`, {
          user: f.student,
        }),
        404,
        "NOT_FOUND",
      );
    assert.equal(await unread(f.student2), 1);
  });

  test("PATCH /notifications/read-all → { updated }, routed to read-all rather than read as an id", async () => {
    await inbox(f.student, ["One", "Two", "Three"]);
    await inbox(f.student2, ["Theirs"]);

    const res = await api.call("PATCH", "/notifications/read-all", {
      user: f.student,
    });
    assertEnvelope(res, 200);
    assert.deepEqual(res.body.data, { updated: 3 });
    assert.equal(await unread(f.student), 0);
    assert.equal(await unread(f.student2), 1);

    const again = await api.call("PATCH", "/notifications/read-all", {
      user: f.student,
    });
    assert.deepEqual(again.body.data, { updated: 0 });
  });

  test("a suspended user can read notifications but not mark them (403)", async () => {
    const [one] = await inbox(f.student, ["One"]);
    await User.updateOne(
      { _id: f.student._id },
      {
        suspendedUntil: new Date(Date.now() + 24 * 60 * 60_000),
        suspensionReason: "Repeated no-shows",
      },
    );
    for (const path of [
      "/notifications/read-all",
      `/notifications/${one._id}/read`,
    ]) {
      const res = await api.call("PATCH", path, { user: f.student });
      assertError(res, 403, "FORBIDDEN");
      assert.equal(res.body.error.details.reason, "Repeated no-shows");
    }
    assertEnvelope(
      await api.call("GET", "/notifications", { user: f.student }),
      200,
    );
    assert.equal(await unread(f.student), 1);
  });
});
