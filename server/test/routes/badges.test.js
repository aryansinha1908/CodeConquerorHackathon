// /api/v1/badges and /api/v1/badge-requests over HTTP (architecture.md §6 Badges): the whole app on
// port 0, a real MongoDB through fixtures.js (skipped without TEST_MONGODB_URI), ioredis-mock, and a
// fake uploader in place of Cloudinary. The service's rules are tested in
// test/integration/badgeService.test.js; these check the wiring: auth, suspension, the envelope, the
// evidence upload (stored privately, discarded when the service refuses), and that the service's
// answers reach the client.
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { useUploader } from "../../src/config/cloudinary.js";
import logger from "../../src/lib/logger.js";
import { keys } from "../../src/lib/redisKeys.js";
import { AuditLog, Badge, User, UserBadge } from "../../src/models/index.js";
import { redis, skip, useTestDatabase } from "../integration/fixtures.js";
import { useApi } from "./http.js";

logger.level = "silent";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c00000000049454e44ae426082",
  "hex",
);
const TEXT = Buffer.from("this is a text file pretending to be a certificate");
const EVIDENCE = /^campuscommons\/evidence\/[0-9a-f-]{36}$/;

let f;
let fake;
// A DIC badge nobody holds, and one that needs evidence.
let laser;
let lathe;

function fakeUploader() {
  const uploader = {
    uploads: [],
    destroyed: [],
    async upload(buffer, options) {
      uploader.uploads.push({ buffer, ...options });
      const publicId = `${options.folder}/${options.publicId}`;
      return {
        publicId,
        url: `https://res.cloudinary.com/test/image/${options.type}/${publicId}`,
        format: "png",
      };
    },
    async destroy(publicId, options) {
      uploader.destroyed.push({ publicId, ...options });
      return { deleted: true };
    },
    async signedUrl() {
      return "https://api.cloudinary.com/signed";
    },
  };
  return uploader;
}

const uploadedId = () =>
  `${fake.uploads.at(-1).folder}/${fake.uploads.at(-1).publicId}`;

// note and file are optional; file: [bytes, name, type] as the client claims them.
function evidenceForm({ note, file = [PNG, "certificate.png", "image/png"] }) {
  const form = new FormData();
  if (note !== undefined) form.append("note", note);
  if (file) {
    const [bytes, name, type] = file;
    form.append("evidence", new Blob([bytes], { type }), name);
  }
  return form;
}

// The user's hits in the upload tier this hour (null: never counted).
const uploadHits = (user) =>
  redis.get(`${keys.rateLimitPrefix("upload")}${user._id}`);

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

const suspend = (user) =>
  User.updateOne(
    { _id: user._id },
    {
      suspendedUntil: new Date(Date.now() + 86_400_000),
      suspensionReason: "Testing",
    },
  );

describe("/api/v1/badges and /api/v1/badge-requests", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const api = useApi();

  beforeEach(async () => {
    fake = fakeUploader();
    useUploader(fake);
    [laser, lathe] = await Badge.create([
      {
        name: "Laser Cutter Safety",
        code: "laser-cutter-safety",
        orgUnit: f.dic._id,
        validityDays: 180,
      },
      {
        name: "Lathe Operation",
        code: "lathe-operation",
        orgUnit: f.dic._id,
        evidenceRequired: true,
      },
    ]);
  });

  afterEach(() => useUploader(null));

  const request = (user, badge, { json, form } = {}) =>
    api.call("POST", `/badges/${badge._id}/requests`, { user, json, form });

  test("signed out is 401 UNAUTHENTICATED on every route", async () => {
    const id = f.badge._id;
    for (const [method, path, json] of [
      ["GET", "/badges"],
      ["POST", "/badges", {}],
      ["GET", "/badges/mine"],
      ["POST", `/badges/${id}/requests`, {}],
      ["POST", `/badges/${id}/grant`, {}],
      ["GET", "/badge-requests"],
      ["GET", `/badge-requests/${id}/evidence`],
      ["PATCH", `/badge-requests/${id}`, { decision: "approve" }],
    ]) {
      const res = await api.call(method, path, { json });
      assertError(res, 401, "UNAUTHENTICATED");
    }
  });

  test("GET /badges: the catalogue by name with each issuer; orgUnit filters; a bad id is 400", async () => {
    const res = await api.call("GET", "/badges", { user: f.student });
    assertOk(res);
    assert.ok(!("meta" in res.body));
    assert.deepEqual(
      res.body.data.map((b) => b.code),
      ["3d-printing-basics", "laser-cutter-safety", "lathe-operation"],
    );
    assert.deepEqual(res.body.data[0].orgUnit, {
      _id: String(f.dic._id),
      name: "Design and Innovation Centre",
      code: "dic",
      isActive: true,
    });

    const cse = await api.call("GET", `/badges?orgUnit=${f.cse._id}`, {
      user: f.student,
    });
    assertOk(cse);
    assert.deepEqual(cse.body.data, []);
    const bad = await api.call("GET", "/badges?orgUnit=dic", {
      user: f.student,
    });
    assertError(bad, 400, "VALIDATION_ERROR");
    assert.deepEqual(bad.body.error.details, [
      { path: "orgUnit", message: "Must be a valid id." },
    ]);
  });

  test("POST /badges: the unit's manager creates one → 201, audited; another unit's manager is 403; selfServe is 400", async () => {
    const json = {
      name: "Soldering Basics",
      code: "soldering-basics",
      orgUnit: String(f.dic._id),
      description: "Iron handling and fume extraction.",
      validityDays: 365,
    };
    const res = await api.call("POST", "/badges", { user: f.manager, json });
    assertOk(res, 201);
    assert.equal(res.body.data.code, "soldering-basics");
    assert.equal(res.body.data.validityDays, 365);
    assert.equal(res.body.data.evidenceRequired, false);
    const entry = await AuditLog.findOne({ action: "badge.created" }).lean();
    assert.equal(entry.requestId, res.body.requestId);

    const other = await api.call("POST", "/badges", {
      user: f.cseManager,
      json: { ...json, code: "soldering-2" },
    });
    assertError(other, 403, "FORBIDDEN");
    const selfServe = await api.call("POST", "/badges", {
      user: f.manager,
      json: { ...json, code: "soldering-3", selfServe: true },
    });
    assertError(selfServe, 400, "VALIDATION_ERROR");
    assert.deepEqual(selfServe.body.error.details, [
      {
        path: "selfServe",
        message:
          "Self-serve badges come with the training quiz (C-13), which isn't built yet.",
      },
    ]);
    assert.equal(await Badge.countDocuments(), 4);
  });

  test("GET /badges/mine: the viewer's own rows with a state", async () => {
    const res = await api.call("GET", "/badges/mine", { user: f.student });
    assertOk(res);
    assert.equal(res.body.data.length, 1);
    const [row] = res.body.data;
    assert.equal(row.status, "active");
    assert.equal(row.state, "active");
    assert.equal(row.hasEvidence, false);
    assert.equal(row.badge.name, "3D Printing Basics");
    assert.equal(row.badge.orgUnit.code, "dic");
    assert.ok(!("user" in row) && !("evidence" in row));

    const none = await api.call("GET", "/badges/mine", { user: f.manager });
    assertOk(none);
    assert.deepEqual(none.body.data, []);
  });

  test("POST /badges/:id/requests, JSON without evidence → 201; the upload tier doesn't count it", async () => {
    const res = await request(f.student, laser, {
      json: { note: "Did the induction on Monday." },
    });
    assertOk(res, 201);
    assert.equal(res.body.data.status, "requested");
    assert.equal(res.body.data.state, "requested");
    assert.equal(res.body.data.note, "Did the induction on Monday.");
    assert.equal(res.body.data.hasEvidence, false);
    assert.equal(res.body.data.badge.code, "laser-cutter-safety");
    const entry = await AuditLog.findOne({ action: "badge.requested" }).lean();
    assert.equal(entry.requestId, res.body.requestId);
    assert.equal(fake.uploads.length, 0);
    assert.equal(await uploadHits(f.student), null);
  });

  test("POST /badges/:id/requests, multipart with evidence → 201; the file is stored privately and linked", async () => {
    const res = await request(f.student, lathe, {
      form: evidenceForm({ note: "Certificate from the workshop course." }),
    });
    assertOk(res, 201);
    assert.equal(res.body.data.hasEvidence, true);
    assert.equal(res.body.data.note, "Certificate from the workshop course.");
    assert.ok(
      !("evidence" in res.body.data),
      "the member sees hasEvidence only",
    );

    assert.equal(fake.uploads.length, 1);
    assert.equal(fake.uploads[0].type, "authenticated");
    assert.equal(fake.uploads[0].folder, "campuscommons/evidence");
    const row = await UserBadge.findOne({
      user: f.student._id,
      badge: lathe._id,
    }).lean();
    assert.match(row.evidence.publicId, EVIDENCE);
    assert.equal(row.evidence.publicId, uploadedId());
    assert.deepEqual(fake.destroyed, []);
    assert.equal(Number(await uploadHits(f.student)), 1);
  });

  test("POST /badges/:id/requests: when the service refuses after the upload, the evidence is discarded", async () => {
    await User.updateOne(
      { _id: f.student3._id },
      { "verification.status": "pending" },
    );
    const cases = [
      // Already held (409), not verified (403), no such badge (404).
      [f.student, f.badge._id, 409, "INVALID_TRANSITION"],
      [f.student3, laser._id, 403, "FORBIDDEN"],
      [f.student2, f.dic._id, 404, "NOT_FOUND"],
    ];
    for (const [user, badgeId, status, code] of cases) {
      const res = await api.call("POST", `/badges/${badgeId}/requests`, {
        user,
        form: evidenceForm({ note: "Here is my certificate." }),
      });
      assertError(res, status, code);
      assert.deepEqual(fake.destroyed.at(-1), {
        publicId: uploadedId(),
        type: "authenticated",
      });
    }
    assert.equal(fake.uploads.length, 3);
    assert.equal(fake.destroyed.length, 3);
    assert.equal(
      await UserBadge.countDocuments({
        "evidence.publicId": { $exists: true },
      }),
      0,
    );
  });

  test("POST /badges/:id/requests: validation errors reach the client with details, and nothing is stored", async () => {
    // The badge needs evidence and none came.
    const without = await request(f.student, lathe, { json: { note: "Hi" } });
    assertError(without, 400, "VALIDATION_ERROR");
    assert.deepEqual(without.body.error.details, [
      {
        path: "evidence",
        message: "This badge needs evidence, such as a training certificate.",
      },
    ]);
    // A publicId in the body could name any of our assets: evidence only comes as a file.
    const smuggled = await request(f.student, lathe, {
      json: { evidence: { publicId: "campuscommons/id-cards/someone-else" } },
    });
    assertError(smuggled, 400, "VALIDATION_ERROR");
    assert.deepEqual(smuggled.body.error.details, [
      {
        path: "evidence",
        message:
          'Attach the evidence as a file in the multipart field "evidence".',
      },
    ]);
    // The type comes from the bytes, not the name.
    const text = await request(f.student, lathe, {
      form: evidenceForm({
        file: [TEXT, "certificate.pdf", "application/pdf"],
      }),
    });
    assertError(text, 400, "VALIDATION_ERROR");
    assert.deepEqual(text.body.error.details, [
      { path: "evidence", message: "Must be a JPG, PNG, WebP or PDF file." },
    ]);
    const long = await request(f.student, laser, {
      form: evidenceForm({ note: "x".repeat(501), file: null }),
    });
    assertError(long, 400, "VALIDATION_ERROR");
    assert.deepEqual(long.body.error.details, [
      { path: "note", message: "Can be at most 500 characters." },
    ]);
    assert.equal(fake.uploads.length, 0);
    assert.equal(await UserBadge.countDocuments({ status: "requested" }), 0);
  });

  test("POST /badges/:id/requests: a multipart note is judged in characters, the same as JSON", async () => {
    // 360 Devanagari characters are 1080 bytes in UTF-8, well under the 500-character limit.
    const note = "प्र".repeat(120);
    assert.equal(note.length, 360);
    const res = await request(f.student, lathe, {
      form: evidenceForm({ note }),
    });
    assertOk(res, 201);
    assert.equal(res.body.data.note, note);
  });

  test("POST /badges/:id/requests: a new request discards the earlier request's evidence file", async () => {
    const reject = (userBadgeId) =>
      api.call("PATCH", `/badge-requests/${userBadgeId}`, {
        user: f.manager,
        json: { decision: "reject", reason: "Certificate is blurry" },
      });
    // Replaced: lathe needs evidence, so the new request brings a new file.
    const first = await request(f.student, lathe, { form: evidenceForm({}) });
    assertOk(first, 201);
    const oldFile = uploadedId();
    assertOk(await reject(first.body.data._id));
    const again = await request(f.student, lathe, { form: evidenceForm({}) });
    assertOk(again, 201);
    const newFile = uploadedId();
    assert.notEqual(newFile, oldFile);
    assert.deepEqual(fake.destroyed, [
      { publicId: oldFile, type: "authenticated" },
    ]);
    const row = await UserBadge.findOne({
      user: f.student._id,
      badge: lathe._id,
    }).lean();
    assert.equal(row.evidence.publicId, newFile);

    // Cleared: laser doesn't need evidence, and the new request comes without a file.
    const withFile = await request(f.student2, laser, {
      form: evidenceForm({}),
    });
    assertOk(withFile, 201);
    const laserFile = uploadedId();
    assertOk(await reject(withFile.body.data._id));
    assertOk(await request(f.student2, laser, { json: {} }), 201);
    assert.deepEqual(fake.destroyed.at(-1), {
      publicId: laserFile,
      type: "authenticated",
    });
    assert.equal(fake.destroyed.length, 2);
  });

  test("POST /badges/:id/requests: a failure after the request is saved keeps the evidence it points to", async (t) => {
    // The row is written, then the audit entry fails (a transient MongoDB error).
    AuditLog.create = async () => {
      throw new Error("connection reset");
    };
    t.after(() => delete AuditLog.create);
    const res = await request(f.student, lathe, { form: evidenceForm({}) });
    assertError(res, 500, "INTERNAL");
    delete AuditLog.create;
    const row = await UserBadge.findOne({
      user: f.student._id,
      badge: lathe._id,
    }).lean();
    assert.equal(row.evidence.publicId, uploadedId());
    assert.deepEqual(
      fake.destroyed,
      [],
      "the saved request still points to it",
    );
  });

  test("POST /badges/:id/requests: a suspended member is 403 before the body is read or counted", async () => {
    await suspend(f.student);
    const res = await request(f.student, lathe, { form: evidenceForm({}) });
    assertError(res, 403, "FORBIDDEN");
    assert.match(res.body.error.message, /suspended/);
    assert.equal(fake.uploads.length, 0);
    assert.equal(await uploadHits(f.student), null);
  });

  test("POST /badges/:id/grant: the unit's manager grants directly → 200 with the queue row; others are 403; no member named is 400", async () => {
    const res = await api.call("POST", `/badges/${laser._id}/grant`, {
      user: f.manager,
      json: { userId: String(f.student2._id), note: "In-person induction" },
    });
    assertOk(res);
    assert.equal(res.body.data.status, "active");
    assert.equal(res.body.data.state, "active");
    assert.equal(res.body.data.user.name, "Kabir Singh");
    assert.ok(!("email" in res.body.data.user));
    assert.equal(res.body.data.decidedBy.name, "Meera Iyer");
    assert.equal(res.body.data.evidence, null);
    assert.ok(res.body.data.expiresAt);
    const entry = await AuditLog.findOne({ action: "badge.granted" }).lean();
    assert.equal(entry.requestId, res.body.requestId);
    assert.equal(entry.reason, "In-person induction");

    const other = await api.call("POST", `/badges/${laser._id}/grant`, {
      user: f.cseManager,
      json: { userId: String(f.student3._id) },
    });
    assertError(other, 403, "FORBIDDEN");
    const none = await api.call("POST", `/badges/${laser._id}/grant`, {
      user: f.manager,
      json: {},
    });
    assertError(none, 400, "VALIDATION_ERROR");
    assert.deepEqual(none.body.error.details, [
      { path: "userId", message: "Required." },
      { path: "email", message: "Required." },
    ]);
  });

  test("POST /badges/:id/grant by email: any case finds the member; an unknown email is 400 on email", async () => {
    const res = await api.call("POST", `/badges/${laser._id}/grant`, {
      user: f.manager,
      json: { email: "Student3@Demo.CampusCommons.test" },
    });
    assertOk(res);
    assert.equal(res.body.data.user._id, String(f.student3._id));
    assert.equal(res.body.data.state, "active");
    assert.ok(!("email" in res.body.data.user));

    const unknown = await api.call("POST", `/badges/${laser._id}/grant`, {
      user: f.manager,
      json: { email: "nobody@nitjsr.ac.in" },
    });
    assertError(unknown, 400, "VALIDATION_ERROR");
    assert.deepEqual(unknown.body.error.details, [
      { path: "email", message: "No account has this email." },
    ]);
  });

  test("GET /badge-requests/:id/evidence: a 5-minute link, never cached, audited; the member's own too; others 403; no file 404", async () => {
    await request(f.student, lathe, {
      form: evidenceForm({ note: "Certificate attached." }),
    });
    const row = await UserBadge.findOne({ badge: lathe._id }).lean();
    const evidence = (user, id = row._id) =>
      api.call("GET", `/badge-requests/${id}/evidence`, { user });

    const before = Date.now();
    const res = await evidence(f.manager);
    assertOk(res);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(Object.keys(res.body.data).sort(), ["expiresAt", "url"]);
    const expiresAt = new Date(res.body.data.expiresAt).getTime();
    assert.ok(expiresAt >= before + 5 * 60_000 - 1000);
    assert.ok(expiresAt <= Date.now() + 5 * 60_000);
    const [view] = await AuditLog.find({
      action: "badge.evidence_viewed",
    }).lean();
    assert.deepEqual(
      [String(view.actor.id), view.actor.role, view.requestId],
      [String(f.manager._id), "manager", res.body.requestId],
    );

    // The member who sent it may open it; another unit's manager and other members may not.
    assertOk(await evidence(f.student));
    for (const user of [f.cseManager, f.student2])
      assertError(await evidence(user), 403, "FORBIDDEN");
    assertError(await evidence(f.manager, "not-an-id"), 404, "NOT_FOUND");
    const json = await request(f.student2, laser, { json: {} });
    const none = await evidence(f.manager, json.body.data._id);
    assertError(none, 404, "NOT_FOUND");
    assert.equal(none.body.error.message, "Evidence not found.");
    assert.equal(
      await AuditLog.countDocuments({ action: "badge.evidence_viewed" }),
      2,
    );
  });

  test("GET /badge-requests/:id/evidence: 20 links per 15 minutes per user, shared with the ID-card link", async () => {
    // Each link costs a Cloudinary Admin API call, and that quota is shared by every reviewer.
    await request(f.student, lathe, {
      form: evidenceForm({ note: "Certificate attached." }),
    });
    const row = await UserBadge.findOne({ badge: lathe._id }).lean();
    const evidence = (user) =>
      api.call("GET", `/badge-requests/${row._id}/evidence`, { user });
    for (let i = 0; i < 20; i++) assertOk(await evidence(f.student));
    const limited = await evidence(f.student);
    assertError(limited, 429, "RATE_LIMITED");
    assert.deepEqual(
      [limited.body.error.details.tier, limited.body.error.details.limit],
      ["fileLink", 20],
    );
    assert.equal(
      await AuditLog.countDocuments({ action: "badge.evidence_viewed" }),
      20,
    );
    // Per user: the manager still opens it. The admin's ID-card links come out of the same 20.
    assertOk(await evidence(f.manager));
    for (let i = 0; i < 20; i++) assertOk(await evidence(f.admin));
    const idCard = await api.call(
      "GET",
      `/admin/verifications/${f.student._id}/id-card`,
      { user: f.admin },
    );
    assertError(idCard, 429, "RATE_LIMITED");
    assert.equal(idCard.body.error.details.tier, "fileLink");
  });

  test("GET /badge-requests: the unit's managers get the open queue with meta; a member is 403; a bad status is 400", async () => {
    await request(f.student, lathe, {
      form: evidenceForm({ note: "Certificate attached." }),
    });
    const res = await api.call("GET", "/badge-requests", { user: f.manager });
    assertOk(res);
    assert.deepEqual(res.body.meta, { page: 1, limit: 20, total: 1 });
    const [row] = res.body.data;
    assert.equal(row.status, "requested");
    assert.equal(row.user.name, "Ananya Rao");
    assert.equal(row.user.department.code, "cse");
    assert.ok(!("email" in row.user));
    assert.deepEqual(row.evidence, { publicId: uploadedId() });
    assert.equal(row.badge.code, "lathe-operation");

    const cse = await api.call("GET", "/badge-requests", {
      user: f.cseManager,
    });
    assertOk(cse);
    assert.deepEqual(cse.body.data, []);
    const member = await api.call("GET", "/badge-requests", {
      user: f.student,
    });
    assertError(member, 403, "FORBIDDEN");
    const bad = await api.call("GET", "/badge-requests?status=expired", {
      user: f.manager,
    });
    assertError(bad, 400, "VALIDATION_ERROR");
    assert.deepEqual(bad.body.error.details, [
      {
        path: "status",
        message: "Must be one of: requested, active, rejected, revoked.",
      },
    ]);
  });

  test("PATCH /badge-requests/:id: the unit's manager approves → 200; a rejection needs a reason; another unit's manager is 403", async () => {
    const asked = await request(f.student, laser, { json: {} });
    const id = asked.body.data._id;
    const reasonless = await api.call("PATCH", `/badge-requests/${id}`, {
      user: f.manager,
      json: { decision: "reject" },
    });
    assertError(reasonless, 400, "VALIDATION_ERROR");
    assert.deepEqual(reasonless.body.error.details, [
      {
        path: "reason",
        message: "Say why, so the member knows what to do next.",
      },
    ]);
    const other = await api.call("PATCH", `/badge-requests/${id}`, {
      user: f.cseManager,
      json: { decision: "approve" },
    });
    assertError(other, 403, "FORBIDDEN");

    const res = await api.call("PATCH", `/badge-requests/${id}`, {
      user: f.manager,
      json: { decision: "approve" },
    });
    assertOk(res);
    assert.equal(res.body.data._id, id);
    assert.equal(res.body.data.status, "active");
    assert.equal(res.body.data.decidedBy.name, "Meera Iyer");
    const entry = await AuditLog.findOne({
      action: "badge.granted",
      "entity.id": id,
    }).lean();
    assert.equal(entry.requestId, res.body.requestId);

    const again = await api.call("PATCH", `/badge-requests/${id}`, {
      user: f.manager,
      json: { decision: "approve" },
    });
    assertError(again, 409, "INVALID_TRANSITION");
  });
});
