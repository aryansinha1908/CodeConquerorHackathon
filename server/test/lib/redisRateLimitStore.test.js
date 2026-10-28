import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import RedisMock from "ioredis-mock";
import { useRedisClient } from "../../src/config/redis.js";
import { RedisRateLimitStore } from "../../src/lib/redisRateLimitStore.js";

const redis = new RedisMock();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const store = () => {
  const s = new RedisRateLimitStore({ prefix: "rl:test:" });
  s.init({ windowMs: 60_000 });
  return s;
};

beforeEach(async () => {
  useRedisClient(redis);
  await redis.flushall();
});

test("increment counts hits in a fixed window that starts on the first hit", async () => {
  const s = store();
  const first = await s.increment("user-1");
  assert.equal(first.totalHits, 1);
  const msLeft = first.resetTime.getTime() - Date.now();
  assert.ok(msLeft > 59_000 && msLeft <= 60_000, `${msLeft} ms`);
  assert.equal((await s.increment("user-1")).totalHits, 2);
  assert.equal((await s.increment("user-2")).totalHits, 1);
  assert.equal(await redis.get("rl:test:user-1"), "2");
});

test("the count starts again after the window", async () => {
  const s = new RedisRateLimitStore({ prefix: "rl:short:" });
  s.init({ windowMs: 40 });
  await s.increment("user-1");
  await s.increment("user-1");
  await sleep(70);
  assert.equal((await s.increment("user-1")).totalHits, 1);
});

test("get, decrement (never below zero) and resetKey", async () => {
  const s = store();
  assert.equal(await s.get("user-1"), undefined);
  await s.increment("user-1");
  await s.increment("user-1");
  assert.equal((await s.get("user-1")).totalHits, 2);
  await s.decrement("user-1");
  await s.decrement("user-1");
  await s.decrement("user-1");
  assert.equal((await s.get("user-1")).totalHits, 0);
  await s.resetKey("user-1");
  assert.equal(await s.get("user-1"), undefined);
});

test("exposes the shape express-rate-limit expects from a shared store", () => {
  const s = store();
  assert.equal(s.localKeys, false);
  assert.equal(s.prefix, "rl:test:");
});
