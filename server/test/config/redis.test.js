import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  connectRedis,
  disconnectRedis,
  getRedis,
  pingRedis,
  setRedisLogger,
} from "../../src/config/redis.js";
import { withLock } from "../../src/lib/lock.js";
import { getOrSet } from "../../src/services/cacheService.js";

// The real ioredis client against a port nothing listens on: checks that a dead Redis makes
// callers fail fast instead of hanging, with no Redis server needed.
process.env.REDIS_URL = "redis://127.0.0.1:1";

const logged = { info: [], warn: [], error: [] };
const logger = {
  info: (...args) => logged.info.push(args),
  warn: (...args) => logged.warn.push(args),
  error: (...args) => logged.error.push(args),
};
setRedisLogger(logger);

after(() => disconnectRedis());

const timed = async (fn) => {
  const started = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - started };
};

describe("getRedis", () => {
  test("creates one client on first use, without connecting yet", () => {
    const redis = getRedis();
    assert.equal(getRedis(), redis);
    assert.equal(redis.status, "wait");
    assert.equal(redis.options.enableOfflineQueue, false);
    assert.equal(redis.options.maxRetriesPerRequest, 1);
    assert.equal(redis.options.port, 1);
  });
});

describe("when Redis is down", () => {
  test("connectRedis resolves false and logs one error instead of throwing", async () => {
    const { result, ms } = await timed(() => connectRedis({ timeoutMs: 2000 }));
    assert.equal(result, false);
    assert.ok(ms < 2500, `${ms} ms`);
    assert.equal(logged.error.length, 1);
    assert.match(logged.error[0][1], /unavailable at startup/);
  });

  test("commands reject at once rather than queueing", async () => {
    const { result, ms } = await timed(() =>
      getRedis()
        .get("anything")
        .catch((e) => e),
    );
    assert.ok(result instanceof Error);
    assert.ok(ms < 200, `${ms} ms`);
  });

  test("the cache falls back to the loader quickly", async () => {
    const { result, ms } = await timed(() =>
      getOrSet("cache:x", 60, async () => "from mongo"),
    );
    assert.equal(result, "from mongo");
    assert.ok(ms < 200, `${ms} ms`);
  });

  test("the booking lock answers 503 quickly", async () => {
    const { result, ms } = await timed(() =>
      withLock("lock:resource:x", async () => "ran").catch((e) => e),
    );
    assert.equal(result.code, "SERVICE_UNAVAILABLE");
    assert.ok(ms < 200, `${ms} ms`);
  });

  test("pingRedis reports false for /health", async () => {
    assert.equal(await pingRedis(500), false);
  });

  test("repeated connection errors are logged at most once a minute", () => {
    assert.ok(
      logged.warn.filter(([, m]) => /connection error/.test(m)).length <= 1,
    );
  });
});
