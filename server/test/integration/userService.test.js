// User service against a real MongoDB; see fixtures.js for how to run it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { User } from "../../src/models/index.js";
import { listUsers } from "../../src/services/userService.js";
import { failure, skip, useTestDatabase } from "./fixtures.js";

let f; // fixtures, rebuilt for every test
// A real admin. The fixtures' users, their admin included, are all on the public demo domain.
let admin;
let real;

const emails = (result) => result.items.map((u) => u.email);

// Real accounts on the college domain, created after the fixtures, so they are the newest.
async function realAccounts() {
  admin = await User.create({
    name: "Priya Nair",
    email: "priya.nair@nitjsr.ac.in",
    passwordHash: "x".repeat(60),
    roles: ["admin"],
    memberType: "staff",
    emailVerified: true,
    verification: { status: "approved" },
  });
  real = await User.create({
    name: "Rohan Mehta",
    email: "2024ugcs999@nitjsr.ac.in",
    passwordHash: "x".repeat(60),
    emailVerified: true,
    memberType: "ug",
    department: f.cse._id,
    verification: {
      status: "pending",
      idCardPublicId: "campuscommons/id-cards/x",
    },
  });
  // Created before the field existed: no verification status at all.
  await User.collection.updateOne(
    { _id: real._id },
    { $unset: { "verification.status": "" } },
  );
}

describe("userService", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  test("an admin lists everyone, newest first, with what the manager picker needs and no ID-card data", async () => {
    await realAccounts();
    const result = await listUsers(admin._id);
    assert.deepEqual(result.meta, { page: 1, limit: 20, total: 8 });
    assert.deepEqual(emails(result).slice(0, 2), [
      "2024ugcs999@nitjsr.ac.in",
      "priya.nair@nitjsr.ac.in",
    ]);
    const [row] = result.items;
    assert.deepEqual(row, {
      _id: String(real._id),
      name: "Rohan Mehta",
      email: "2024ugcs999@nitjsr.ac.in",
      roles: ["member"],
      memberType: "ug",
      department: {
        _id: String(f.cse._id),
        code: "cse",
        name: "Computer Science and Engineering",
      },
      verification: { status: "unsubmitted" },
      managedOrgUnits: [],
      suspendedUntil: null,
    });
    const manager = result.items.find((u) => u.email.startsWith("manager@"));
    assert.deepEqual(
      [manager.roles, manager.managedOrgUnits, manager.verification.status],
      [["member", "manager"], [String(f.dic._id)], "approved"],
    );
    assert.equal(JSON.stringify(result).includes("id-cards"), false);
  });

  test("q matches name or email, ignoring case, as plain text", async () => {
    await realAccounts();
    const search = async (q) => emails(await listUsers(admin._id, { q }));
    assert.deepEqual(await search("ANANYA"), [
      "student@demo.campuscommons.test",
    ]);
    assert.deepEqual(await search("UGCS999"), ["2024ugcs999@nitjsr.ac.in"]);
    assert.deepEqual(await search("  rao "), [
      "student@demo.campuscommons.test",
    ]);
    // Pattern characters are text: "." isn't "any character", and nothing here is a regex.
    assert.deepEqual(await search("priya.nair"), ["priya.nair@nitjsr.ac.in"]);
    assert.deepEqual(await search("priya.nai."), []);
    assert.deepEqual(await search("(a+)+$"), []);
    assert.deepEqual(await search(".*"), []);
  });

  test("filters by role and verification status; an unset status counts as unsubmitted", async () => {
    await realAccounts();
    await User.updateOne(
      { _id: f.student2._id },
      { "verification.status": "rejected" },
    );
    assert.deepEqual(emails(await listUsers(admin._id, { role: "admin" })), [
      "priya.nair@nitjsr.ac.in",
      "admin@demo.campuscommons.test",
    ]);
    assert.equal(
      (await listUsers(admin._id, { role: "manager" })).meta.total,
      2,
    );
    assert.deepEqual(
      emails(await listUsers(admin._id, { verification: "unsubmitted" })),
      ["2024ugcs999@nitjsr.ac.in"],
    );
    assert.deepEqual(
      emails(await listUsers(admin._id, { verification: "rejected" })),
      ["student2@demo.campuscommons.test"],
    );
    assert.deepEqual(
      emails(
        await listUsers(admin._id, {
          q: "nitjsr",
          role: "member",
          verification: "unsubmitted",
        }),
      ),
      ["2024ugcs999@nitjsr.ac.in"],
    );
  });

  test("pages, and caps the limit at 50", async () => {
    await realAccounts();
    const second = await listUsers(admin._id, { page: 2, limit: 3 });
    assert.deepEqual(second.meta, { page: 2, limit: 3, total: 8 });
    assert.equal(second.items.length, 3);
    const first = await listUsers(admin._id, { limit: 3 });
    assert.equal(
      new Set([...emails(first), ...emails(second)]).size,
      6,
      "no overlap between pages",
    );
    assert.equal((await listUsers(admin._id, { limit: 500 })).meta.limit, 50);
  });

  test("the public demo admin sees demo accounts only, whatever it searches for", async () => {
    await realAccounts();
    const all = await listUsers(f.admin._id);
    assert.equal(all.meta.total, 6);
    assert.ok(
      all.items.every((u) => u.email.endsWith("@demo.campuscommons.test")),
    );
    for (const q of ["nitjsr", "priya", "rohan"])
      assert.equal((await listUsers(f.admin._id, { q })).meta.total, 0, q);
    assert.deepEqual(emails(await listUsers(f.admin._id, { role: "admin" })), [
      "admin@demo.campuscommons.test",
    ]);
  });

  test("admins only; bad values are 400 with every problem listed", async () => {
    await realAccounts();
    for (const who of [f.student, f.manager]) {
      const err = await failure(listUsers(who._id));
      assert.deepEqual(
        [err.status, err.code, err.message],
        [403, "FORBIDDEN", "Only an admin can list users."],
      );
    }
    assert.equal(
      (await failure(listUsers(new mongoose.Types.ObjectId()))).code,
      "NOT_FOUND",
    );
    const err = await failure(
      listUsers(admin._id, {
        q: "x".repeat(101),
        role: "owner",
        verification: ["pending", "approved"],
        page: 0,
      }),
    );
    assert.equal(err.code, "VALIDATION_ERROR");
    assert.deepEqual(err.details, [
      { path: "q", message: "Can be at most 100 characters." },
      { path: "role", message: "Must be one of: member, manager, admin." },
      {
        path: "verification",
        message: "Must be one of: unsubmitted, pending, approved, rejected.",
      },
      { path: "page", message: "Must be a whole number from 1 to 10000." },
    ]);
    assert.deepEqual(
      (await failure(listUsers(admin._id, { q: { $ne: null } }))).details,
      [{ path: "q", message: "Must be text." }],
    );
  });
});
