// `npm run grant-admin` (scripts/grant-admin.js): who can be made an admin, the audit entry, revoking,
// and that a second run changes nothing. Runs against a real MongoDB (TEST_MONGODB_URI), like the other
// integration suites; skipped without it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { AuditLog, User } from "../../src/models/index.js";
import { grantAdmin } from "../../scripts/grant-admin.js";
import { skip, useTestDatabase } from "./fixtures.js";

const member = (overrides = {}) =>
  User.create({
    name: "Aryan Sinha",
    email: "2025ugcs070@nitjsr.ac.in",
    passwordHash: "x".repeat(60),
    emailVerified: true,
    ...overrides,
  });

describe("grantAdmin", { skip }, () => {
  useTestDatabase(() => {});

  test("makes a verified real member an admin, audited, and a second run changes nothing", async () => {
    const user = await member();
    const first = await grantAdmin({ email: " 2025UGCS070@nitjsr.ac.in " });
    assert.equal(first.changed, true);
    assert.deepEqual((await User.findById(user._id).lean()).roles, ["member", "admin"]);
    const [entry] = await AuditLog.find({ action: "user.roles_changed" }).lean();
    assert.equal(String(entry.entity.id), String(user._id));
    assert.equal(entry.actor.role, "system");
    assert.deepEqual(entry.changes.roles, [["member"], ["member", "admin"]]);

    const again = await grantAdmin({ email: user.email });
    assert.equal(again.changed, false);
    assert.equal(await AuditLog.countDocuments({ action: "user.roles_changed" }), 1);

    const revoked = await grantAdmin({ email: user.email, revoke: true });
    assert.equal(revoked.changed, true);
    assert.deepEqual((await User.findById(user._id).lean()).roles, ["member"]);
  });

  test("refuses demo accounts, unknown emails and accounts that haven't verified their email", async () => {
    await member({ email: "2025ugcs42@nitjsr.ac.in", emailVerified: false });
    await assert.rejects(grantAdmin({ email: "admin@demo.campuscommons.test" }), /demo account/);
    await assert.rejects(grantAdmin({ email: "nobody@nitjsr.ac.in" }), /No account has the email/);
    await assert.rejects(grantAdmin({ email: "2025ugcs42@nitjsr.ac.in" }), /hasn't verified its email/);
    await assert.rejects(grantAdmin({ email: "" }), /email address/);
    assert.equal(await AuditLog.countDocuments({ action: "user.roles_changed" }), 0);
  });
});
