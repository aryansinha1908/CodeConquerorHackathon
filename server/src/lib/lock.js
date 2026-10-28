// Short-lived Redis locks (architecture.md §9). Acquire with SET key token NX PX; release with a
// compare-and-delete script, so a request only ever deletes its own lock and never one that
// expired and was taken by someone else.
import { randomUUID } from "node:crypto";
import { getRedis, log } from "../config/redis.js";
import { TTL } from "./redisKeys.js";

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

// status and code follow the error envelope (architecture.md §6), so errorHandler can send it as is.
export class LockUnavailableError extends Error {
  constructor(
    message = "This resource is busy right now. Please try again.",
    options,
  ) {
    super(message, options);
    this.name = "LockUnavailableError";
    this.status = 503;
    this.code = "SERVICE_UNAVAILABLE";
  }
}

function client() {
  const redis = getRedis();
  if (!redis.releaseLock) {
    redis.defineCommand("releaseLock", {
      numberOfKeys: 1,
      lua: RELEASE_SCRIPT,
    });
  }
  return redis;
}

// One attempt. Resolves to release(), or null when someone else holds the lock.
// Rejects when Redis is unreachable; the caller decides whether that means skip or fail.
// release() resolves false if the lock had already expired.
export async function tryLock(key, ttlMs) {
  const redis = client();
  const token = randomUUID();
  if ((await redis.set(key, token, "PX", ttlMs, "NX")) !== "OK") return null;
  let released = false;
  return async function release() {
    if (released) return false;
    released = true;
    return (await redis.releaseLock(key, token)) === 1;
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs fn while holding the lock; retries with jitter, then gives up with a 503.
// Fails closed: if Redis is down it throws instead of running fn unprotected.
// Keep fn short (a count and an insert): the lock expires after ttlMs whatever happens.
export async function withLock(
  key,
  fn,
  { ttlMs = TTL.resourceLockMs, retries = 3, retryDelayMs = 100 } = {},
) {
  let release = null;
  for (let attempt = 0; attempt <= retries && !release; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs + Math.random() * retryDelayMs);
    try {
      release = await tryLock(key, ttlMs);
    } catch (err) {
      throw new LockUnavailableError(
        "Booking is temporarily unavailable. Please try again in a moment.",
        { cause: err },
      );
    }
  }
  if (!release) throw new LockUnavailableError();

  try {
    return await fn();
  } finally {
    try {
      if (!(await release())) {
        log.warn(
          { key, ttlMs },
          "Lock expired before release; the critical section ran longer than its TTL",
        );
      }
    } catch (err) {
      log.warn({ err, key }, "Lock release failed; it will expire on its own");
    }
  }
}
