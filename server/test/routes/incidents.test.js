// /api/v1/incidents over HTTP (architecture.md §6 Incidents): the whole app on port 0, a real MongoDB
// through fixtures.js (skipped without TEST_MONGODB_URI) and ioredis-mock. The service's rules are
// tested in test/integration/incidentService.test.js; this covers the routing, the middleware, the
// photo origin check that runs before the service, and the envelope.
//
// The routes use the real clock, and a borrower can only report up to 7 days after a booking ends,
// so the reports here are made by managers (no time limit), keeping the tests independent of the date.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import logger from "../../src/lib/logger.js";
import { AuditLog, Incident, User } from "../../src/models/index.js";
import { transition } from "../../src/services/bookingService.js";
import {
  NOW,
  TUE,
  bookAs,
  skip,
  useTestDatabase,
} from "../integration/fixtures.js";
import { useApi } from "./http.js";

logger.level = "silent";

let f; // fixtures, rebuilt for every test

const CLOUD = "campus-test";
const photo = (name) => ({
  publicId: `campuscommons/photos/${name}`,
  url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1730000000/campuscommons/photos/${name}.jpg`,
});
const DAMAGE = {
  type: "damage",
  severity: "low",
  description: "Build plate scratched near the front edge.",
};
const RESOLUTION = {
  outcome: "warning",
  rationale: "Minor scratch; the borrower was reminded to use the scraper.",
};

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

describe("/api/v1/incidents", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const api = useApi();

  // photoProblems accepts only delivery URLs of this account.
  let savedCloud;
  before(() => {
    savedCloud = process.env.CLOUDINARY_CLOUD_NAME;
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
  });
  after(() => {
    if (savedCloud === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = savedCloud;
  });

  const report = (user, json) => api.call("POST", "/incidents", { user, json });
  // The DIC manager reports on the printer, with no booking.
  const reported = async (extra = {}) => {
    const res = await report(f.manager, {
      resourceId: f.printer._id,
      ...DAMAGE,
      ...extra,
    });
    assertEnvelope(res, 201);
    return res.body.data;
  };
  // The student's printer booking on Tuesday, approved by the DIC manager.
  const approvedBooking = async () => {
    const { booking } = await bookAs(f.student, f.printer, TUE);
    return transition(booking._id, "approve", f.manager._id, {}, { now: NOW });
  };

  test("signed out is 401 UNAUTHENTICATED on every route", async () => {
    const id = "0123456789abcdef01234567";
    for (const [method, path] of [
      ["POST", "/incidents"],
      ["GET", "/incidents"],
      ["GET", `/incidents/${id}`],
      ["POST", `/incidents/${id}/comments`],
      ["POST", `/incidents/${id}/resolve`],
    ]) {
      const json = method === "GET" ? undefined : DAMAGE;
      assertError(
        await api.call(method, path, { json }),
        401,
        "UNAUTHENTICATED",
      );
    }
  });

  test("POST /incidents: a manager reports with our own photos → 201, audited with the request id", async () => {
    const res = await report(f.manager, {
      resourceId: f.printer._id,
      ...DAMAGE,
      photos: [photo("plate")],
    });
    assertEnvelope(res, 201);
    const incident = res.body.data;
    assert.deepEqual(
      [incident.status, incident.source, incident.severity, incident.type],
      ["open", "manager", "low", "damage"],
    );
    assert.equal(incident.resource.title, "Prusa MK4 3D Printer");
    assert.equal(incident.reportedBy.name, "Meera Iyer");
    assert.deepEqual(incident.photos, [photo("plate")]);
    assert.deepEqual(
      [incident.resolution, incident.canComment, incident.canResolve],
      [null, true, true],
    );

    const [entry] = await AuditLog.find({ action: "incident.created" }).lean();
    assert.equal(String(entry.entity.id), incident._id);
    assert.equal(entry.requestId, res.body.requestId);
  });

  test("POST /incidents: photos hosted elsewhere are 400 before the service runs", async () => {
    const res = await report(f.manager, {
      resourceId: f.printer._id,
      ...DAMAGE,
      photos: [
        photo("ok"),
        { publicId: "x1", url: "https://evil.example/x1.jpg" },
      ],
    });
    assertError(res, 400, "VALIDATION_ERROR");
    assert.deepEqual(res.body.error.details, [
      {
        path: "photos.1",
        message: "Must be a photo uploaded through /uploads/images.",
      },
    ]);
    assert.equal(await Incident.countDocuments(), 0);

    // The service's own field errors reach the client the same way.
    const missing = await report(f.manager, { resourceId: f.printer._id });
    assertError(missing, 400, "VALIDATION_ERROR");
    assert.deepEqual(
      missing.body.error.details.map((d) => d.path),
      ["type", "severity", "description"],
    );
  });

  test("POST /incidents: a member can't report without a booking (403)", async () => {
    const res = await report(f.student, {
      resourceId: f.printer._id,
      ...DAMAGE,
    });
    assertError(res, 403, "FORBIDDEN");
    assert.match(res.body.error.message, /isn't tied to a booking/);
  });

  test("GET /incidents: a list envelope scoped to the viewer, with paging meta", async () => {
    const booking = await approvedBooking();
    const onBooking = await reported({ bookingId: booking._id });
    await reported({ severity: "medium" });

    const mine = await api.call("GET", "/incidents", { user: f.manager });
    assertEnvelope(mine, 200);
    assert.deepEqual(mine.body.meta, { page: 1, limit: 20, total: 2 });
    assert.equal(mine.body.data.length, 2);
    const [item] = mine.body.data;
    assert.equal(item.commentCount, 0);
    assert.equal("comments" in item, false);
    assert.equal("photos" in item, false);

    // The borrower sees the one on their booking; another member sees none.
    const borrower = await api.call("GET", "/incidents", { user: f.student });
    assert.deepEqual(
      borrower.body.data.map((i) => i._id),
      [onBooking._id],
    );
    const other = await api.call("GET", "/incidents", { user: f.student2 });
    assertEnvelope(other, 200);
    assert.deepEqual([other.body.data, other.body.meta.total], [[], 0]);

    // Express 5's simple query parser: a comma list and a repeated key both reach the service.
    const filtered = await api.call(
      "GET",
      "/incidents?status=open,in_review&severity=medium&limit=5",
      { user: f.manager },
    );
    assertEnvelope(filtered, 200);
    assert.deepEqual(filtered.body.meta, { page: 1, limit: 5, total: 1 });
    const repeated = await api.call(
      "GET",
      "/incidents?status=open&status=resolved",
      { user: f.manager },
    );
    assert.equal(repeated.body.meta.total, 2);

    const bad = await api.call("GET", "/incidents?status=closed&page=0", {
      user: f.manager,
    });
    assertError(bad, 400, "VALIDATION_ERROR");
    assert.deepEqual(
      bad.body.error.details.map((d) => d.path),
      ["status", "page"],
    );
  });

  test("GET /incidents/:id: parties see it; anyone else is 403, an unknown id 404", async () => {
    const booking = await approvedBooking();
    const incident = await reported({ bookingId: booking._id });

    const borrower = await api.call("GET", `/incidents/${incident._id}`, {
      user: f.student,
    });
    assertEnvelope(borrower, 200);
    assert.equal(borrower.body.data._id, incident._id);
    assert.equal(borrower.body.data.booking.borrower.name, "Ananya Rao");
    assert.equal("email" in borrower.body.data.booking.borrower, false);
    assert.deepEqual(
      [borrower.body.data.canComment, borrower.body.data.canResolve],
      [true, false],
    );

    for (const user of [f.student2, f.cseManager])
      assertError(
        await api.call("GET", `/incidents/${incident._id}`, { user }),
        403,
        "FORBIDDEN",
      );
    assertError(
      await api.call("GET", "/incidents/0123456789abcdef01234567", {
        user: f.manager,
      }),
      404,
      "NOT_FOUND",
    );
  });

  test("POST /incidents/:id/comments → 201 with the thread; a manager's first moves it to in_review", async () => {
    const booking = await approvedBooking();
    const incident = await reported({ bookingId: booking._id });
    const path = `/incidents/${incident._id}/comments`;

    const byBorrower = await api.call("POST", path, {
      user: f.student,
      json: { text: "It was like that when I picked it up." },
    });
    assertEnvelope(byBorrower, 201);
    assert.equal(byBorrower.body.data.status, "open");
    assert.deepEqual(
      byBorrower.body.data.comments.map((c) => [c.by.name, c.text]),
      [["Ananya Rao", "It was like that when I picked it up."]],
    );

    const byManager = await api.call("POST", path, {
      user: f.manager,
      json: { text: "Thanks, checking the check-in photos." },
    });
    assertEnvelope(byManager, 201);
    assert.equal(byManager.body.data.status, "in_review");
    assert.equal(byManager.body.data.comments.length, 2);

    assertError(
      await api.call("POST", path, { user: f.student, json: { text: "  " } }),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await api.call("POST", path, { user: f.student2, json: { text: "Hi" } }),
      403,
      "FORBIDDEN",
    );
    // No body at all is a missing text, not a crash.
    const empty = await api.call("POST", path, { user: f.student });
    assertError(empty, 400, "VALIDATION_ERROR");
    assert.deepEqual(empty.body.error.details, [
      { path: "text", message: "Required." },
    ]);
  });

  test("POST /incidents/:id/resolve → 200 with bookingClosed; scope and field errors first", async () => {
    const incident = await reported();
    const path = `/incidents/${incident._id}/resolve`;

    // Another unit's manager, and a member, can't resolve it.
    for (const user of [f.cseManager, f.student])
      assertError(
        await api.call("POST", path, { user, json: RESOLUTION }),
        403,
        "FORBIDDEN",
      );
    const bad = await api.call("POST", path, {
      user: f.manager,
      json: { outcome: "strike" },
    });
    assertError(bad, 400, "VALIDATION_ERROR");
    assert.deepEqual(
      bad.body.error.details.map((d) => d.path),
      ["rationale", "outcome"],
    );

    const res = await api.call("POST", path, {
      user: f.manager,
      json: RESOLUTION,
    });
    assertEnvelope(res, 200);
    assert.equal(res.body.data.status, "resolved");
    assert.equal(res.body.data.bookingClosed, false);
    assert.equal(res.body.data.resolution.outcome, "warning");
    assert.equal(res.body.data.resolution.decidedBy.name, "Meera Iyer");
    assert.deepEqual(
      [res.body.data.canComment, res.body.data.canResolve],
      [false, false],
    );
    const [entry] = await AuditLog.find({ action: "incident.resolved" }).lean();
    assert.equal(entry.requestId, res.body.requestId);

    // Resolved: the thread is closed and resolving again is a 409.
    assertError(
      await api.call("POST", `/incidents/${incident._id}/comments`, {
        user: f.manager,
        json: { text: "One more thing." },
      }),
      409,
      "INVALID_TRANSITION",
    );
    assertError(
      await api.call("POST", path, { user: f.manager, json: RESOLUTION }),
      409,
      "INVALID_TRANSITION",
    );
  });

  test("a suspended user can read but not report, comment or resolve", async () => {
    const incident = await reported();
    await User.updateOne(
      { _id: f.manager._id },
      {
        suspendedUntil: new Date(Date.now() + 24 * 60 * 60_000),
        suspensionReason: "Repeated no-shows",
      },
    );
    for (const [path, json] of [
      ["/incidents", { resourceId: f.printer._id, ...DAMAGE }],
      [`/incidents/${incident._id}/comments`, { text: "Looking into it." }],
      [`/incidents/${incident._id}/resolve`, RESOLUTION],
    ]) {
      const res = await api.call("POST", path, { user: f.manager, json });
      assertError(res, 403, "FORBIDDEN");
      assert.equal(res.body.error.details.reason, "Repeated no-shows");
    }
    assertEnvelope(
      await api.call("GET", `/incidents/${incident._id}`, { user: f.manager }),
      200,
    );
    assert.equal(await Incident.countDocuments(), 1);
  });
});
