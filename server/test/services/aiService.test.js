// Whose quota an AI request spends (src/services/aiService.js): a real member's own; a demo account's
// per network, so judges on one demo account don't use up each other's AI requests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiSubject } from "../../src/services/aiService.js";

test("a real member's AI quota is theirs alone, wherever they call from", () => {
  const member = { _id: "64a0000000000000000000aa", email: "2025ugcs070@nitjsr.ac.in" };
  assert.equal(aiSubject(member, "203.0.113.7"), "64a0000000000000000000aa");
  assert.equal(aiSubject(member, null), "64a0000000000000000000aa");
});

test("a demo account's AI quota is kept per network", () => {
  const demo = { _id: "64a0000000000000000000bb", email: "student@demo.campuscommons.test" };
  assert.equal(aiSubject(demo, "203.0.113.7"), "64a0000000000000000000bb@203.0.113.7");
  assert.notEqual(aiSubject(demo, "198.51.100.2"), aiSubject(demo, "203.0.113.7"));
  // No address (a closed connection): the account's own counter, never a shared empty one.
  assert.equal(aiSubject(demo, null), "64a0000000000000000000bb");
});
