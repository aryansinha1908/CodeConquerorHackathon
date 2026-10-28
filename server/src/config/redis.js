// Shared Redis client (architecture.md §10): OTPs, refresh tokens, rate limits, locks and cache.
//
// Commands fail fast while Redis is unreachable instead of queueing, so each caller gets its
// documented behaviour at once (§10.2): the cache falls back to Mongo, the booking lock answers
// 503, the rate limiter lets requests through. ioredis keeps reconnecting in the background.
//
// The client is created on first use rather than on import, so REDIS_URL is read after dotenv
// has run, and tests and scripts that never touch Redis open no socket.
import { once } from "node:events";
import Redis from "ioredis";
import { log, setLogger } from "../lib/log.js";

export { log, setLogger as setRedisLogger };

const DEFAULT_URL = "redis://127.0.0.1:6379";
const ERROR_LOG_INTERVAL_MS = 60_000;

let client = null;

function createClient(url) {
  const redis = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  // A dead Redis emits an error on every retry; log the first one, then at most once a minute.
  let lastErrorAt = 0;
  redis.on("ready", () => {
    lastErrorAt = 0;
    log.info("Redis connected");
  });
  redis.on("error", (err) => {
    if (Date.now() - lastErrorAt < ERROR_LOG_INTERVAL_MS) return;
    lastErrorAt = Date.now();
    log.warn({ err }, "Redis connection error; retrying in the background");
  });
  return redis;
}

export function getRedis() {
  if (!client) {
    if (!process.env.REDIS_URL)
      log.warn(`REDIS_URL is not set; using ${DEFAULT_URL}`);
    client = createClient(process.env.REDIS_URL || DEFAULT_URL);
  }
  return client;
}

// Tests swap in ioredis-mock or a stub.
export function useRedisClient(next) {
  client = next;
}

function withTimeout(promise, ms, message) {
  promise.catch(() => {}); // the timeout may win; don't leave the loser unhandled
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Call once at boot, before app.listen(). Resolves false instead of throwing when Redis is down,
// so the API still starts in degraded mode (no cache, bookings answer 503) and recovers on reconnect.
export async function connectRedis({
  logger: appLogger,
  timeoutMs = 5000,
} = {}) {
  if (appLogger) setRedisLogger(appLogger);
  const redis = getRedis();
  if (redis.status === "ready") return true;
  try {
    const ready =
      redis.status === "wait" ? redis.connect() : once(redis, "ready");
    await withTimeout(
      ready,
      timeoutMs,
      `Redis not ready after ${timeoutMs} ms`,
    );
    return true;
  } catch (err) {
    log.error(
      { err },
      "Redis unavailable at startup; caching is off and booking requests will answer 503 until it reconnects",
    );
    return false;
  }
}

// For GET /health.
export async function pingRedis(timeoutMs = 1000) {
  try {
    return (
      (await withTimeout(
        getRedis().ping(),
        timeoutMs,
        "Redis ping timed out",
      )) === "PONG"
    );
  } catch {
    return false;
  }
}

// For graceful shutdown (SIGTERM on Render) and the end of scripts.
export async function disconnectRedis() {
  if (!client) return;
  const redis = client;
  client = null;
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
