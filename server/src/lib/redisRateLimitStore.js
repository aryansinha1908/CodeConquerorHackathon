// Redis store for express-rate-limit: a fixed window per key, counted atomically in Lua.
//
// Used instead of rate-limit-redis because that store loads its scripts in init(), which runs when a
// router is imported. That's before connectRedis(), so with our fail-fast client the load always
// fails, and v6.0.1 never retries it: every limiter would stay disabled. ioredis' defineCommand
// sends EVALSHA and falls back to EVAL by itself, so nothing needs loading up front.
import { getRedis } from "../config/redis.js";

const INCREMENT = `
local ttl = redis.call("PTTL", KEYS[1])
if ttl <= 0 then
  redis.call("SET", KEYS[1], 1, "PX", ARGV[1])
  return {1, tonumber(ARGV[1])}
end
return {redis.call("INCR", KEYS[1]), ttl}`;

const GET = `
local hits = redis.call("GET", KEYS[1])
if not hits then return nil end
return {tonumber(hits), redis.call("PTTL", KEYS[1])}`;

const DECREMENT = `
local hits = tonumber(redis.call("GET", KEYS[1]) or "0")
if hits > 0 then return redis.call("DECR", KEYS[1]) end
return 0`;

function client() {
  const redis = getRedis();
  if (!redis.rateLimitIncrement) {
    redis.defineCommand("rateLimitIncrement", {
      numberOfKeys: 1,
      lua: INCREMENT,
    });
    redis.defineCommand("rateLimitGet", { numberOfKeys: 1, lua: GET });
    redis.defineCommand("rateLimitDecrement", {
      numberOfKeys: 1,
      lua: DECREMENT,
    });
  }
  return redis;
}

const toInfo = ([hits, ttlMs]) => ({
  totalHits: Number(hits),
  resetTime: new Date(Date.now() + Number(ttlMs)),
});

// Methods reject when Redis is down; express-rate-limit's passOnStoreError lets the request through.
export class RedisRateLimitStore {
  // Counts live in Redis, shared by every instance (read by express-rate-limit's checks).
  localKeys = false;

  constructor({ prefix }) {
    this.prefix = prefix;
  }

  init({ windowMs }) {
    this.windowMs = windowMs;
  }

  async increment(key) {
    return toInfo(
      await client().rateLimitIncrement(this.prefix + key, this.windowMs),
    );
  }

  async get(key) {
    const reply = await client().rateLimitGet(this.prefix + key);
    return reply ? toInfo(reply) : undefined;
  }

  // Used by skipSuccessfulRequests (login counts failures only). Never goes below zero.
  async decrement(key) {
    await client().rateLimitDecrement(this.prefix + key);
  }

  async resetKey(key) {
    await client().del(this.prefix + key);
  }
}
