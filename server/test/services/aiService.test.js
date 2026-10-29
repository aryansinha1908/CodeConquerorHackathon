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

test("redactPersonal takes emails, roll numbers and phone numbers out, and leaves sizes, times and rooms", async () => {
  const { redactPersonal } = await import("../../src/services/aiService.js");
  assert.equal(
    redactPersonal("Ask Mr. Pal (+91 98765 43210, s.pal@nitjsr.ac.in) or 2025UGCS070; 98765-43210 too."),
    "Ask Mr. Pal ([phone], [email]) or [roll number]; [phone] too.",
  );
  for (const plain of ["250 × 210 × 220 mm build volume", "Open 09:00–17:00", "Room 2025, floor 2", "1600 W, 230 V", "ISBN 978 0 13"]) {
    assert.equal(redactPersonal(plain), plain);
  }
});

test("hasContactDetails spots links, emails and phone numbers in model text", async () => {
  const { hasContactDetails } = await import("../../src/services/aiService.js");
  for (const bad of ["Book at https://evil.example/login", "see www.example.org", "mail desk@lab.in", "call 9876543210", "go to campus-deals.xyz"]) {
    assert.equal(hasContactDetails(bad), true, bad);
  }
  for (const fine of ["Prints PLA and PETG up to 250 mm.", "A quiet room for 6 people.", "Opens at 09:00, Mon–Sat."]) {
    assert.equal(hasContactDetails(fine), false, fine);
  }
});
