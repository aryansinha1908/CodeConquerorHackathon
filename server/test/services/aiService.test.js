// Whose quota an AI request spends (src/services/aiService.js): a real member's own; a demo account's
// per visitor, inside the pool every demo account shares.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiQuotaFor } from "../../src/services/aiService.js";

test("a real member's AI quota is theirs alone, wherever they call from, and in no pool", () => {
  const member = { _id: "64a0000000000000000000aa", email: "2025ugcs070@nitjsr.ac.in" };
  assert.deepEqual(aiQuotaFor(member, "203.0.113.7"), { userId: "64a0000000000000000000aa", pool: null });
  assert.deepEqual(aiQuotaFor(member, null), { userId: "64a0000000000000000000aa", pool: null });
});

test("a demo account's AI quota is kept per visitor, inside the shared demo pool", () => {
  const demo = { _id: "64a0000000000000000000bb", email: "student@demo.campuscommons.test" };
  assert.deepEqual(aiQuotaFor(demo, "203.0.113.7"), { userId: "64a0000000000000000000bb@203.0.113.7", pool: "demo" });
  assert.notEqual(aiQuotaFor(demo, "198.51.100.2").userId, aiQuotaFor(demo, "203.0.113.7").userId);
  // No address (a closed connection): the account's own counter, still in the pool.
  assert.deepEqual(aiQuotaFor(demo, null), { userId: "64a0000000000000000000bb", pool: "demo" });
});
