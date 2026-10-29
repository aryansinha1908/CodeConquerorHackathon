// /api/v1/verification and /api/v1/admin/verifications over HTTP (architecture.md §6 Verification, §8
// and §16 "ID documents"): the whole app on port 0, a real MongoDB through fixtures.js (skipped
// without TEST_MONGODB_URI), ioredis-mock, a capturing mail transport, and a fake uploader in place
// of Cloudinary.
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import app from "../../src/app.js";
import { useUploader } from "../../src/config/cloudinary.js";
import { useMailTransport } from "../../src/config/mailer.js";
import logger from "../../src/lib/logger.js";
import {
  AuditLog,
  Notification,
  OrgUnit,
  User,
} from "../../src/models/index.js";
import { signAccessToken } from "../../src/services/authTokens.js";
import { useCardFetcher } from "../../src/services/verificationService.js";
import { skip, useTestDatabase } from "../integration/fixtures.js";

logger.level = "silent";
process.env.ACCESS_TOKEN_SECRET = "test-access-secret";
// The demo-login test starts a real session, which signs a refresh token.
process.env.REFRESH_TOKEN_SECRET = "test-refresh-secret";

const mails = [];
useMailTransport({ sendMail: async (message) => mails.push(message) });

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c00000000049454e44ae426082",
  "hex",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const TEXT = Buffer.from("this is a text file pretending to be a photo");
const ID_CARD = /^campuscommons\/id-cards\/[0-9a-f-]{36}$/;

let f;
let server;
let origin;
let fake;
let applicant;
// A real admin. The fixtures' admin is the public demo account, which reaches demo accounts only.
let admin;

function fakeUploader() {
  const uploader = {
    uploads: [],
    destroyed: [],
    signed: [],
    failDestroy: null,
    async upload(buffer, options) {
      uploader.uploads.push({ buffer, ...options });
      return {
        publicId: `${options.folder}/${options.publicId}`,
        url: `https://res.cloudinary.com/test/image/${options.type}/${options.folder}/${options.publicId}`,
        format: "png",
      };
    },
    async destroy(publicId, options) {
      if (uploader.failDestroy) throw uploader.failDestroy;
      uploader.destroyed.push({ publicId, ...options });
      return { deleted: true };
    },
    async signedUrl(publicId, { type, expiresAt }) {
      uploader.signed.push({ publicId, type, expiresAt });
      return `https://api.cloudinary.com/v1_1/test/image/download?public_id=${encodeURIComponent(publicId)}&expires_at=${Math.floor(expiresAt.getTime() / 1000)}`;
    },
  };
  return uploader;
}

const lastUploadId = () =>
  `${fake.uploads.at(-1).folder}/${fake.uploads.at(-1).publicId}`;

// → { status, body, headers }. user (or token): who is signed in; form: FormData; json: a JSON body.
async function call(method, path, { user, token, form, json } = {}) {
  const headers = {};
  if (user) headers.authorization = `Bearer ${signAccessToken(user)}`;
  if (token) headers.authorization = `Bearer ${token}`;
  if (json !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers,
    body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

// The client's claimed name and type don't matter; only the bytes do.
function idCardForm({
  memberType = "ug",
  department = f.cse._id,
  file = [PNG, "card.png", "image/png"],
  ocrCheck,
} = {}) {
  const form = new FormData();
  // null leaves the field out (undefined would take the default).
  if (memberType !== null) form.append("memberType", memberType);
  if (department !== null) form.append("department", String(department));
  if (ocrCheck !== undefined) form.append("ocrCheck", ocrCheck);
  if (file) {
    const [bytes, name, type] = file;
    form.append("idCard", new Blob([bytes], { type }), name);
  }
  return form;
}

const submit = (user, options) =>
  call("POST", "/verification/id-card", { user, form: idCardForm(options) });
// As the admin's queue sends it: with the submittedAt of the submission on file, unless json has one.
const decide = async (who, user, json) =>
  call("PATCH", `/admin/verifications/${user._id}`, {
    user: who,
    json:
      json && typeof json === "object" && !("submittedAt" in json)
        ? { submittedAt: (await stored(user)).submittedAt ?? null, ...json }
        : json,
  });
const cardLink = (admin, user) =>
  call("GET", `/admin/verifications/${user._id}/id-card`, { user: admin });

function assertError(res, status, code) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, code);
  assert.ok(res.body.requestId);
}

const stored = async (user) =>
  (await User.findById(user._id).select("+verification.idCardPublicId").lean())
    .verification;

const audits = (action) => AuditLog.find({ action }).sort({ at: 1 }).lean();

// A member who signed up and verified their email but hasn't sent a card yet. Not on the *.test
// domain, so the mailer sends to them.
const newMember = (email, extra = {}) =>
  User.create({
    name: "Kabir Singh",
    email,
    passwordHash: "x".repeat(60),
    emailVerified: true,
    emailHints: { year: 2024, level: "ug", branch: "cs", serial: "999" },
    ...extra,
  });

describe("ID-card verification over HTTP", { skip }, () => {
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

  beforeEach(async () => {
    fake = fakeUploader();
    useUploader(fake);
    mails.length = 0;
    applicant = await newMember("2024ugcs999@nitjsr.ac.in");
    admin = await User.create({
      name: "Registrar",
      email: "registrar@nitjsr.ac.in",
      passwordHash: "x".repeat(60),
      emailVerified: true,
      roles: ["admin"],
    });
  });

  afterEach(() => useUploader(null));

  describe("the member's side", () => {
    test("a submission goes to pending, privately stored, and no view carries the public id", async () => {
      const res = await submit(applicant);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.success, true);
      const { submittedAt, ...rest } = res.body.data;
      assert.deepEqual(rest, {
        status: "pending",
        reason: null,
        reviewedAt: null,
        memberType: "ug",
        department: {
          _id: String(f.cse._id),
          code: "cse",
          name: "Computer Science and Engineering",
        },
        hasIdCard: true,
      });
      assert.ok(Math.abs(new Date(submittedAt) - Date.now()) < 60_000);

      assert.equal(fake.uploads.length, 1);
      assert.equal(fake.uploads[0].type, "authenticated");
      assert.equal(fake.uploads[0].folder, "campuscommons/id-cards");
      assert.equal(fake.uploads[0].transformation, undefined);
      const saved = await stored(applicant);
      assert.match(saved.idCardPublicId, ID_CARD);
      assert.equal(saved.idCardPublicId, lastUploadId());

      const status = await call("GET", "/verification/status", {
        user: applicant,
      });
      assert.equal(status.status, 200);
      assert.deepEqual(status.body.data, res.body.data);
      for (const body of [res.body, status.body]) {
        const text = JSON.stringify(body);
        assert.equal(text.includes(fake.uploads[0].publicId), false);
        assert.equal(text.includes("idCardPublicId"), false);
        assert.equal(text.includes("publicId"), false);
      }
      // /auth/me doesn't leak it either (User's toJSON and publicUser).
      const me = await call("GET", "/auth/me", { user: applicant });
      assert.equal(
        JSON.stringify(me.body).includes(fake.uploads[0].publicId),
        false,
      );

      const [entry] = await audits("verification.submitted");
      assert.equal(String(entry.actor.id), String(applicant._id));
      assert.equal(entry.actor.role, "member");
      assert.deepEqual(entry.entity, { type: "user", id: applicant._id });
      assert.equal(entry.orgUnit, undefined, "admin-only: no unit");
      assert.deepEqual(entry.changes.status, ["unsubmitted", "pending"]);
      assert.equal(
        JSON.stringify(entry).includes(fake.uploads[0].publicId),
        false,
      );
    });

    test("a new card while pending replaces the old one, which is deleted", async () => {
      await submit(applicant);
      const first = lastUploadId();
      const firstAt = (await stored(applicant)).submittedAt;
      const again = await submit(applicant, {
        memberType: "pg",
        file: [PDF, "card.pdf", "application/pdf"],
      });
      assert.equal(again.status, 201, JSON.stringify(again.body));
      assert.equal(again.body.data.status, "pending");
      assert.equal(again.body.data.memberType, "pg");
      const second = lastUploadId();
      assert.notEqual(second, first);
      assert.deepEqual(fake.destroyed, [
        { publicId: first, type: "authenticated" },
      ]);
      const saved = await stored(applicant);
      assert.equal(saved.idCardPublicId, second);
      assert.ok(saved.submittedAt >= firstAt);
      const entries = await audits("verification.submitted");
      assert.equal(entries.length, 2);
      assert.deepEqual(entries[1].changes.status, ["pending", "pending"]);
      assert.deepEqual(entries[1].changes.memberType, ["ug", "pg"]);
      assert.equal(entries[1].meta.replacedCard, true);
    });

    test("after a rejection the member tries again; once approved it is 409 and nothing is uploaded", async () => {
      await User.updateOne(
        { _id: applicant._id },
        {
          "verification.status": "rejected",
          "verification.reason": "Blurry photo",
          "verification.reviewedBy": f.admin._id,
          "verification.reviewedAt": new Date(),
        },
      );
      const retry = await submit(applicant);
      assert.equal(retry.status, 201, JSON.stringify(retry.body));
      assert.equal(retry.body.data.status, "pending");
      assert.equal(retry.body.data.reason, null);
      assert.equal(retry.body.data.reviewedAt, null);
      const saved = await stored(applicant);
      assert.equal(saved.reviewedBy, undefined);

      const uploads = fake.uploads.length;
      assertError(await submit(f.student), 409, "INVALID_TRANSITION");
      assert.equal(fake.uploads.length, uploads);
    });

    test("the form is checked: member type, department, and the file by its bytes", async () => {
      const bad = await submit(applicant, {
        memberType: "UG",
        department: "cse",
        file: null,
      });
      assertError(bad, 400, "VALIDATION_ERROR");
      assert.deepEqual(bad.body.error.details.map((d) => d.path).sort(), [
        "department",
        "idCard",
        "memberType",
      ]);

      const missing = await submit(applicant, {
        memberType: null,
        department: null,
      });
      assertError(missing, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        missing.body.error.details.map((d) => [d.path, d.message]).sort(),
        [
          ["department", "Required."],
          ["memberType", "Required."],
        ],
      );

      const unknown = await submit(applicant, {
        department: "6a1f00000000000000000000",
      });
      assertError(unknown, 400, "VALIDATION_ERROR");
      assert.deepEqual(unknown.body.error.details, [
        { path: "department", message: "No such unit." },
      ]);
      await OrgUnit.updateOne({ _id: f.cse._id }, { isActive: false });
      assert.deepEqual((await submit(applicant)).body.error.details, [
        { path: "department", message: "This unit is inactive." },
      ]);
      await OrgUnit.updateOne({ _id: f.cse._id }, { isActive: true });

      const text = await submit(applicant, {
        file: [TEXT, "card.jpg", "image/jpeg"],
      });
      assertError(text, 400, "VALIDATION_ERROR");
      assert.deepEqual(text.body.error.details, [
        { path: "idCard", message: "Must be a JPG, PNG, WebP or PDF file." },
      ]);
      assert.equal(
        fake.uploads.length,
        0,
        "nothing refused reached Cloudinary",
      );
      assert.equal((await stored(applicant)).status, "unsubmitted");

      // A PNG renamed to .pdf is a PNG, which an ID card may be.
      const renamed = await submit(applicant, {
        file: [PNG, "card.pdf", "application/pdf"],
      });
      assert.equal(renamed.status, 201, JSON.stringify(renamed.body));
    });

    test("a second file is 400; signed out is 401; without Cloudinary it is 503", async () => {
      const form = idCardForm();
      form.append("idCard", new Blob([PNG]), "back.png");
      const two = await call("POST", "/verification/id-card", {
        user: applicant,
        form,
      });
      assertError(two, 400, "VALIDATION_ERROR");
      assert.deepEqual(two.body.error.details, [
        { path: "idCard", message: "Attach at most 1 file." },
      ]);
      assertError(
        await call("POST", "/verification/id-card", { form: idCardForm() }),
        401,
        "UNAUTHENTICATED",
      );
      assertError(
        await call("GET", "/verification/status"),
        401,
        "UNAUTHENTICATED",
      );

      useUploader(null);
      const saved = process.env.CLOUDINARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_CLOUD_NAME;
      try {
        const off = await submit(applicant);
        assertError(off, 503, "SERVICE_UNAVAILABLE");
        assert.equal(off.body.error.message, "Uploads aren't configured.");
      } finally {
        if (saved !== undefined) process.env.CLOUDINARY_CLOUD_NAME = saved;
      }
    });
  });

  describe("the admin's side", () => {
    test("the queue: pending oldest first, admins only, with paging", async () => {
      const later = await newMember("2023pgcese01@nitjsr.ac.in", {
        name: "Ishita Paul",
        emailHints: { year: 2023, level: "pg", branch: "cse", serial: "01" },
      });
      await submit(later);
      await submit(applicant);
      // An hour apart, so the order doesn't hang on the clock's resolution.
      await User.updateOne(
        { _id: later._id },
        { "verification.submittedAt": new Date(Date.now() - 3_600_000) },
      );
      const res = await call("GET", "/admin/verifications", { user: admin });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.meta, { page: 1, limit: 20, total: 2 });
      assert.deepEqual(
        res.body.data.map((item) => item.user.email),
        ["2023pgcese01@nitjsr.ac.in", "2024ugcs999@nitjsr.ac.in"],
      );
      const { submittedAt, ...item } = res.body.data[1];
      assert.ok(submittedAt);
      assert.deepEqual(item, {
        user: {
          _id: String(applicant._id),
          name: "Kabir Singh",
          email: "2024ugcs999@nitjsr.ac.in",
          emailHints: { year: 2024, level: "ug", branch: "cs", serial: "999" },
          memberType: "ug",
          department: {
            _id: String(f.cse._id),
            code: "cse",
            name: "Computer Science and Engineering",
          },
        },
        status: "pending",
        reviewedAt: null,
        reason: null,
        hasIdCard: true,
        ocrCheck: null,
      });
      assert.equal(JSON.stringify(res.body).includes("campuscommons/"), false);

      const page2 = await call("GET", "/admin/verifications?limit=1&page=2", {
        user: admin,
      });
      assert.deepEqual(page2.body.meta, { page: 2, limit: 1, total: 2 });
      assert.equal(page2.body.data[0].user._id, String(applicant._id));

      // The fixtures' six users are approved.
      const approved = await call(
        "GET",
        "/admin/verifications?status=approved",
        {
          user: admin,
        },
      );
      assert.equal(approved.body.meta.total, 6);

      assertError(
        await call("GET", "/admin/verifications?status=unsubmitted", {
          user: admin,
        }),
        400,
        "VALIDATION_ERROR",
      );
      for (const user of [f.student, f.manager, applicant])
        assertError(
          await call("GET", "/admin/verifications", { user }),
          403,
          "FORBIDDEN",
        );
      // The admin role is read from the database, not from the token.
      await User.updateOne({ _id: admin._id }, { roles: ["member"] });
      assertError(
        await call("GET", "/admin/verifications", { user: admin }),
        403,
        "FORBIDDEN",
      );
    });

    test("the ID card link: expires within 5 minutes, never cached, audited on every view", async () => {
      await submit(applicant);
      const publicId = lastUploadId();
      const before = Date.now();
      const res = await cardLink(admin, applicant);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.deepEqual(Object.keys(res.body.data).sort(), ["expiresAt", "url"]);
      const expiresAt = new Date(res.body.data.expiresAt).getTime();
      assert.ok(expiresAt > before);
      assert.ok(expiresAt <= Date.now() + 5 * 60_000);
      assert.ok(expiresAt >= before + 5 * 60_000 - 1000);
      assert.deepEqual(
        fake.signed.map(({ publicId: id, type }) => [id, type]),
        [[publicId, "authenticated"]],
      );
      assert.equal(
        new URL(res.body.data.url).searchParams.get("expires_at"),
        String(Math.floor(expiresAt / 1000)),
      );

      await cardLink(admin, applicant);
      const views = await audits("verification.id_viewed");
      assert.equal(views.length, 2);
      for (const view of views) {
        assert.equal(String(view.actor.id), String(admin._id));
        assert.equal(view.actor.role, "admin");
        assert.deepEqual(view.entity, { type: "user", id: applicant._id });
        assert.equal(view.orgUnit, undefined);
      }

      // Members and managers never get one, and their attempts write nothing.
      for (const user of [applicant, f.manager])
        assertError(await cardLink(user, applicant), 403, "FORBIDDEN");
      assert.equal((await audits("verification.id_viewed")).length, 2);

      assertError(await cardLink(admin, f.student), 404, "NOT_FOUND");
      assertError(
        await call("GET", "/admin/verifications/not-an-id/id-card", {
          user: admin,
        }),
        404,
        "NOT_FOUND",
      );
      // Cloudinary no longer has it: 404 too, and no audit entry claims a view.
      useUploader({ ...fake, signedUrl: async () => null });
      assertError(await cardLink(admin, applicant), 404, "NOT_FOUND");
      assert.equal((await audits("verification.id_viewed")).length, 2);
    });

    test("approve: confirms or corrects type and department, deletes the card, notifies and emails", async () => {
      await submit(applicant);
      const publicId = lastUploadId();
      const res = await decide(admin, applicant, {
        decision: "approve",
        memberType: "pg",
        department: String(f.dic._id),
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const item = res.body.data;
      assert.equal(item.status, "approved");
      assert.equal(item.hasIdCard, false);
      assert.equal(item.reason, null);
      assert.ok(item.reviewedAt);
      assert.equal(item.user.memberType, "pg");
      assert.equal(item.user.department.code, "dic");

      assert.deepEqual(fake.destroyed, [{ publicId, type: "authenticated" }]);
      const saved = await stored(applicant);
      assert.equal(saved.idCardPublicId, undefined);
      assert.equal(String(saved.reviewedBy), String(admin._id));

      const [entry] = await audits("verification.approved");
      assert.equal(String(entry.actor.id), String(admin._id));
      assert.equal(entry.actor.role, "admin");
      assert.deepEqual(entry.changes, {
        status: ["pending", "approved"],
        memberType: ["ug", "pg"],
        department: [String(f.cse._id), String(f.dic._id)],
      });

      const notes = await Notification.find({ user: applicant._id }).lean();
      assert.equal(notes.length, 1);
      assert.equal(notes[0].type, "verification.approved");
      assert.equal(notes[0].link, "/verification");
      assert.equal(mails.length, 1);
      assert.equal(mails[0].to, "2024ugcs999@nitjsr.ac.in");
      assert.match(mails[0].subject, /verified/);
      assert.match(mails[0].text, /\/verification/);

      // The member's own view now says approved, with no card on file.
      const status = await call("GET", "/verification/status", {
        user: applicant,
      });
      assert.equal(status.body.data.status, "approved");
      assert.equal(status.body.data.hasIdCard, false);
      assert.equal(status.body.data.memberType, "pg");
      // And a verified member may upload photos now.
      const photo = new FormData();
      photo.append("images", new Blob([PNG]), "a.png");
      assert.equal(
        (
          await call("POST", "/uploads/images", {
            user: applicant,
            form: photo,
          })
        ).status,
        201,
      );
    });

    test("reject: needs a reason; deletes the card, notifies and emails with the reason", async () => {
      await submit(applicant);
      const publicId = lastUploadId();
      const noReason = await decide(admin, applicant, { decision: "reject" });
      assertError(noReason, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        noReason.body.error.details.map((d) => d.path),
        ["reason"],
      );
      assert.equal(fake.destroyed.length, 0, "nothing happens on a 400");
      assert.equal((await stored(applicant)).idCardPublicId, publicId);

      const reason = "The photo is too blurry to read the roll number.";
      const res = await decide(admin, applicant, {
        decision: "reject",
        reason,
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.status, "rejected");
      assert.equal(res.body.data.reason, reason);
      assert.equal(res.body.data.hasIdCard, false);
      assert.deepEqual(fake.destroyed, [{ publicId, type: "authenticated" }]);
      assert.equal((await stored(applicant)).idCardPublicId, undefined);

      const [entry] = await audits("verification.rejected");
      assert.equal(entry.reason, reason);
      assert.deepEqual(entry.changes, { status: ["pending", "rejected"] });
      const [note] = await Notification.find({ user: applicant._id }).lean();
      assert.equal(note.type, "verification.rejected");
      assert.equal(note.link, "/verification");
      assert.ok(note.body.includes(reason));
      assert.equal(mails.length, 1);
      assert.ok(mails[0].text.includes(reason));

      const status = await call("GET", "/verification/status", {
        user: applicant,
      });
      assert.equal(status.body.data.status, "rejected");
      assert.equal(status.body.data.reason, reason);
    });

    test("one decision per submission, never on your own card, and only by admins", async () => {
      await submit(applicant);
      assertError(
        await decide(f.student, applicant, { decision: "approve" }),
        403,
        "FORBIDDEN",
      );
      assert.equal(
        (await decide(admin, applicant, { decision: "approve" })).status,
        200,
      );
      assertError(
        await decide(admin, applicant, { decision: "approve" }),
        409,
        "INVALID_TRANSITION",
      );
      assertError(
        await decide(admin, f.student2, {
          decision: "reject",
          reason: "Not a student card",
        }),
        409,
        "INVALID_TRANSITION",
      );

      // An admin whose own card is pending can't approve it; another admin can.
      await User.updateOne(
        { _id: admin._id },
        {
          emailVerified: true,
          "verification.status": "unsubmitted",
        },
      );
      await submit(admin);
      const own = await decide(admin, admin, { decision: "approve" });
      assertError(own, 403, "FORBIDDEN");
      assert.match(own.body.error.message, /your own verification/);
      const other = await User.create({
        name: "Second Admin",
        email: "admin2@nitjsr.ac.in",
        passwordHash: "x".repeat(60),
        roles: ["admin"],
        verification: { status: "approved" },
      });
      assert.equal(
        (await decide(other, admin, { decision: "approve" })).status,
        200,
      );

      // A suspended admin reads but doesn't decide.
      await User.updateOne(
        { _id: other._id },
        { suspendedUntil: new Date(Date.now() + 86_400_000) },
      );
      const suspended = await decide(other, f.student, { decision: "approve" });
      assertError(suspended, 403, "FORBIDDEN");
      assert.match(suspended.body.error.message, /suspended/);
    });

    test("the public demo admin reaches demo accounts only: never a real member's row, card or decision", async () => {
      // The documented deployment: real sign-ups on nitjsr.ac.in, and the demo buttons, which give
      // anyone an admin session with no password.
      const savedMode = process.env.DEMO_MODE;
      process.env.DEMO_MODE = "true";
      try {
        const session = await call("POST", "/auth/demo-login", {
          json: { role: "admin" },
        });
        assert.equal(session.status, 200, JSON.stringify(session.body));
        const token = session.body.data.accessToken;
        assert.equal(session.body.data.user._id, String(f.admin._id));

        await submit(applicant);
        const publicId = lastUploadId();
        const demoPending = await User.create({
          name: "Rohan Mehta",
          email: "newstudent@demo.campuscommons.test",
          passwordHash: "x".repeat(60),
          emailVerified: true,
          memberType: "ug",
          department: f.cse._id,
          verification: { status: "pending", submittedAt: new Date() },
        });

        const queue = await call("GET", "/admin/verifications", { token });
        assert.equal(queue.status, 200, JSON.stringify(queue.body));
        assert.deepEqual(
          queue.body.data.map((item) => item.user.email),
          ["newstudent@demo.campuscommons.test"],
        );
        assert.equal(queue.body.meta.total, 1);
        assert.equal(JSON.stringify(queue.body).includes("nitjsr"), false);

        const link = await call(
          "GET",
          `/admin/verifications/${applicant._id}/id-card`,
          { token },
        );
        assertError(link, 404, "NOT_FOUND");
        assert.equal(fake.signed.length, 0);
        assert.equal((await audits("verification.id_viewed")).length, 0);

        const submittedAt = (await stored(applicant)).submittedAt;
        for (const json of [
          { decision: "approve", submittedAt },
          { decision: "reject", reason: "Not a real card.", submittedAt },
        ])
          assertError(
            await call("PATCH", `/admin/verifications/${applicant._id}`, {
              token,
              json,
            }),
            404,
            "NOT_FOUND",
          );
        const saved = await stored(applicant);
        assert.equal(saved.status, "pending");
        assert.equal(saved.idCardPublicId, publicId);
        assert.equal(fake.destroyed.length, 0);
        assert.equal(await Notification.countDocuments({}), 0);

        // The demo flow itself still works.
        const demo = await call(
          "PATCH",
          `/admin/verifications/${demoPending._id}`,
          {
            token,
            json: {
              decision: "approve",
              submittedAt: (await stored(demoPending)).submittedAt,
            },
          },
        );
        assert.equal(demo.status, 200, JSON.stringify(demo.body));
        assert.equal(demo.body.data.status, "approved");
      } finally {
        if (savedMode === undefined) delete process.env.DEMO_MODE;
        else process.env.DEMO_MODE = savedMode;
      }
    });

    test("the seeded pending user with no image: hasIdCard false, the link is 404, deciding still works", async () => {
      const seeded = (login, name) =>
        User.create({
          name,
          email: `${login}@demo.campuscommons.test`,
          passwordHash: "x".repeat(60),
          emailVerified: true,
          memberType: "ug",
          department: f.cse._id,
          verification: { status: "pending", submittedAt: new Date() },
        });
      const newstudent = await seeded("newstudent", "Rohan Mehta");
      const another = await seeded("newstudent2", "Sara Khan");

      const queue = await call("GET", "/admin/verifications", {
        user: f.admin,
      });
      const row = queue.body.data.find(
        (item) => item.user._id === String(newstudent._id),
      );
      assert.equal(row.hasIdCard, false);
      assert.equal(row.status, "pending");
      const link = await cardLink(f.admin, newstudent);
      assertError(link, 404, "NOT_FOUND");
      assert.equal(fake.signed.length, 0);

      // Nothing to delete, so it works even without Cloudinary.
      useUploader(null);
      const saved = process.env.CLOUDINARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_CLOUD_NAME;
      try {
        const approved = await decide(f.admin, newstudent, {
          decision: "approve",
        });
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        assert.equal(approved.body.data.status, "approved");
        assert.equal(approved.body.data.user.memberType, "ug");
        assert.equal(approved.body.data.user.department.code, "cse");
        const rejected = await decide(f.admin, another, {
          decision: "reject",
          reason: "Please upload your ID card.",
        });
        assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
        assert.equal(rejected.body.data.status, "rejected");
      } finally {
        if (saved !== undefined) process.env.CLOUDINARY_CLOUD_NAME = saved;
      }
      assert.equal(fake.destroyed.length, 0);
      // In-app notices, but no email: the mailer never sends to *.test.
      assert.equal(
        await Notification.countDocuments({
          user: { $in: [newstudent._id, another._id] },
        }),
        2,
      );
      assert.equal(mails.length, 0);
      const [entry] = await audits("verification.approved");
      assert.equal(entry.meta.hadIdCard, false);
    });

    test("if the card can't be deleted, the decision isn't saved (503)", async () => {
      await submit(applicant);
      fake.failDestroy = new Error("ECONNRESET");
      const res = await decide(admin, applicant, { decision: "approve" });
      assertError(res, 503, "SERVICE_UNAVAILABLE");
      const saved = await stored(applicant);
      assert.equal(saved.status, "pending");
      assert.equal(saved.idCardPublicId, lastUploadId());
      assert.equal((await audits("verification.approved")).length, 0);
      assert.equal(await Notification.countDocuments({}), 0);
      fake.failDestroy = null;
      assert.equal(
        (await decide(admin, applicant, { decision: "approve" })).status,
        200,
      );
    });
  });

  describe("the on-device check (FC-12)", () => {
    const answers = (checks) => JSON.stringify({ v: 1, checks });
    const queue = async () => (await call("GET", "/admin/verifications", { user: admin })).body.data;
    const cardFile = (who, user) =>
      fetch(`${origin}/api/v1/admin/verifications/${user._id}/id-card/file`, {
        headers: { authorization: `Bearer ${signAccessToken(who)}` },
      });
    afterEach(() => useCardFetcher(null));

    test("the answers go with the upload, are counted here, and show in the admin's queue", async () => {
      const res = await submit(applicant, { ocrCheck: answers({ institute: true, rollNumber: true, name: false, year: true }) });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const saved = await stored(applicant);
      assert.deepEqual(saved.ocrCheck.checks, { institute: true, rollNumber: true, name: false, year: true });
      assert.equal(saved.ocrCheck.score, 3);
      assert.equal(saved.ocrCheck.total, 4);
      const [item] = await queue();
      assert.deepEqual(item.ocrCheck.checks, { institute: true, rollNumber: true, name: false, year: true });
      assert.equal(item.ocrCheck.score, 3);
      assert.equal(item.ocrCheck.total, 4);
      assert.equal("ocrCheck" in res.body.data, false, "the member's own view doesn't need it");
      const [entry] = await audits("verification.submitted");
      assert.equal(entry.meta.deviceCheck, "3/4");
    });

    test("anything but the answers' shape is 400 ocrCheck, and nothing is stored", async () => {
      for (const bad of [
        "not json",
        JSON.stringify({ v: 2, checks: { institute: true } }),
        answers({}),
        answers({ institute: "yes" }),
        answers({ institute: true, text: true }),
        JSON.stringify({ v: 1, checks: { institute: true }, text: "NIT JAMSHEDPUR Ananya" }),
        "x".repeat(400),
      ]) {
        const res = await submit(applicant, { ocrCheck: bad });
        assertError(res, 400, "VALIDATION_ERROR");
        assert.equal(res.body.error.details[0].path, "ocrCheck", bad);
      }
      assert.equal(fake.uploads.length, 0);
    });

    test("a new card without a check drops the old check; the decision clears it with the card", async () => {
      await submit(applicant, { ocrCheck: answers({ institute: true, year: false }) });
      await submit(applicant);
      assert.equal((await stored(applicant)).ocrCheck, undefined);
      await submit(applicant, { ocrCheck: answers({ institute: true, year: true }) });
      await decide(admin, applicant, { decision: "approve" });
      assert.equal((await stored(applicant)).ocrCheck, undefined);
    });

    test("the card's bytes for the admin's own check: images only, never cached, audited", async () => {
      await submit(applicant);
      const requested = [];
      useCardFetcher(async (url, init) => {
        requested.push({ url, redirect: init.redirect });
        return new Response(PNG, { headers: { "content-type": "image/png" } });
      });
      const res = await cardFile(admin, applicant);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "image/png");
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
      assert.equal(requested.length, 1);
      assert.match(requested[0].url, /^https:\/\/api\.cloudinary\.com\//, "through the signed link");
      assert.equal(requested[0].redirect, "manual", "redirects are checked, not followed blindly");
      const [entry] = await audits("verification.id_viewed");
      assert.equal(entry.meta.purpose, "device_check");

      useCardFetcher(async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }));
      assert.equal((await cardFile(admin, applicant)).status, 409);
      useCardFetcher(async () => {
        throw new TypeError("fetch failed");
      });
      assert.equal((await cardFile(admin, applicant)).status, 503);
    });

    test("the server decides which checks apply: one left out counts as not found", async () => {
      await submit(applicant, { ocrCheck: answers({ institute: true }) });
      const saved = await stored(applicant);
      assert.deepEqual(saved.ocrCheck.checks, { institute: true, rollNumber: false, name: false, year: false });
      assert.equal(saved.ocrCheck.score, 1);
      assert.equal(saved.ocrCheck.total, 4, "a roll-number address has all four checks");
      const staff = await newMember("registrar.office@nitjsr.ac.in", { emailHints: null });
      await submit(staff, { ocrCheck: answers({ institute: true, rollNumber: true, name: true, year: true }) });
      const staffCheck = (await stored(staff)).ocrCheck;
      assert.deepEqual(staffCheck.checks, { institute: true, name: true, year: true }, "no roll number to look for");
      assert.equal(staffCheck.total, 3);
    });

    test("the card's type comes from its bytes, never from Cloudinary's header", async () => {
      await submit(applicant);
      useCardFetcher(async () => new Response(PNG, { headers: { "content-type": "application/octet-stream" } }));
      const generic = await cardFile(admin, applicant);
      assert.equal(generic.status, 200, "Cloudinary's download link may not say image/png");
      assert.equal(generic.headers.get("content-type"), "image/png");
      useCardFetcher(async () => new Response(PNG, { headers: { "content-type": "image/png, text/html" } }));
      assert.equal((await cardFile(admin, applicant)).headers.get("content-type"), "image/png");
      useCardFetcher(async () => new Response("<svg xmlns='http://www.w3.org/2000/svg'/>", { headers: { "content-type": "image/png" } }));
      assert.equal((await cardFile(admin, applicant)).status, 409, "not an image, whatever the header says");
    });

    test("one redirect within our Cloudinary account is followed; one elsewhere is refused", async (t) => {
      const saved = process.env.CLOUDINARY_CLOUD_NAME;
      process.env.CLOUDINARY_CLOUD_NAME = "test";
      t.after(() => {
        if (saved === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
        else process.env.CLOUDINARY_CLOUD_NAME = saved;
      });
      await submit(applicant);
      const to = (location) => async (url, init) =>
        url.startsWith("https://api.cloudinary.com/")
          ? new Response(null, { status: 302, headers: { location } })
          : (assert.equal(init.redirect, "error"), new Response(PNG, { headers: { "content-type": "image/png" } }));
      useCardFetcher(to("https://res.cloudinary.com/test/image/authenticated/s--x--/v1/campuscommons/id-cards/abc.png"));
      assert.equal((await cardFile(admin, applicant)).status, 200);
      for (const elsewhere of ["https://evil.example/abc.png", "https://res.cloudinary.com/other-cloud/image/upload/abc.png", "http://res.cloudinary.com/test/x.png"]) {
        useCardFetcher(to(elsewhere));
        assert.equal((await cardFile(admin, applicant)).status, 503, elsewhere);
      }
    });

    test("HEAD doesn't fetch or audit the card", async () => {
      await submit(applicant);
      let fetched = 0;
      useCardFetcher(async () => {
        fetched += 1;
        return new Response(PNG, { headers: { "content-type": "image/png" } });
      });
      const res = await fetch(`${origin}/api/v1/admin/verifications/${applicant._id}/id-card/file`, {
        method: "HEAD",
        headers: { authorization: `Bearer ${signAccessToken(admin)}` },
      });
      assert.equal(res.status, 405);
      assert.equal(fetched, 0);
      assert.equal((await audits("verification.id_viewed")).length, 0);
    });

    test("a body that is too big, or breaks off, is a 503, not a 500", async () => {
      await submit(applicant);
      let pulled = 0;
      const endless = () =>
        new ReadableStream({
          pull(controller) {
            pulled += 1 << 20;
            controller.enqueue(new Uint8Array(1 << 20));
          },
        });
      useCardFetcher(async () => new Response(endless(), { headers: { "content-type": "image/png" } }));
      assert.equal((await cardFile(admin, applicant)).status, 503);
      assert.ok(pulled <= 8 << 20, `stopped reading at the cap (read ${pulled >> 20} MB)`);
      const broken = new ReadableStream({
        start(controller) {
          controller.enqueue(PNG.subarray(0, 8));
          controller.error(new Error("socket hang up"));
        },
      });
      useCardFetcher(async () => new Response(broken, { headers: { "content-type": "image/png" } }));
      assert.equal((await cardFile(admin, applicant)).status, 503);
    });

    test("only admins, and 404 without a card", async () => {
      useCardFetcher(async () => new Response(PNG, { headers: { "content-type": "image/png" } }));
      await submit(applicant);
      assert.equal((await cardFile(applicant, applicant)).status, 403);
      const nobody = await newMember("2024ugcs111@nitjsr.ac.in");
      assert.equal((await cardFile(admin, nobody)).status, 404);
      assert.equal((await audits("verification.id_viewed")).length, 0);
    });
  });
});
