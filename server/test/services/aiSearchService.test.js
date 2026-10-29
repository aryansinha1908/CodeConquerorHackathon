// AI search's pure parts (src/services/aiSearchService.js): reading the model's answer safely.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseQuery, readMatches } from "../../src/services/aiSearchService.js";

const items = [{ _id: "r1" }, { _id: "r2" }, { _id: "r3" }];

test("readMatches keeps catalogue numbers only, in order, once each, with tidy reasons", () => {
  const answer = {
    matches: [
      { index: 2, reason: "Prints  in\nPLA\u0007 and PETG." },
      { index: 0, reason: "out of range (catalogue numbers start at 1)" },
      { index: 9, reason: "out of range" },
      { index: 2, reason: "a repeat" },
      { index: "3", reason: "" },
      { index: 1.5, reason: "not a whole number" },
      null,
    ],
  };
  assert.deepEqual(readMatches(answer, items), [
    { id: "r2", reason: "Prints in PLA and PETG." },
    { id: "r3", reason: "Matches your request." },
  ]);
  assert.deepEqual(readMatches({ matches: "nope" }, items), []);
  assert.deepEqual(readMatches(null, items), []);
});

test("readMatches caps the matches at six and the reason at 160 characters", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ _id: `r${i}` }));
  const answer = { matches: many.map((_, i) => ({ index: i + 1, reason: "x".repeat(400) })) };
  const out = readMatches(answer, many);
  assert.equal(out.length, 6);
  assert.ok(out.every((m) => m.reason.length <= 160 && m.reason.endsWith("…")));
});

test("normaliseQuery makes the same question the same cache key", () => {
  assert.equal(normaliseQuery("  Something to PRINT  a phone case "), "something to print a phone case");
  assert.equal(normaliseQuery(undefined), "");
});
