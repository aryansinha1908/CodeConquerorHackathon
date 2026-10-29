// Badge service against a real MongoDB; see fixtures.js for how to run it.
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { useUploader } from "../../src/config/cloudinary.js";
import { keys } from "../../src/lib/redisKeys.js";
import { DAY } from "../../src/lib/time.js";
import {
  AuditLog,
  Badge,
  OrgUnit,
  User,
  UserBadge,
} from "../../src/models/index.js";
import {
  badgeState,
  createBadge,
  decideBadgeRequest,
  getEvidenceUrl,
  grantBadge,
  listBadgeRequests,
  listBadges,
  listMyBadges,
  requestBadge,
} from "../../src/services/badgeService.js";
import { updateOrgUnit } from "../../src/services/orgUnitService.js";
import { getEligibility } from "../../src/services/resourceService.js";
import {
  NOW,
  TUE,
  bookAs,
  failure,
  notificationsFor,
  plus,
  redis,
  skip,
  useTestDatabase,
} from "./fixtures.js";

let f; // fixtures, rebuilt for every test
let laser; // DIC, 180 days, evidence required
let gpu; // CSE, never expires

const audits = (action) =>
  AuditLog.find(action ? { action } : { "entity.type": /badge/ })
    .sort({ at: 1 })
    .lean();
const rowOf = (user, badge) =>
  UserBadge.findOne({ user: user._id, badge: badge._id }).lean();
const names = (list) => list.map((b) => b.name);
const later = (days) => new Date(NOW.getTime() + days * DAY);
const badgeRule = (checklist) =>
  checklist.results.find((r) => r.rule === "BADGES");
const EVIDENCE = { publicId: "campuscommons/evidence/abc123" };

// Runs `change` (raw driver writes, as another request would make them) just before the service's
// conditional findOneAndUpdate on UserBadge, i.e. after the service has read the row.
async function racing(change, run) {
  const { exec } = mongoose.Query.prototype;
  mongoose.Query.prototype.exec = async function (...args) {
    if (this.model === UserBadge && this.op === "findOneAndUpdate") {
      mongoose.Query.prototype.exec = exec;
      await change();
    }
    return exec.apply(this, args);
  };
  try {
    return await run();
  } finally {
    mongoose.Query.prototype.exec = exec;
  }
}

function assertError(err, status, code) {
  assert.equal(err.status, status, err.message);
  assert.equal(err.code, code);
}

const request = (who, badge, input = {}, now = NOW) =>
  requestBadge(who._id, badge._id, input, { now });
const decide = (who, row, input, now = NOW) =>
  decideBadgeRequest(who._id, row._id, input, { now });
const grant = (who, badge, member, extra = {}, now = NOW) =>
  grantBadge(who._id, badge._id, { userId: member._id, ...extra }, { now });

describe("badgeService", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  const addBadges = async () => {
    [laser, gpu] = await Badge.create([
      {
        name: "Laser Cutter Operation",
        code: "laser-cutter-operation",
        orgUnit: f.dic._id,
        validityDays: 180,
        evidenceRequired: true,
      },
      {
        name: "GPU Usage Policy",
        code: "gpu-usage-policy",
        orgUnit: f.cse._id,
        selfServe: true,
      },
    ]);
  };

  describe("catalogue", () => {
    test("lists badges by name with their issuer; orgUnit narrows it", async () => {
      await addBadges();
      const all = await listBadges();
      assert.deepEqual(names(all), [
        "3D Printing Basics",
        "GPU Usage Policy",
        "Laser Cutter Operation",
      ]);
      const printing = all[0];
      assert.deepEqual(printing.orgUnit, {
        _id: String(f.dic._id),
        name: "Design and Innovation Centre",
        code: "dic",
        isActive: true,
      });
      assert.equal(printing.validityDays, null);
      assert.equal(all[1].selfServe, true);

      assert.deepEqual(names(await listBadges({ orgUnit: f.cse._id })), [
        "GPU Usage Policy",
      ]);
      // Upper-case hex names the same unit.
      assert.equal(
        (await listBadges({ orgUnit: String(f.dic._id).toUpperCase() })).length,
        2,
      );
      assertError(
        await failure(listBadges({ orgUnit: { $ne: null } })),
        400,
        "VALIDATION_ERROR",
      );
    });

    test("the shared entry stores ids; a unit rename shows without touching it", async () => {
      await listBadges();
      const cached = JSON.parse(await redis.get(keys.catalogue("badges")));
      assert.equal(cached[0].orgUnit, String(f.dic._id));

      await updateOrgUnit(f.admin._id, f.dic._id, { name: "DIC Makerspace" });
      assert.equal((await listBadges())[0].orgUnit.name, "DIC Makerspace");
    });

    test("badges of an inactive unit are left out", async () => {
      await addBadges();
      await updateOrgUnit(f.admin._id, f.cse._id, { isActive: false });
      assert.deepEqual(names(await listBadges()), [
        "3D Printing Basics",
        "Laser Cutter Operation",
      ]);
    });
  });

  describe("createBadge", () => {
    const WORKSHOP_SAFETY = {
      name: "Workshop Safety Induction",
      code: "Workshop-Safety",
      description: "Covers PPE, machine guards and the emergency stop.",
      validityDays: 365,
    };

    test("a unit's manager creates one; it is listed at once and audited", async () => {
      await listBadges(); // warm the cache
      const badge = await createBadge(
        f.manager._id,
        { ...WORKSHOP_SAFETY, orgUnit: f.dic._id },
        { requestId: "req-1" },
      );
      assert.equal(badge.code, "workshop-safety");
      assert.equal(badge.evidenceRequired, false);
      assert.ok(
        names(await listBadges()).includes("Workshop Safety Induction"),
      );

      const [entry] = await audits("badge.created");
      assert.equal(entry.actor.role, "manager");
      assert.equal(String(entry.orgUnit), String(f.dic._id));
      assert.equal(entry.requestId, "req-1");
      assert.deepEqual(entry.changes.validityDays, [null, 365]);
    });

    test("an admin creates for any unit and is audited as admin", async () => {
      await createBadge(f.admin._id, {
        ...WORKSHOP_SAFETY,
        orgUnit: f.cse._id,
      });
      const [entry] = await audits("badge.created");
      assert.equal(entry.actor.role, "admin");
    });

    test("another unit's manager and a student get 403; nothing is created", async () => {
      for (const who of [f.cseManager, f.student]) {
        assertError(
          await failure(
            createBadge(who._id, { ...WORKSHOP_SAFETY, orgUnit: f.dic._id }),
          ),
          403,
          "FORBIDDEN",
        );
      }
      assert.equal(await Badge.countDocuments(), 1);
    });

    test("field errors: duplicate code, unknown fields, selfServe, bad unit, bad values", async () => {
      const dup = await failure(
        createBadge(f.manager._id, {
          ...WORKSHOP_SAFETY,
          code: "3D-Printing-Basics",
          orgUnit: f.dic._id,
        }),
      );
      assertError(dup, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        dup.details.map((d) => d.path),
        ["code"],
      );

      const refused = await failure(
        createBadge(f.manager._id, {
          ...WORKSHOP_SAFETY,
          orgUnit: f.dic._id,
          selfServe: true,
          holders: [],
        }),
      );
      assertError(refused, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        refused.details.map((d) => d.path),
        ["holders", "selfServe"],
      );
      assert.match(refused.details[1].message, /quiz/);

      for (const [orgUnit, message] of [
        [undefined, "Required."],
        ["dic", "Must be a valid id."],
      ]) {
        const err = await failure(
          createBadge(f.manager._id, { ...WORKSHOP_SAFETY, orgUnit }),
        );
        assert.deepEqual(err.details, [{ path: "orgUnit", message }]);
      }

      await OrgUnit.updateOne({ _id: f.dic._id }, { isActive: false });
      const inactive = await failure(
        createBadge(f.manager._id, { ...WORKSHOP_SAFETY, orgUnit: f.dic._id }),
      );
      assert.deepEqual(inactive.details, [
        { path: "orgUnit", message: "This unit is inactive." },
      ]);
      await OrgUnit.updateOne({ _id: f.dic._id }, { isActive: true });

      const bad = await failure(
        createBadge(f.manager._id, {
          name: "X",
          code: "has spaces",
          orgUnit: f.dic._id,
          validityDays: 1.5,
        }),
      );
      assertError(bad, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        bad.details.map((d) => d.path),
        ["code", "name", "validityDays"],
      );
      assert.equal(await Badge.countDocuments(), 1);
      assert.equal((await audits("badge.created")).length, 0);
    });

    test("an unknown actor is 404, not a CastError", async () => {
      assertError(
        await failure(createBadge("demo-user-id-001", WORKSHOP_SAFETY)),
        404,
        "NOT_FOUND",
      );
    });
  });

  describe("requestBadge", () => {
    test("opens a request, audits it and tells the unit's managers", async () => {
      await addBadges();
      const row = await request(f.student, laser, {
        note: "  Finished the session on Friday.  ",
        evidence: EVIDENCE,
      });
      assert.equal(row.status, "requested");
      assert.equal(row.state, "requested");
      assert.equal(row.note, "Finished the session on Friday.");
      assert.equal(row.requestedAt, NOW.toISOString());
      assert.equal(row.badge.name, "Laser Cutter Operation");
      assert.equal(row.badge.orgUnit.name, "Design and Innovation Centre");
      // The member's own view: the evidence only as a flag, and nobody's user id.
      assert.equal(row.hasEvidence, true);
      assert.equal("evidence" in row, false);
      assert.equal("decidedBy" in row, false);

      const [entry] = await audits("badge.requested");
      assert.equal(entry.actor.role, "member");
      assert.equal(String(entry.actor.id), String(f.student._id));
      assert.deepEqual(entry.changes.status, [null, "requested"]);
      assert.equal(entry.meta.hasEvidence, true);

      const [note] = await notificationsFor(f.manager);
      assert.equal(note.type, "badge.requested");
      assert.equal(
        note.body,
        "Ananya Rao requested the Laser Cutter Operation badge.",
      );
      assert.equal(note.link, "/manage/badges");
      assert.equal((await notificationsFor(f.cseManager)).length, 0);
    });

    test("an open request or a held badge is 409; nothing changes", async () => {
      await addBadges();
      await request(f.student, gpu, { note: "First" });
      const again = await failure(request(f.student, gpu, { note: "Second" }));
      assertError(again, 409, "INVALID_TRANSITION");
      assert.match(again.message, /already requested.*Computer Science/);
      assert.equal((await rowOf(f.student, gpu)).note, "First");

      // Seeded: every student holds 3D Printing Basics.
      const held = await failure(request(f.student, f.badge));
      assertError(held, 409, "INVALID_TRANSITION");
      assert.equal(held.message, "You already hold this badge.");
      assert.equal((await audits("badge.requested")).length, 1);
    });

    test("evidence is required when the badge says so, and must be an upload's publicId", async () => {
      await addBadges();
      const missing = await failure(request(f.student, laser));
      assertError(missing, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        missing.details.map((d) => d.path),
        ["evidence"],
      );
      for (const evidence of ["abc", { publicId: "" }, { publicId: 7 }]) {
        const err = await failure(request(f.student, laser, { evidence }));
        assert.match(err.details[0].message, /publicId/);
      }
      const long = await failure(
        request(f.student, gpu, { note: "x".repeat(501) }),
      );
      assert.deepEqual(
        long.details.map((d) => d.path),
        ["note"],
      );
      assert.equal(await UserBadge.countDocuments({ user: f.student._id }), 1);
    });

    test("unverified members get 403; unknown badges 404; an inactive unit 409", async () => {
      await addBadges();
      await User.updateOne(
        { _id: f.student._id },
        { "verification.status": "pending" },
      );
      assertError(await failure(request(f.student, gpu)), 403, "FORBIDDEN");
      for (const badgeId of [new mongoose.Types.ObjectId(), "gpu", null]) {
        assertError(
          await failure(
            requestBadge(f.student2._id, badgeId, {}, { now: NOW }),
          ),
          404,
          "NOT_FOUND",
        );
      }
      await OrgUnit.updateOne({ _id: f.cse._id }, { isActive: false });
      assertError(
        await failure(request(f.student2, gpu)),
        409,
        "INVALID_TRANSITION",
      );
      assert.equal(await UserBadge.countDocuments({ badge: gpu._id }), 0);
    });

    test("after a rejection the same row becomes a new request, earlier decision cleared", async () => {
      await addBadges();
      const first = await request(f.student, laser, {
        note: "Attended",
        evidence: EVIDENCE,
      });
      await decide(f.manager, first, {
        decision: "reject",
        reason: "The certificate is for a different machine.",
      });
      const second = await request(
        f.student,
        laser,
        { evidence: { publicId: "campuscommons/evidence/def456" } },
        plus(NOW, 60),
      );
      assert.equal(second._id, first._id);
      assert.equal(second.state, "requested");
      assert.equal(second.reason, null);
      assert.equal(second.decidedAt, null);
      assert.equal(second.note, null); // not resent, so not kept
      assert.equal(second.requestedAt, plus(NOW, 60).toISOString());
      const stored = await rowOf(f.student, laser);
      assert.equal(stored.evidence.publicId, "campuscommons/evidence/def456");
      assert.equal(stored.decidedBy, undefined);

      const entries = await audits("badge.requested");
      assert.deepEqual(entries.at(-1).changes.status, [
        "rejected",
        "requested",
      ]);
    });

    test("an expired badge can be requested again", async () => {
      await UserBadge.updateOne(
        { user: f.student._id, badge: f.badge._id },
        { expiresAt: plus(NOW, -60) },
      );
      const row = await request(f.student, f.badge);
      assert.equal(row.state, "requested");
      const [entry] = await audits("badge.requested");
      assert.deepEqual(entry.changes.status, ["expired", "requested"]);
    });
  });

  describe("races", () => {
    test("a grant that lands while a member re-requests isn't turned back into a request", async () => {
      await addBadges();
      const row = await request(f.student, gpu);
      await decide(f.cseManager, row, {
        decision: "reject",
        reason: "Not yet",
      });
      const err = await failure(
        racing(
          () =>
            UserBadge.collection.updateOne(
              { _id: new mongoose.Types.ObjectId(row._id) },
              { $set: { status: "active", updatedAt: plus(NOW, 1) } },
            ),
          () => request(f.student, gpu, {}, plus(NOW, 2)),
        ),
      );
      assertError(err, 409, "INVALID_TRANSITION");
      assert.equal((await rowOf(f.student, gpu)).status, "active");
      assert.equal((await audits("badge.requested")).length, 1);
    });

    test("a decision on a request the member replaced meanwhile is 409", async () => {
      await addBadges();
      const row = await request(f.student, gpu, { note: "First try" });
      // Rejected by another manager, then requested again, while this manager was deciding.
      const err = await failure(
        racing(
          () =>
            UserBadge.collection.updateOne(
              { _id: new mongoose.Types.ObjectId(row._id) },
              { $set: { note: "Second try", updatedAt: plus(NOW, 1) } },
            ),
          () => decide(f.cseManager, row, { decision: "approve" }),
        ),
      );
      assertError(err, 409, "INVALID_TRANSITION");
      assert.equal((await rowOf(f.student, gpu)).status, "requested");
      assert.equal((await audits("badge.granted")).length, 0);
      assert.equal((await notificationsFor(f.student)).length, 0);
    });
  });

  describe("listMyBadges", () => {
    test("each row has a state, expired worked out from expiresAt", async () => {
      await addBadges();
      await request(f.student, gpu);
      const rejected = await request(
        f.student,
        laser,
        { evidence: EVIDENCE },
        plus(NOW, -10),
      );
      await decide(f.manager, rejected, { decision: "reject", reason: "No" });

      const now = plus(NOW, 5);
      const before = await listMyBadges(f.student._id, { now });
      const states = Object.fromEntries(
        before.map((r) => [r.badge.code, r.state]),
      );
      assert.deepEqual(states, {
        "3d-printing-basics": "active",
        "gpu-usage-policy": "requested",
        "laser-cutter-operation": "rejected",
      });
      assert.equal(before.find((r) => r.state === "rejected").reason, "No");

      await UserBadge.updateOne(
        { user: f.student._id, badge: f.badge._id },
        { expiresAt: plus(now, 1) },
      );
      const after = await listMyBadges(f.student._id, { now: plus(now, 2) });
      assert.equal(
        after.find((r) => r.badge.code === "3d-printing-basics").state,
        "expired",
      );
      assert.equal((await listMyBadges(f.student2._id, { now })).length, 1);
    });

    test("badgeState matches the eligibility engine's expiry test", () => {
      const at = NOW;
      assert.equal(
        badgeState({ status: "active", expiresAt: at }, at),
        "expired",
      );
      assert.equal(
        badgeState({ status: "active", expiresAt: plus(at, 1) }, at),
        "active",
      );
      assert.equal(
        badgeState({ status: "active", expiresAt: null }, at),
        "active",
      );
      assert.equal(
        badgeState({ status: "revoked", expiresAt: plus(at, -1) }, at),
        "revoked",
      );
    });
  });

  describe("listBadgeRequests", () => {
    const openRequests = async () => {
      await addBadges();
      await request(f.student2, laser, { evidence: EVIDENCE }, plus(NOW, -30));
      await request(f.student, laser, { evidence: EVIDENCE }, plus(NOW, -60));
      await request(f.student3, gpu, {}, plus(NOW, -90));
    };

    test("a manager sees their units' requests, oldest first, without emails", async () => {
      await openRequests();
      const { items, meta } = await listBadgeRequests(f.manager._id);
      assert.deepEqual(
        items.map((r) => r.user.name),
        ["Ananya Rao", "Kabir Singh"],
      );
      assert.deepEqual(meta, { page: 1, limit: 20, total: 2 });
      const [first] = items;
      assert.deepEqual(Object.keys(first.user).sort(), [
        "_id",
        "department",
        "memberType",
        "name",
      ]);
      assert.equal(first.user.department.code, "cse");
      assert.deepEqual(first.evidence, EVIDENCE);

      assert.deepEqual(
        (await listBadgeRequests(f.cseManager._id)).items.map(
          (r) => r.user.name,
        ),
        ["Ishaan Das"],
      );
      assert.equal((await listBadgeRequests(f.admin._id)).meta.total, 3);
    });

    test("filters by status and badge; pages; refuses members and other units' badges", async () => {
      await openRequests();
      const page = await listBadgeRequests(f.admin._id, { limit: 1, page: 2 });
      assert.equal(page.items.length, 1);
      assert.equal(page.meta.total, 3);

      const [row] = (await listBadgeRequests(f.manager._id)).items;
      await decide(f.manager, row, { decision: "approve" });
      const active = await listBadgeRequests(f.manager._id, {
        status: "active",
      });
      // The seeded holders were never decided, so they come after.
      assert.equal(active.items[0].user.name, "Ananya Rao");
      assert.equal(active.items[0].decidedBy.name, "Meera Iyer");
      assert.equal(
        (await listBadgeRequests(f.admin._id, { badgeId: gpu._id })).meta.total,
        1,
      );

      assertError(
        await failure(listBadgeRequests(f.student._id)),
        403,
        "FORBIDDEN",
      );
      for (const badgeId of [gpu._id, new mongoose.Types.ObjectId()]) {
        assertError(
          await failure(listBadgeRequests(f.manager._id, { badgeId })),
          403,
          "FORBIDDEN",
        );
      }
      const bad = await failure(
        listBadgeRequests(f.manager._id, { status: "pending", page: 0 }),
      );
      assert.deepEqual(
        bad.details.map((d) => d.path),
        ["status", "page"],
      );
    });
  });

  describe("decideBadgeRequest", () => {
    test("approving makes the badge active for validityDays and tells the member", async () => {
      await addBadges();
      const row = await request(f.student, laser, { evidence: EVIDENCE });
      const decided = await decideBadgeRequest(
        f.manager._id,
        row._id,
        { decision: "approve", reason: "Saw the certificate." },
        { now: NOW, requestId: "req-9" },
      );
      assert.equal(decided.state, "active");
      assert.equal(decided.expiresAt, later(180).toISOString());
      assert.equal(decided.decidedAt, NOW.toISOString());
      assert.equal(decided.reason, null);

      const [entry] = await audits("badge.granted");
      assert.equal(entry.actor.role, "manager");
      assert.equal(entry.reason, "Saw the certificate.");
      assert.deepEqual(entry.changes.status, ["requested", "active"]);
      assert.equal(entry.requestId, "req-9");

      const [note] = await notificationsFor(f.student);
      assert.equal(note.type, "badge.granted");
      assert.equal(
        note.body,
        "You now hold Laser Cutter Operation, valid until 1 May 2027.",
      );
      assert.equal(note.link, "/badges");
    });

    test("a badge with no validity never expires", async () => {
      await addBadges();
      const row = await request(f.student, gpu);
      const decided = await decide(f.cseManager, row, { decision: "approve" });
      assert.equal(decided.expiresAt, null);
      const [note] = await notificationsFor(f.student);
      assert.equal(note.body, "You now hold GPU Usage Policy.");
    });

    test("rejecting needs a reason, which the member sees", async () => {
      await addBadges();
      const row = await request(f.student, gpu);
      for (const reason of [undefined, "   "]) {
        const err = await failure(
          decide(f.cseManager, row, { decision: "reject", reason }),
        );
        assertError(err, 400, "VALIDATION_ERROR");
        assert.deepEqual(
          err.details.map((d) => d.path),
          ["reason"],
        );
      }
      const decided = await decide(f.cseManager, row, {
        decision: "reject",
        reason: "Attend the orientation first.",
      });
      assert.equal(decided.state, "rejected");
      assert.equal(decided.reason, "Attend the orientation first.");
      const [note] = await notificationsFor(f.student);
      assert.equal(
        note.body,
        "Your request for the GPU Usage Policy badge wasn't approved: Attend the orientation first.",
      );
    });

    test("a decided request is 409; bad decisions are 400", async () => {
      await addBadges();
      const row = await request(f.student, gpu);
      const bad = await failure(
        decide(f.cseManager, row, { decision: "maybe" }),
      );
      assert.deepEqual(
        bad.details.map((d) => d.path),
        ["decision"],
      );
      assert.deepEqual(
        (await failure(decide(f.cseManager, row, {}))).details.map(
          (d) => d.path,
        ),
        ["decision"],
      );
      await decide(f.cseManager, row, { decision: "approve" });
      const again = await failure(
        decide(f.cseManager, row, { decision: "reject", reason: "Oops" }),
      );
      assertError(again, 409, "INVALID_TRANSITION");
      assert.equal(again.message, "This badge has already been granted.");
      assert.equal((await rowOf(f.student, gpu)).status, "active");
    });

    test("only the issuing unit's managers or an admin decide; never on their own request", async () => {
      await addBadges();
      const row = await request(f.student, laser, { evidence: EVIDENCE });
      for (const who of [f.cseManager, f.student2]) {
        assertError(
          await failure(decide(who, row, { decision: "approve" })),
          403,
          "FORBIDDEN",
        );
      }

      // A DIC manager asks for a DIC badge: another DIC manager or an admin must decide.
      const own = await request(f.manager, laser, { evidence: EVIDENCE });
      // Told about the student's request, not about their own.
      assert.deepEqual(
        (await notificationsFor(f.manager)).map((n) => n.body),
        ["Ananya Rao requested the Laser Cutter Operation badge."],
      );
      const err = await failure(
        decide(f.manager, own, { decision: "approve" }),
      );
      assertError(err, 403, "FORBIDDEN");
      assert.match(err.message, /own badge request/);
      await decide(f.admin, own, { decision: "approve" });
      assert.equal((await rowOf(f.manager, laser)).status, "active");
      assert.equal((await audits("badge.granted"))[0].actor.role, "admin");

      for (const id of ["nope", new mongoose.Types.ObjectId()]) {
        assertError(
          await failure(
            decideBadgeRequest(f.manager._id, id, { decision: "approve" }),
          ),
          404,
          "NOT_FOUND",
        );
      }
    });
  });

  describe("grantBadge", () => {
    test("grants directly without a request, audited as direct", async () => {
      await addBadges();
      const row = await grant(f.manager, laser, f.student, {
        note: "Completed the induction on 1 Nov.",
      });
      assert.equal(row.state, "active");
      assert.equal(row.expiresAt, later(180).toISOString());
      assert.equal(row.user.name, "Ananya Rao");
      assert.equal(row.decidedBy.name, "Meera Iyer");

      const [entry] = await audits("badge.granted");
      assert.equal(entry.meta.direct, true);
      assert.equal(entry.reason, "Completed the induction on 1 Nov.");
      assert.deepEqual(entry.changes.status, [null, "active"]);
      assert.equal(
        (await notificationsFor(f.student))[0].type,
        "badge.granted",
      );
    });

    test("an open request is granted and leaves the queue, the member's note kept", async () => {
      await addBadges();
      const requested = await request(f.student, gpu, { note: "Please" });
      const row = await grant(f.cseManager, gpu, f.student);
      assert.equal(row._id, requested._id);
      assert.equal(row.note, "Please");
      assert.equal((await listBadgeRequests(f.cseManager._id)).meta.total, 0);
    });

    test("renews a held badge's expiry; a held badge that never expires is left alone", async () => {
      await addBadges();
      await grant(f.manager, laser, f.student);
      const renewed = await grant(f.manager, laser, f.student, {}, later(100));
      assert.equal(renewed.expiresAt, later(280).toISOString());
      const entries = await audits("badge.granted");
      assert.equal(entries.length, 2);
      assert.deepEqual(entries[1].changes.status, ["active", "active"]);

      // Seeded: student holds 3D Printing Basics with no expiry, and it has no validity.
      const same = await grant(f.manager, f.badge, f.student);
      assert.equal(same.state, "active");
      assert.equal((await audits("badge.granted")).length, 2);
      assert.equal((await notificationsFor(f.student)).length, 2);
    });

    test("refuses self-grants, other units' managers, unknown users and badges", async () => {
      await addBadges();
      const self = await failure(grant(f.manager, laser, f.manager));
      assertError(self, 403, "FORBIDDEN");
      assert.match(self.message, /to yourself/);
      await grant(f.admin, laser, f.admin); // an admin may

      assertError(
        await failure(grant(f.cseManager, laser, f.student)),
        403,
        "FORBIDDEN",
      );
      const unknown = await failure(
        grant(f.manager, laser, { _id: new mongoose.Types.ObjectId() }),
      );
      assertError(unknown, 400, "VALIDATION_ERROR");
      assert.deepEqual(unknown.details, [
        { path: "userId", message: "No such user." },
      ]);
      // Neither userId nor email: both say "Required.", so a form with either input marks it.
      const missing = await failure(
        grantBadge(f.manager._id, laser._id, { email: "  " }, { now: NOW }),
      );
      assert.deepEqual(missing.details, [
        { path: "userId", message: "Required." },
        { path: "email", message: "Required." },
      ]);
      assertError(
        await failure(
          grantBadge(f.manager._id, new mongoose.Types.ObjectId(), {
            userId: f.student._id,
          }),
        ),
        404,
        "NOT_FOUND",
      );
      assert.equal(await UserBadge.countDocuments({ badge: laser._id }), 1);
    });

    test("grants by email instead of userId: an exact match that ignores case", async () => {
      await addBadges();
      const byEmail = (who, email, extra = {}) =>
        grantBadge(who._id, laser._id, { email, ...extra }, { now: NOW });
      const row = await byEmail(
        f.manager,
        "  Student@DEMO.campuscommons.test ",
      );
      assert.deepEqual(
        [row.user._id, row.state],
        [String(f.student._id), "active"],
      );
      assert.equal(
        "email" in row.user,
        false,
        "the row never carries an email",
      );
      const [entry] = await audits("badge.granted");
      assert.equal(String(entry.meta.user), String(f.student._id));

      const cases = [
        [
          { email: "nobody@demo.campuscommons.test" },
          "No account has this email.",
        ],
        // A part of an address finds nothing: the match is exact, not a search.
        [{ email: "student2@demo" }, "No account has this email."],
        [{ email: 42 }, "Must be text."],
        [
          { email: `${"a".repeat(250)}@x.test` },
          "Can be at most 254 characters.",
        ],
        [
          { email: "student2@demo.campuscommons.test", userId: f.student2._id },
          "Send either userId or email, not both.",
        ],
      ];
      for (const [input, message] of cases) {
        const err = await failure(
          grantBadge(f.manager._id, laser._id, input, { now: NOW }),
        );
        assertError(err, 400, "VALIDATION_ERROR");
        assert.deepEqual(err.details, [{ path: "email", message }]);
      }
      // The same rules as by id: never to yourself, never for another unit's badge.
      assertError(
        await failure(byEmail(f.manager, "manager@demo.campuscommons.test")),
        403,
        "FORBIDDEN",
      );
      assertError(
        await failure(
          grantBadge(
            f.cseManager._id,
            laser._id,
            { email: "student2@demo.campuscommons.test" },
            { now: NOW },
          ),
        ),
        403,
        "FORBIDDEN",
      );
      assert.equal(await UserBadge.countDocuments({ badge: laser._id }), 1);
    });
  });

  // The fixtures' manager and admin are the public demo accounts: one click, no password, on the
  // same deployment where real members hold real badges.
  describe("demo accounts and real members", () => {
    const realPeople = async () => {
      await addBadges();
      const member = await User.create({
        name: "Rohan Mehta",
        email: "2024ugcs999@nitjsr.ac.in",
        passwordHash: "x".repeat(60),
        memberType: "ug",
        department: f.cse._id,
        verification: { status: "approved" },
      });
      const realManager = await User.create({
        name: "Priya Nair",
        email: "priya.nair@nitjsr.ac.in",
        passwordHash: "x".repeat(60),
        memberType: "faculty",
        roles: ["member", "manager"],
        managedOrgUnits: [f.dic._id],
        verification: { status: "approved" },
      });
      return { member, realManager };
    };

    test("a demo manager or admin can't grant to a real member, by email or by id: it reads as no such member", async () => {
      const { member, realManager } = await realPeople();
      for (const who of [f.manager, f.admin]) {
        const byEmail = await failure(
          grantBadge(
            who._id,
            laser._id,
            { email: "2024UGCS999@nitjsr.ac.in" },
            { now: NOW },
          ),
        );
        assertError(byEmail, 400, "VALIDATION_ERROR");
        assert.deepEqual(byEmail.details, [
          { path: "email", message: "No account has this email." },
        ]);
        const byId = await failure(grant(who, laser, member));
        assertError(byId, 400, "VALIDATION_ERROR");
        assert.deepEqual(byId.details, [
          { path: "userId", message: "No such user." },
        ]);
      }
      assert.equal(await UserBadge.countDocuments({ user: member._id }), 0);
      assert.equal((await audits("badge.granted")).length, 0);
      assert.equal((await notificationsFor(member)).length, 0);
      // A real manager of the unit can, and the demo accounts still grant to each other.
      const row = await grantBadge(
        realManager._id,
        laser._id,
        { email: member.email },
        { now: NOW },
      );
      assert.equal(row.state, "active");
      assert.equal((await grant(f.manager, laser, f.student)).state, "active");
    });

    test("a demo manager or admin never sees or decides a real member's request", async () => {
      const { member, realManager } = await realPeople();
      const real = await request(member, f.badge, { note: "Inducted" });
      const demo = await request(f.student, laser, { evidence: EVIDENCE });
      for (const who of [f.manager, f.admin]) {
        const { items, meta } = await listBadgeRequests(who._id);
        assert.deepEqual(
          items.map((r) => r._id),
          [demo._id],
        );
        assert.equal(meta.total, 1);
        const err = await failure(decide(who, real, { decision: "approve" }));
        assertError(err, 404, "NOT_FOUND");
        assert.equal(err.message, "Badge request not found.");
      }
      assert.equal((await rowOf(member, f.badge)).status, "requested");
      assert.equal((await audits("badge.granted")).length, 0);
      // The unit's real manager sees both and decides the real one.
      assert.equal((await listBadgeRequests(realManager._id)).meta.total, 2);
      const decided = await decide(realManager, real, { decision: "approve" });
      assert.equal(decided.state, "active");
    });
  });

  describe("getEvidenceUrl", () => {
    let fake;
    beforeEach(() => {
      fake = {
        signed: [],
        async signedUrl(publicId, { type, expiresAt }) {
          fake.signed.push({ publicId, type });
          return `https://api.cloudinary.com/v1_1/test/image/download?public_id=${encodeURIComponent(publicId)}&expires_at=${Math.floor(expiresAt.getTime() / 1000)}`;
        },
        async destroy() {
          return { deleted: true };
        },
      };
      useUploader(fake);
    });
    afterEach(() => useUploader(null));

    const open = (who, row) =>
      getEvidenceUrl(who._id, row._id, { now: NOW, requestId: "req-ev" });

    test("the issuing unit's managers, admins and the member who sent it get a 5-minute link; each is audited", async () => {
      await addBadges();
      const row = await request(f.student, laser, { evidence: EVIDENCE });

      const link = await open(f.manager, row);
      assert.deepEqual(Object.keys(link).sort(), ["expiresAt", "url"]);
      assert.equal(link.expiresAt.getTime(), NOW.getTime() + 5 * 60_000);
      assert.deepEqual(fake.signed, [
        { publicId: EVIDENCE.publicId, type: "authenticated" },
      ]);
      await open(f.student, row);
      await open(f.admin, row);

      const views = await audits("badge.evidence_viewed");
      assert.deepEqual(
        views.map((v) => [String(v.actor.id), v.actor.role]),
        [
          [String(f.manager._id), "manager"],
          [String(f.student._id), "member"],
          [String(f.admin._id), "admin"],
        ],
      );
      for (const view of views) {
        assert.deepEqual(view.entity, {
          type: "user_badge",
          id: new mongoose.Types.ObjectId(row._id),
        });
        assert.equal(String(view.orgUnit), String(f.dic._id));
        assert.equal(String(view.meta.user), String(f.student._id));
        assert.equal(String(view.meta.badge), String(laser._id));
        assert.equal(view.requestId, "req-ev");
      }
    });

    test("anyone else is refused, and no link or audit entry is made", async () => {
      await addBadges();
      const row = await request(f.student, laser, { evidence: EVIDENCE });
      for (const who of [f.cseManager, f.student2]) {
        const err = await failure(open(who, row));
        assertError(err, 403, "FORBIDDEN");
        assert.equal(
          err.message,
          "Only the issuing unit's managers or the member who sent it can open this evidence.",
        );
      }
      // A manager role without the unit, or the unit without the role, isn't enough.
      await User.updateOne(
        { _id: f.student2._id },
        { managedOrgUnits: [f.dic._id] },
      );
      assertError(await failure(open(f.student2, row)), 403, "FORBIDDEN");
      assert.equal(fake.signed.length, 0);
      assert.equal((await audits("badge.evidence_viewed")).length, 0);
    });

    test("a demo account never opens a real member's evidence; a real admin and the member do", async () => {
      await addBadges();
      const member = await User.create({
        name: "Rohan Mehta",
        email: "2024ugcs999@nitjsr.ac.in",
        passwordHash: "x".repeat(60),
        memberType: "ug",
        department: f.cse._id,
        verification: { status: "approved" },
      });
      const realAdmin = await User.create({
        name: "Priya Nair",
        email: "priya.nair@nitjsr.ac.in",
        passwordHash: "x".repeat(60),
        roles: ["admin"],
        verification: { status: "approved" },
      });
      const row = await request(member, laser, { evidence: EVIDENCE });
      // The fixtures' manager and admin are the public demo accounts.
      for (const who of [f.manager, f.admin]) {
        const err = await failure(open(who, row));
        assertError(err, 404, "NOT_FOUND");
        assert.equal(err.message, "Badge request not found.");
      }
      assert.equal(fake.signed.length, 0);
      assert.ok(await open(realAdmin, row));
      assert.ok(await open(member, row));
      assert.equal((await audits("badge.evidence_viewed")).length, 2);
    });

    test("no evidence, a file Cloudinary no longer has, and unknown ids are 404s; no Cloudinary is 503", async () => {
      await addBadges();
      const plainRow = await request(f.student, gpu, { note: "No file" });
      const none = await failure(open(f.cseManager, plainRow));
      assertError(none, 404, "NOT_FOUND");
      assert.equal(none.message, "Evidence not found.");

      const row = await request(f.student, laser, { evidence: EVIDENCE });
      fake.signedUrl = async () => null;
      assert.equal(
        (await failure(open(f.manager, row))).message,
        "Evidence not found.",
      );
      for (const id of [
        "not-an-id",
        new mongoose.Types.ObjectId(),
        { $ne: null },
      ]) {
        const err = await failure(
          getEvidenceUrl(f.manager._id, id, { now: NOW }),
        );
        assert.deepEqual(
          [err.status, err.message],
          [404, "Badge request not found."],
        );
      }
      useUploader(null);
      const saved = process.env.CLOUDINARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_CLOUD_NAME;
      try {
        assertError(
          await failure(open(f.manager, row)),
          503,
          "SERVICE_UNAVAILABLE",
        );
      } finally {
        if (saved !== undefined) process.env.CLOUDINARY_CLOUD_NAME = saved;
      }
      assert.equal((await audits("badge.evidence_viewed")).length, 0);
    });
  });

  test("golden path: missing badge → request → approve → the checklist passes and the booking goes in", async () => {
    await UserBadge.deleteOne({ user: f.student._id, badge: f.badge._id });
    const opts = { now: NOW };

    let rule = badgeRule(
      await getEligibility(f.student._id, f.printer._id, {}, opts),
    );
    assert.equal(rule.passed, false);
    assert.equal(rule.message, "Missing badge: 3D Printing Basics.");
    assertError(
      await failure(bookAs(f.student, f.printer, TUE)),
      422,
      "INELIGIBLE",
    );

    const requested = await request(f.student, f.badge);
    rule = badgeRule(
      await getEligibility(f.student._id, f.printer._id, {}, opts),
    );
    assert.equal(
      rule.message,
      "Your 3D Printing Basics badge request is awaiting review.",
    );

    const [queued] = (await listBadgeRequests(f.manager._id)).items;
    assert.equal(queued._id, requested._id);
    await decide(f.manager, queued, { decision: "approve" });

    rule = badgeRule(
      await getEligibility(f.student._id, f.printer._id, {}, opts),
    );
    assert.equal(rule.passed, true);
    const booking = await bookAs(f.student, f.printer, TUE);
    assert.equal(booking.booking.status, "pending");
  });
});
