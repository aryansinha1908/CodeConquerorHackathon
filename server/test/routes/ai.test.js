// /api/v1/ai over HTTP: the quota meter. A real MongoDB through fixtures.js (skipped without
// TEST_MONGODB_URI) and ioredis-mock.
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import logger from "../../src/lib/logger.js";
import { reserveAiQuota } from "../../src/services/aiQuotaService.js";
import { aiSubject } from "../../src/services/aiService.js";
import { skip, useTestDatabase } from "../integration/fixtures.js";
import { useApi } from "./http.js";

logger.level = "silent";

let f;

describe("/api/v1/ai", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const api = useApi();

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  test("GET /ai/quota: the signed-in user's AI requests left today, and whether AI is set up", async () => {
    const fresh = await api.call("GET", "/ai/quota", { user: f.student });
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assert.equal(fresh.body.data.used, 0);
    assert.equal(fresh.body.data.remaining, fresh.body.data.limit);
    assert.equal(fresh.body.data.configured, false);
    assert.ok(Date.parse(fresh.body.data.resetsAt));

    // The fixture users are demo accounts: their quota is kept per network (127.0.0.1 here).
    await reserveAiQuota(aiSubject(f.student, "127.0.0.1"));
    process.env.GEMINI_API_KEY = "set";
    const after = await api.call("GET", "/ai/quota", { user: f.student });
    assert.equal(after.body.data.used, 1);
    assert.equal(after.body.data.configured, true);
    // Another demo account's meter is untouched.
    const other = await api.call("GET", "/ai/quota", { user: f.student2 });
    assert.equal(other.body.data.used, 0);
  });

  test("GET /ai/quota needs a signed-in user", async () => {
    const res = await api.call("GET", "/ai/quota");
    assert.equal(res.status, 401);
  });
});
