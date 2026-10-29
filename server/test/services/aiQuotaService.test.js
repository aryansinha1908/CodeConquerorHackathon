import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import RedisMock from "ioredis-mock";
import { setRedisLogger, useRedisClient } from "../../src/config/redis.js";
import { keys } from "../../src/lib/redisKeys.js";
import {
  AiQuotaError,
  AiUnavailableError,
  getAiQuota,
  isAiCircuitOpen,
  reserveAiQuota,
  withAiQuota,
} from "../../src/services/aiQuotaService.js";

const warnings = [];
setRedisLogger({
  info() {},
  warn: (...args) => warnings.push(args),
  error() {},
});

const redis = new RedisMock();
const ist = (s) => new Date(`${s}:00+05:30`);
const NOW = ist("2026-11-03T22:00"); // Tuesday evening, IST

const unreachable = () => {
  const fail = async () => {
    throw new Error(
      "Stream isn't writeable and enableOfflineQueue options is false",
    );
  };
  return {
    defineCommand(name) {
      this[name] = fail;
    },
    get: fail,
    set: fail,
    exists: fail,
  };
};

const setLimits = ({ burst = 0, user = 5, demo = 30, rpm = 100, global = 1000 } = {}) => {
  process.env.AI_USER_BURST_SECONDS = String(burst);
  process.env.AI_USER_DAILY_LIMIT = String(user);
  process.env.AI_DEMO_DAILY_LIMIT = String(demo);
  process.env.AI_GLOBAL_RPM = String(rpm);
  process.env.AI_GLOBAL_DAILY_LIMIT = String(global);
};

const denied = (promise) =>
  promise.then(
    () => assert.fail("expected the quota to deny this request"),
    (err) => err,
  );

beforeEach(async () => {
  useRedisClient(redis);
  await redis.flushall();
  warnings.length = 0;
  setLimits();
});

describe("reserveAiQuota", () => {
  test("allows the daily limit, then 429 until IST midnight", async () => {
    setLimits({ user: 3 });
    for (let used = 1; used <= 3; used++) {
      const { quota } = await reserveAiQuota("u1", NOW);
      assert.deepEqual(quota, {
        used,
        limit: 3,
        remaining: 3 - used,
        resetsAt: ist("2026-11-04T00:00").toISOString(),
      });
    }
    const err = await denied(reserveAiQuota("u1", NOW));
    assert.ok(err instanceof AiQuotaError);
    assert.equal(err.status, 429);
    assert.equal(err.code, "AI_QUOTA_EXCEEDED");
    assert.equal(
      err.message,
      "You've used all 3 of today's AI requests. Regular search still works, and AI resets at midnight.",
    );
    assert.deepEqual(err.details, {
      reason: "USER_DAILY",
      limit: 3,
      resetsAt: ist("2026-11-04T00:00").toISOString(),
      retryAfterSeconds: 7200,
    });
    assert.deepEqual(err.headers, { "Retry-After": "7200" });
  });

  test("counters use the documented keys, IST stamps and TTLs", async () => {
    await reserveAiQuota("u1", NOW);
    assert.equal(await redis.get(keys.aiUserDay("u1", "20261103")), "1");
    assert.equal(await redis.get("ai:{q}:global:20261103"), "1");
    assert.equal(await redis.get("ai:{q}:rpm:202611032200"), "1");
    assert.ok((await redis.ttl("ai:{q}:user:u1:20261103")) > 47 * 3600);
    assert.ok((await redis.ttl("ai:{q}:rpm:202611032200")) <= 120);
  });

  test("a new IST day starts a new count (00:30 IST is still the previous UTC day)", async () => {
    setLimits({ user: 1 });
    await reserveAiQuota("u1", ist("2026-11-03T23:59"));
    await denied(reserveAiQuota("u1", ist("2026-11-03T23:59")));
    const { quota } = await reserveAiQuota(
      "u1",
      new Date("2026-11-03T19:00:00Z"),
    ); // 00:30 IST, 4 Nov
    assert.equal(quota.used, 1);
    assert.equal(await redis.get("ai:{q}:user:u1:20261104"), "1");
  });

  test("burst: one request per user every N seconds", async () => {
    setLimits({ burst: 10 });
    await reserveAiQuota("u1", NOW);
    const err = await denied(reserveAiQuota("u1", NOW));
    assert.equal(err.details.reason, "BURST");
    assert.equal(err.message, "Please wait 10 seconds between AI requests.");
    assert.ok(
      err.details.retryAfterSeconds >= 9 && err.details.retryAfterSeconds <= 10,
    );
    await reserveAiQuota("u2", NOW); // other users are unaffected
  });

  test("global per-minute cap across users, reset on the next minute", async () => {
    setLimits({ rpm: 3 });
    for (const user of ["u1", "u2", "u3"]) await reserveAiQuota(user, NOW);
    const err = await denied(reserveAiQuota("u4", NOW));
    assert.equal(err.details.reason, "GLOBAL_MINUTE");
    assert.equal(err.details.retryAfterSeconds, 60);
    await reserveAiQuota("u4", new Date(NOW.getTime() + 60_000));
  });

  test("global daily cap protects the project's free-tier quota", async () => {
    setLimits({ global: 2 });
    await reserveAiQuota("u1", NOW);
    await reserveAiQuota("u2", NOW);
    const err = await denied(reserveAiQuota("u3", NOW));
    assert.equal(err.details.reason, "GLOBAL_DAILY");
    assert.match(err.message, /whole campus/);
  });

  test("a denied request spends nothing", async () => {
    setLimits({ user: 1 });
    await reserveAiQuota("u1", NOW);
    await denied(reserveAiQuota("u1", NOW));
    await denied(reserveAiQuota("u1", NOW));
    assert.equal(await redis.get("ai:{q}:user:u1:20261103"), "1");
    assert.equal(await redis.get("ai:{q}:global:20261103"), "1");
  });

  test("check and increment are atomic: 20 parallel requests, exactly 5 allowed", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => reserveAiQuota("u1", NOW)),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
    assert.equal(await redis.get("ai:{q}:user:u1:20261103"), "5");
  });

  test("refund gives back one request, once, and never goes below zero", async () => {
    const first = await reserveAiQuota("u1", NOW);
    await reserveAiQuota("u1", NOW);
    await first.refund();
    await first.refund();
    assert.equal(await redis.get("ai:{q}:user:u1:20261103"), "1");
    assert.equal(
      await redis.get("ai:{q}:global:20261103"),
      "2",
      "global stays spent",
    );
    await redis.set("ai:{q}:user:u1:20261103", "0");
    const second = await reserveAiQuota("u1", NOW);
    await redis.set("ai:{q}:user:u1:20261103", "0");
    await second.refund();
    assert.equal(await redis.get("ai:{q}:user:u1:20261103"), "0");
  });

  test("limits are read from env on every call", async () => {
    setLimits({ user: 1 });
    await reserveAiQuota("u1", NOW);
    await denied(reserveAiQuota("u1", NOW));
    setLimits({ user: 2 });
    await reserveAiQuota("u1", NOW);
  });

  test("fails closed when Redis is unreachable", async () => {
    useRedisClient(unreachable());
    const err = await denied(reserveAiQuota("u1", NOW));
    assert.ok(err instanceof AiUnavailableError);
    assert.equal(err.status, 503);
    assert.equal(err.code, "AI_UNAVAILABLE");
    assert.equal(warnings.length, 1);
  });
});

describe("getAiQuota", () => {
  test("reports what is left today for the UI meter", async () => {
    await reserveAiQuota("u1", NOW);
    await reserveAiQuota("u1", NOW);
    assert.deepEqual(await getAiQuota("u1", NOW), {
      used: 2,
      limit: 5,
      remaining: 3,
      resetsAt: ist("2026-11-04T00:00").toISOString(),
    });
    assert.equal((await getAiQuota("u2", NOW)).remaining, 5);
  });
});

describe("the demo pool", () => {
  test("demo visitors each have their own counter, but all of them together stop at the pool's limit", async () => {
    setLimits({ user: 5, demo: 3 });
    // Three visitors (or one forging a new X-Forwarded-For each time) on the demo accounts.
    const first = await reserveAiQuota("demo@203.0.113.1", NOW, { pool: "demo" });
    assert.equal(first.quota.remaining, 2, "the pool has 2 left, fewer than the visitor's own 4");
    await reserveAiQuota("demo@203.0.113.2", NOW, { pool: "demo" });
    await reserveAiQuota("other-demo@203.0.113.3", NOW, { pool: "demo" });
    const err = await denied(reserveAiQuota("demo@203.0.113.4", NOW, { pool: "demo" }));
    assert.equal(err.details.reason, "POOL_DAILY");
    assert.equal(err.details.limit, 3);
    assert.match(err.message, /demo accounts have used today's AI requests/);
    assert.equal(await redis.get(keys.aiPoolDay("demo", "20261103")), "3");
    // A real member isn't in the pool: their requests still go through.
    const real = await reserveAiQuota("member-1", NOW);
    assert.equal(real.quota.remaining, 4);
  });

  test("the meter caps remaining by what the pool has left, and a refund gives the pool its request back", async () => {
    setLimits({ user: 5, demo: 2 });
    const reservation = await reserveAiQuota("demo@203.0.113.1", NOW, { pool: "demo" });
    await reserveAiQuota("demo@203.0.113.2", NOW, { pool: "demo" });
    assert.equal((await getAiQuota("demo@203.0.113.9", NOW, { pool: "demo" })).remaining, 0);
    await reservation.refund();
    assert.equal(await redis.get(keys.aiPoolDay("demo", "20261103")), "1");
    assert.equal((await getAiQuota("demo@203.0.113.9", NOW, { pool: "demo" })).remaining, 1);
    // Outside the pool the meter is the member's own count only.
    assert.equal((await getAiQuota("member-1", NOW)).remaining, 5);
  });
});

describe("withAiQuota", () => {
  const gemini = (result) => {
    const call = async () => {
      call.calls++;
      return result;
    };
    call.calls = 0;
    return call;
  };
  const search = (input, call) =>
    withAiQuota({ userId: "u1", feature: "search", input, call, now: NOW });

  test("an identical request is served from the cache and costs no quota", async () => {
    const call = gemini({ resourceIds: ["r1", "r2"] });
    const first = await search({ q: "3d printer", catalogueVersion: 4 }, call);
    const second = await search({ catalogueVersion: 4, q: "3d printer" }, call);
    assert.equal(call.calls, 1);
    assert.deepEqual(second.result, { resourceIds: ["r1", "r2"] });
    assert.deepEqual([first.cached, second.cached], [false, true]);
    assert.equal(first.quota.used, 1);
    assert.equal(second.quota.used, 1, "cache hit didn't spend quota");
  });

  test("a different request spends quota again", async () => {
    const call = gemini({ resourceIds: [] });
    await search({ q: "3d printer" }, call);
    const other = await search({ q: "oscilloscope" }, call);
    assert.equal(call.calls, 2);
    assert.equal(other.quota.used, 2);
  });

  test("a failed call is refunded, rethrown and not cached", async () => {
    const failing = async () => {
      throw new Error("timeout after 8000 ms");
    };
    await assert.rejects(search({ q: "drone" }, failing), /timeout/);
    assert.equal((await getAiQuota("u1", NOW)).used, 0);
    const call = gemini({ resourceIds: ["r9"] });
    await search({ q: "drone" }, call);
    assert.equal(call.calls, 1, "the failure wasn't cached");
  });

  test("a Gemini 429 opens the circuit for everyone for 10 minutes", async () => {
    const limited = async () => {
      throw Object.assign(new Error("RESOURCE_EXHAUSTED"), { status: 429 });
    };
    const err = await search({ q: "drone" }, limited).catch((e) => e);
    assert.ok(err instanceof AiUnavailableError);
    assert.equal(await isAiCircuitOpen(), true);
    assert.ok((await redis.ttl(keys.aiCircuit)) <= 600);
    assert.equal(
      (await getAiQuota("u1", NOW)).used,
      0,
      "the user isn't charged",
    );

    const call = gemini({});
    const blocked = await withAiQuota({
      userId: "u2",
      feature: "search",
      input: { q: "x" },
      call,
      now: NOW,
    }).catch((e) => e);
    assert.ok(blocked instanceof AiUnavailableError);
    assert.equal(
      call.calls,
      0,
      "Gemini isn't called while the circuit is open",
    );
  });

  test("a quota denial never reaches Gemini", async () => {
    setLimits({ user: 1 });
    await search({ q: "a" }, gemini({}));
    const call = gemini({});
    const err = await search({ q: "b" }, call).catch((e) => e);
    assert.ok(err instanceof AiQuotaError);
    assert.equal(call.calls, 0);
  });

  test("fails closed when Redis is unreachable", async () => {
    useRedisClient(unreachable());
    const call = gemini({});
    const err = await search({ q: "a" }, call).catch((e) => e);
    assert.ok(err instanceof AiUnavailableError);
    assert.equal(call.calls, 0);
    await assert.rejects(isAiCircuitOpen(), AiUnavailableError);
    await assert.rejects(getAiQuota("u1", NOW), AiUnavailableError);
  });
});
