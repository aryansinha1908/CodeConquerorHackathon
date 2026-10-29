// /api/v1/ai over HTTP: the quota meter. A real MongoDB through fixtures.js (skipped without
// TEST_MONGODB_URI) and ioredis-mock.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import logger from "../../src/lib/logger.js";
import { User } from "../../src/models/index.js";
import { reserveAiQuota } from "../../src/services/aiQuotaService.js";
import { aiQuotaFor } from "../../src/services/aiService.js";
import { skip, useTestDatabase } from "../integration/fixtures.js";
import { useApi } from "./http.js";

logger.level = "silent";

let f;

describe("/api/v1/ai", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const api = useApi();

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    process.env.AI_USER_DAILY_LIMIT = "5";
    process.env.AI_DEMO_DAILY_LIMIT = "30";
  });

  test("GET /ai/quota: the signed-in user's AI requests left today, and whether AI is set up", async () => {
    const fresh = await api.call("GET", "/ai/quota", { user: f.student });
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assert.equal(fresh.body.data.used, 0);
    assert.equal(fresh.body.data.remaining, 5);
    assert.equal(fresh.body.data.configured, false);
    assert.ok(Date.parse(fresh.body.data.resetsAt));

    process.env.GEMINI_API_KEY = "set";
    const configured = await api.call("GET", "/ai/quota", { user: f.student });
    assert.equal(configured.body.data.configured, true);
  });

  test("a demo account's meter is per visitor address: another address on the same account has its own count", async () => {
    // The app trusts one proxy hop in tests, so X-Forwarded-For names the visitor.
    await reserveAiQuota(aiQuotaFor(f.student, "203.0.113.7").userId, undefined, { pool: "demo" });
    const here = await api.call("GET", "/ai/quota", { user: f.student, headers: { "x-forwarded-for": "203.0.113.7" } });
    assert.equal(here.body.data.used, 1);
    const elsewhere = await api.call("GET", "/ai/quota", { user: f.student, headers: { "x-forwarded-for": "198.51.100.2" } });
    assert.equal(elsewhere.body.data.used, 0);
    // ...but both draw on the demo pool, which the meter takes into account.
    process.env.AI_DEMO_DAILY_LIMIT = "1";
    const capped = await api.call("GET", "/ai/quota", { user: f.student, headers: { "x-forwarded-for": "198.51.100.2" } });
    assert.equal(capped.body.data.remaining, 0);
  });

  test("a real member's meter is theirs, whatever address they call from, and outside the demo pool", async () => {
    const member = await User.create({
      name: "Aryan Sinha",
      email: "2025ugcs070@nitjsr.ac.in",
      passwordHash: "x".repeat(60),
      emailVerified: true,
    });
    process.env.AI_DEMO_DAILY_LIMIT = "0";
    await reserveAiQuota(String(member._id));
    for (const address of ["203.0.113.7", "198.51.100.2"]) {
      const res = await api.call("GET", "/ai/quota", { user: member, headers: { "x-forwarded-for": address } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.used, 1);
      assert.equal(res.body.data.remaining, 4, "the empty demo pool doesn't touch real members");
    }
  });

  test("GET /ai/quota needs a signed-in user", async () => {
    const res = await api.call("GET", "/ai/quota");
    assert.equal(res.status, 401);
  });
});
