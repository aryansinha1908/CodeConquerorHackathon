// verificationService against a real MongoDB (architecture.md §8, backend.md B-03): the edges the HTTP
// test doesn't reach. Races between an upload and a decision, the order of a decision's steps, email
// preferences, and the input rules. A fake uploader stands in for Cloudinary.
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { useUploader } from "../../src/config/cloudinary.js";
import { useMailTransport } from "../../src/config/mailer.js";
import {
  AuditLog,
  Notification,
  OrgUnit,
  User,
} from "../../src/models/index.js";
import {
  decideVerification,
  getIdCardUrl,
  getVerificationStatus,
  listVerifications,
  submitIdCard,
} from "../../src/services/verificationService.js";
import { NOW, failure, skip, useTestDatabase } from "./fixtures.js";

const mails = [];
useMailTransport({ sendMail: async (message) => mails.push(message) });

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c00000000049454e44ae426082",
  "hex",
);
const card = () => [
  { buffer: PNG, originalname: "card.png", mimetype: "image/png" },
];

let f;
let fake;
let member;
// A real admin. The fixtures' admin is a demo account, which only reaches demo accounts.
let admin;

// onUpload / onDestroy run inside the call, to change the database the way a concurrent request would.
function fakeUploader() {
  const uploader = {
    uploads: [],
    destroyed: [],
    onUpload: null,
    onDestroy: null,
    async upload(_buffer, options) {
      const publicId = `${options.folder}/${options.publicId}`;
      uploader.uploads.push(publicId);
      if (uploader.onUpload) await uploader.onUpload(publicId);
      return { publicId, url: null, format: "png" };
    },
    async destroy(publicId) {
      uploader.destroyed.push(publicId);
      if (uploader.onDestroy) await uploader.onDestroy(publicId);
      return { deleted: true };
    },
    async signedUrl(publicId, { expiresAt }) {
      return `https://api.cloudinary.com/download?public_id=${publicId}&expires_at=${expiresAt.getTime()}`;
    },
  };
  return uploader;
}

const stored = async (user) =>
  (await User.findById(user._id).select("+verification.idCardPublicId").lean())
    .verification;

// The submittedAt of the submission on file, as the admin's queue shows it.
const reviewed = async (user) => (await stored(user)).submittedAt ?? null;

// decideVerification with the queue item's submittedAt, unless the input says otherwise.
const decideAs = async (who, user, input, options) =>
  decideVerification(
    who._id,
    user._id,
    input && typeof input === "object" && !("submittedAt" in input)
      ? { submittedAt: await reviewed(user), ...input }
      : input,
    options,
  );

const submitAs = (user, input = {}, options = {}) =>
  submitIdCard(
    user._id,
    { memberType: "ug", department: String(f.cse._id), ...input },
    card(),
    { now: NOW, ...options },
  );

describe("verificationService", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  beforeEach(async () => {
    fake = fakeUploader();
    useUploader(fake);
    mails.length = 0;
    member = await User.create({
      name: "Kabir Singh",
      email: "2024ugcs999@nitjsr.ac.in",
      passwordHash: "x".repeat(60),
      emailVerified: true,
    });
    admin = await User.create({
      name: "Registrar",
      email: "registrar@nitjsr.ac.in",
      passwordHash: "x".repeat(60),
      emailVerified: true,
      roles: ["admin"],
    });
  });

  afterEach(() => useUploader(null));

  describe("submitIdCard", () => {
    test("an email that isn't verified can't submit, and nothing is uploaded", async () => {
      await User.updateOne({ _id: member._id }, { emailVerified: false });
      const err = await failure(submitAs(member));
      assert.equal(err.status, 403);
      assert.equal(err.code, "EMAIL_NOT_VERIFIED");
      assert.equal(fake.uploads.length, 0);
    });

    test("a user stored before the verification field existed counts as unsubmitted", async () => {
      const { insertedId } = await mongoose.connection.db
        .collection("users")
        .insertOne({
          name: "Old Account",
          email: "old@nitjsr.ac.in",
          passwordHash: "x".repeat(60),
          roles: ["member"],
          emailVerified: true,
        });
      const view = await submitAs({ _id: insertedId });
      assert.equal(view.status, "pending");
      assert.equal(view.hasIdCard, true);
    });

    test("a decision that lands during the upload wins: the new upload is removed again (409)", async () => {
      await submitAs(member);
      const first = fake.uploads[0];
      fake.onUpload = () =>
        User.updateOne(
          { _id: member._id },
          {
            "verification.status": "approved",
            $unset: { "verification.idCardPublicId": 1 },
          },
        );
      const err = await failure(submitAs(member));
      assert.equal(err.status, 409);
      assert.equal(err.code, "INVALID_TRANSITION");
      const second = fake.uploads[1];
      assert.deepEqual(fake.destroyed, [second], "the old card isn't touched");
      assert.notEqual(second, first);
      assert.equal((await stored(member)).status, "approved");
      assert.equal(
        await AuditLog.countDocuments({ action: "verification.submitted" }),
        1,
      );

      // With no card on file (the seeded pending user), only the status tells the two apart.
      await User.updateOne(
        { _id: f.student3._id },
        { emailVerified: true, "verification.status": "pending" },
      );
      fake.onUpload = () =>
        User.updateOne(
          { _id: f.student3._id },
          { "verification.status": "approved" },
        );
      assert.equal((await failure(submitAs(f.student3))).status, 409);
      const saved = await stored(f.student3);
      assert.equal(saved.status, "approved");
      assert.equal(saved.idCardPublicId, undefined);
    });

    test("a database error after the upload removes the new card again", async (t) => {
      await submitAs(member);
      const first = fake.uploads[0];
      // A primary stepdown or a write-concern timeout on the save.
      t.mock.method(User, "findOneAndUpdate", () => ({
        lean: async () => {
          throw new Error("not primary");
        },
      }));
      const err = await failure(submitAs(member));
      t.mock.restoreAll();
      assert.equal(err.message, "not primary");
      assert.equal(fake.uploads.length, 2);
      assert.deepEqual(
        fake.destroyed,
        [fake.uploads[1]],
        "the new card is removed; the one on file isn't touched",
      );
      assert.equal((await stored(member)).idCardPublicId, first);
    });

    test("a card that can't be deleted after a replacement doesn't fail the upload", async () => {
      await submitAs(member);
      const first = fake.uploads[0];
      fake.onDestroy = async () => {
        throw new Error("Cloudinary is down");
      };
      const view = await submitAs(member);
      assert.equal(view.status, "pending");
      assert.deepEqual(fake.destroyed, [first]);
      assert.equal((await stored(member)).idCardPublicId, fake.uploads[1]);
    });

    test("only one file, and only active units", async () => {
      const two = await failure(
        submitIdCard(
          member._id,
          { memberType: "ug", department: String(f.cse._id) },
          [...card(), ...card()],
        ),
      );
      assert.deepEqual(two.details, [
        { path: "idCard", message: "Attach only one file." },
      ]);
      const array = await failure(
        submitAs(member, { memberType: ["ug", "pg"], department: [] }),
      );
      assert.deepEqual(array.details.map((d) => d.path).sort(), [
        "department",
        "memberType",
      ]);
      assert.equal(fake.uploads.length, 0);
    });
  });

  describe("decideVerification", () => {
    test("the input rules: known fields only, a 5–500 character reason, real ids and types", async () => {
      await submitAs(member);
      const cases = [
        [{ decision: "approve", status: "approved" }, ["status"]],
        [{}, ["decision"]],
        [{ decision: "maybe" }, ["decision"]],
        [{ decision: "reject", reason: "bad" }, ["reason"]],
        [{ decision: "reject", reason: "x".repeat(501) }, ["reason"]],
        [{ decision: "approve", memberType: "UG" }, ["memberType"]],
        [{ decision: "approve", department: "cse" }, ["department"]],
      ];
      for (const [input, paths] of cases) {
        const err = await failure(
          decideAs(admin, member, input),
        );
        assert.equal(err.status, 400, JSON.stringify(input));
        assert.deepEqual(
          err.details.map((d) => d.path),
          paths,
          JSON.stringify(input),
        );
      }
      const notObject = await failure(
        decideAs(admin, member, "approve"),
      );
      assert.equal(notObject.status, 400);
      assert.equal(fake.destroyed.length, 0);
      assert.equal((await stored(member)).status, "pending");
    });

    test("approving needs a member type and an active department", async () => {
      await User.updateOne(
        { _id: member._id },
        {
          "verification.status": "pending",
          "verification.submittedAt": NOW,
        },
      );
      const missing = await failure(
        decideAs(admin, member, { decision: "approve" }),
      );
      assert.deepEqual(
        missing.details.map((d) => [d.path, d.message]),
        [
          ["memberType", "Required to approve."],
          ["department", "Required to approve."],
        ],
      );
      await OrgUnit.updateOne({ _id: f.dic._id }, { isActive: false });
      const inactive = await failure(
        decideAs(admin, member, {
          decision: "approve",
          memberType: "faculty",
          department: String(f.dic._id),
        }),
      );
      assert.deepEqual(inactive.details, [
        { path: "department", message: "This unit is inactive." },
      ]);
      const done = await decideAs(admin, member, {
        decision: "approve",
        memberType: "faculty",
        department: String(f.cse._id),
        reason: "Checked against the faculty register",
      });
      assert.equal(done.status, "approved");
      assert.equal(done.reason, null, "the note is the audit entry's");
      const [entry] = await AuditLog.find({
        action: "verification.approved",
      }).lean();
      assert.equal(entry.reason, "Checked against the faculty register");
    });

    test("a rejection keeps what the member chose; corrections are for approvals", async () => {
      await submitAs(member, { memberType: "pg" });
      const item = await decideAs(admin, member, {
        decision: "reject",
        reason: "The card has expired.",
        memberType: "faculty",
        department: String(f.dic._id),
      });
      assert.equal(item.status, "rejected");
      assert.equal(item.user.memberType, "pg");
      assert.equal(item.user.department.code, "cse");
    });

    test("a new upload during the decision is a submission the admin hasn't seen (409)", async () => {
      await submitAs(member);
      const first = fake.uploads[0];
      fake.onDestroy = () =>
        User.updateOne(
          { _id: member._id },
          { "verification.idCardPublicId": "campuscommons/id-cards/newer" },
        );
      const err = await failure(
        decideAs(admin, member, { decision: "approve" }),
      );
      assert.equal(err.status, 409);
      assert.equal(err.code, "INVALID_TRANSITION");
      assert.deepEqual(fake.destroyed, [first]);
      const saved = await stored(member);
      assert.equal(saved.status, "pending");
      assert.equal(saved.idCardPublicId, "campuscommons/id-cards/newer");
      assert.equal(await Notification.countDocuments({}), 0);
      assert.equal(mails.length, 0);
    });

    test("a decision names the submission it was made on: a card sent after it was opened is 409 and kept", async () => {
      await submitAs(member);
      const [first] = fake.uploads;
      // What the admin's queue showed when they opened card A.
      const seen = (await reviewed(member)).toISOString();
      // The member replaces it (card B, now as faculty) while the admin is deciding.
      await submitAs(
        member,
        { memberType: "faculty" },
        { now: new Date(NOW.getTime() + 60_000) },
      );
      const newer = fake.uploads[1];
      assert.deepEqual(fake.destroyed, [first]);

      for (const decision of [
        { decision: "approve" },
        { decision: "reject", reason: "The photo is blurred." },
      ]) {
        const err = await failure(
          decideAs(admin, member, { ...decision, submittedAt: seen }),
        );
        assert.equal(err.status, 409);
        assert.equal(err.code, "INVALID_TRANSITION");
      }
      assert.deepEqual(fake.destroyed, [first], "card B was never deleted");
      const saved = await stored(member);
      assert.equal(saved.status, "pending");
      assert.equal(saved.idCardPublicId, newer);
      assert.equal(
        await AuditLog.countDocuments({
          action: { $in: ["verification.approved", "verification.rejected"] },
        }),
        0,
      );
      assert.equal(await Notification.countDocuments({}), 0);

      // A decision that doesn't say which submission it is for decides nothing.
      for (const [submittedAt, message] of [
        [undefined, "Required."],
        ["", "Required."],
        ["yesterday", "Must be a valid date."],
      ]) {
        const err = await failure(
          decideAs(admin, member, { decision: "approve", submittedAt }),
        );
        assert.equal(err.status, 400);
        assert.deepEqual(err.details, [{ path: "submittedAt", message }]);
      }
      assert.deepEqual(fake.destroyed, [first]);

      // Card B, once reviewed, is decided on.
      const item = await decideAs(admin, member, { decision: "approve" });
      assert.equal(item.status, "approved");
      assert.equal(item.user.memberType, "faculty");
      assert.deepEqual(fake.destroyed, [first, newer]);
    });

    test("email follows notificationPrefs; the in-app notice always goes", async () => {
      await User.updateOne(
        { _id: member._id },
        { "notificationPrefs.email": false },
      );
      await submitAs(member);
      await decideAs(admin, member, {
        decision: "approve",
      });
      assert.equal(mails.length, 0);
      assert.equal(
        await Notification.countDocuments({
          user: member._id,
          type: "verification.approved",
        }),
        1,
      );
    });

    test("a 500-character reason still fits the notification, and the email has all of it", async () => {
      await submitAs(member);
      const reason = `${"r".repeat(491)} the end.`;
      assert.equal(reason.length, 500);
      await decideAs(admin, member, {
        decision: "reject",
        reason,
      });
      const [note] = await Notification.find({ user: member._id }).lean();
      assert.equal(note.type, "verification.rejected");
      assert.ok(note.body.length <= 500);
      assert.ok(note.body.endsWith("…"));
      assert.equal(note.body.includes("the end."), false);
      assert.equal(mails.length, 1);
      assert.ok(
        mails[0].text.includes(`Reason: ${reason}`),
        "an email has no length limit, so the reason isn't cut",
      );
      assert.equal((await getVerificationStatus(member._id)).reason, reason);
    });
  });

  describe("listVerifications and getIdCardUrl", () => {
    test("decided rows come newest decision first", async () => {
      const at = (h) => new Date(NOW.getTime() + h * 3_600_000);
      await User.updateOne(
        { _id: f.student._id },
        { "verification.reviewedAt": at(1) },
      );
      await User.updateOne(
        { _id: f.student2._id },
        { "verification.reviewedAt": at(2) },
      );
      const { items, meta } = await listVerifications(admin._id, {
        status: "approved",
        limit: "2",
      });
      assert.deepEqual(
        items.map((i) => i.user._id),
        [String(f.student2._id), String(f.student._id)],
      );
      assert.equal(meta.total, 6);
      const bad = await failure(listVerifications(admin._id, { page: "0" }));
      assert.equal(bad.status, 400);
    });

    test("a demo admin reaches demo accounts only: no queue row, card or decision for a real member", async () => {
      await submitAs(member);
      const demoPending = await User.create({
        name: "Rohan Mehta",
        email: "newstudent@demo.campuscommons.test",
        passwordHash: "x".repeat(60),
        emailVerified: true,
        memberType: "ug",
        department: f.cse._id,
        verification: { status: "pending", submittedAt: NOW },
      });

      const queue = await listVerifications(f.admin._id, {});
      assert.deepEqual(
        queue.items.map((i) => i.user._id),
        [String(demoPending._id)],
      );
      assert.equal(queue.meta.total, 1);
      const real = await listVerifications(admin._id, {});
      assert.deepEqual(
        real.items.map((i) => i.user._id).sort(),
        [String(member._id), String(demoPending._id)].sort(),
      );

      for (const attempt of [
        () => getIdCardUrl(f.admin._id, member._id),
        () => decideAs(f.admin, member, { decision: "approve" }),
        () =>
          decideAs(f.admin, member, {
            decision: "reject",
            reason: "Not a real card.",
          }),
      ]) {
        const err = await failure(attempt());
        assert.equal(err.status, 404);
        assert.equal(err.code, "NOT_FOUND");
      }
      assert.equal(fake.destroyed.length, 0);
      const saved = await stored(member);
      assert.equal(saved.status, "pending");
      assert.equal(saved.idCardPublicId, fake.uploads[0]);
      assert.equal(
        await AuditLog.countDocuments({ "actor.id": f.admin._id }),
        0,
      );

      // Demo accounts are still the demo admin's to decide on.
      const item = await decideAs(f.admin, demoPending, {
        decision: "approve",
      });
      assert.equal(item.status, "approved");
    });

    test("the link's expiry is 5 minutes from now, and its audit entry carries it", async () => {
      await submitAs(member);
      const link = await getIdCardUrl(admin._id, member._id, {
        now: NOW,
        requestId: "req-1",
      });
      assert.equal(link.expiresAt.getTime(), NOW.getTime() + 5 * 60_000);
      const [entry] = await AuditLog.find({
        action: "verification.id_viewed",
      }).lean();
      assert.equal(entry.requestId, "req-1");
      assert.equal(
        new Date(entry.meta.expiresAt).getTime(),
        link.expiresAt.getTime(),
      );
    });

    test("Cloudinary failing to sign is 503, with no audit entry", async () => {
      await submitAs(member);
      useUploader({
        ...fake,
        signedUrl: async () => {
          throw new Error("ETIMEDOUT");
        },
      });
      const err = await failure(getIdCardUrl(admin._id, member._id));
      assert.equal(err.status, 503);
      assert.equal(err.code, "SERVICE_UNAVAILABLE");
      assert.equal(
        await AuditLog.countDocuments({ action: "verification.id_viewed" }),
        0,
      );
    });
  });
});
