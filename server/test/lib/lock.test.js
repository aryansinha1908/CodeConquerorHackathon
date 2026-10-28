import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import RedisMock from "ioredis-mock";
import { setRedisLogger, useRedisClient } from "../../src/config/redis.js";
import { LockUnavailableError, tryLock, withLock } from "../../src/lib/lock.js";

const warnings = [];
setRedisLogger({
  info() {},
  warn: (...args) => warnings.push(args),
  error() {},
});

const redis = new RedisMock();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const KEY = "lock:resource:test-printer";

const unreachable = () => ({
  defineCommand() {},
  set: async () => {
    throw new Error(
      "Stream isn't writeable and enableOfflineQueue options is false",
    );
  },
});

beforeEach(async () => {
  useRedisClient(redis);
  await redis.flushall();
  warnings.length = 0;
});

describe("tryLock", () => {
  test("only one holder at a time, with a PX expiry", async () => {
    const release = await tryLock(KEY, 5000);
    assert.equal(typeof release, "function");
    assert.equal(await tryLock(KEY, 5000), null);
    const pttl = await redis.pttl(KEY);
    assert.ok(pttl > 0 && pttl <= 5000, `pttl ${pttl}`);

    assert.equal(await release(), true);
    assert.equal(await redis.exists(KEY), 0);
    assert.equal(await release(), false, "second release is a no-op");
    assert.equal(typeof (await tryLock(KEY, 5000)), "function");
  });

  test("a late release never deletes a lock someone else took after expiry", async () => {
    const releaseFirst = await tryLock(KEY, 30);
    await sleep(60);
    const releaseSecond = await tryLock(KEY, 5000);
    assert.equal(typeof releaseSecond, "function", "expired lock can be taken");

    assert.equal(await releaseFirst(), false);
    assert.equal(await redis.exists(KEY), 1, "second holder's lock survives");
    assert.equal(await releaseSecond(), true);
  });
});

describe("withLock", () => {
  test("returns fn's result and releases", async () => {
    assert.equal(await withLock(KEY, async () => "created"), "created");
    assert.equal(await redis.exists(KEY), 0);
  });

  test("releases and rethrows when fn throws", async () => {
    await assert.rejects(
      withLock(KEY, async () => {
        throw new Error("insert failed");
      }),
      /insert failed/,
    );
    assert.equal(await redis.exists(KEY), 0);
  });

  test("critical sections never overlap", async () => {
    let inside = 0;
    let maxInside = 0;
    const work = () =>
      withLock(
        KEY,
        async () => {
          inside++;
          maxInside = Math.max(maxInside, inside);
          await sleep(15);
          inside--;
        },
        { retries: 50, retryDelayMs: 5 },
      );
    await Promise.all(Array.from({ length: 5 }, work));
    assert.equal(maxInside, 1);
  });

  test("two students racing for the last slot: one gets it, one is waitlisted", async () => {
    const book = async (holders, who) => {
      const taken = holders.length; // the overlap count
      await sleep(10); // the gap between count and insert
      if (taken < 1) {
        holders.push(who);
        return "pending";
      }
      return "waitlisted";
    };

    const unlocked = [];
    const raced = await Promise.all([book(unlocked, "A"), book(unlocked, "B")]);
    assert.deepEqual(
      raced,
      ["pending", "pending"],
      "without the lock both get the slot",
    );

    const locked = [];
    const options = { retries: 10, retryDelayMs: 5 };
    const results = await Promise.all([
      withLock(KEY, () => book(locked, "A"), options),
      withLock(KEY, () => book(locked, "B"), options),
    ]);
    assert.deepEqual(results.sort(), ["pending", "waitlisted"]);
    assert.equal(locked.length, 1);
  });

  test("gives up with 503 SERVICE_UNAVAILABLE while someone else holds the lock", async () => {
    await tryLock(KEY, 5000);
    let ran = false;
    const err = await withLock(KEY, async () => (ran = true), {
      retries: 2,
      retryDelayMs: 5,
    }).catch((e) => e);
    assert.ok(err instanceof LockUnavailableError);
    assert.equal(err.status, 503);
    assert.equal(err.code, "SERVICE_UNAVAILABLE");
    assert.equal(ran, false);
  });

  test("fails closed when Redis is unreachable", async () => {
    useRedisClient(unreachable());
    let ran = false;
    const err = await withLock(KEY, async () => (ran = true)).catch((e) => e);
    assert.ok(err instanceof LockUnavailableError);
    assert.match(err.message, /temporarily unavailable/);
    assert.match(err.cause.message, /enableOfflineQueue/);
    assert.equal(ran, false, "never runs unprotected");
  });

  test("warns when the critical section outlives the lock", async () => {
    const result = await withLock(
      KEY,
      async () => {
        await sleep(50);
        return "done";
      },
      { ttlMs: 20 },
    );
    assert.equal(result, "done");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][1], /expired before release/);
  });
});
