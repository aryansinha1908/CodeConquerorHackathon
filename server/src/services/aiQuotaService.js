// Hard quota for Gemini's free tier (architecture.md §15.2). Unlike the request limits in
// middleware/rateLimit.js this fails closed: if Redis is down, AI is off and regular search carries
// on, because overshooting the free tier can get the whole project's key blocked.
//
// Flow of withAiQuota(): circuit open → 503; cached answer → free; reserve quota (atomic Lua: burst,
// user daily, global per minute, global daily) → 429 when denied; call Gemini; cache the answer.
// A failed call is refunded to the user. A Gemini 429 also opens the circuit for 10 minutes.
//
// Limits come from env (read on each call, so dotenv order doesn't matter). Google no longer
// publishes fixed free-tier numbers: set AI_GLOBAL_DAILY_LIMIT below what AI Studio shows.
import { createHash } from "node:crypto";
import { getRedis, log } from "../config/redis.js";
import { TTL, keys } from "../lib/redisKeys.js";
import { DAY, MINUTE, formatHHmm, istParts } from "../lib/time.js";
import { canonicalJSON, getOrSet } from "./cacheService.js";

// KEYS: burst, userDay, globalMinute, globalDay, poolDay
// ARGV: burstSeconds, userLimit, rpmLimit, globalLimit, dayTtlSeconds, minuteTtlSeconds, poolLimit
// poolLimit is -1 for an account outside any pool; poolDay is then a key nothing reads.
// → {1, "OK", usedToday, poolUsedToday} or {0, reason, value}; value is the burst wait in ms for BURST.
const RESERVE = `
local burstTtl = redis.call("PTTL", KEYS[1])
if burstTtl ~= -2 then return {0, "BURST", burstTtl} end
local used = tonumber(redis.call("GET", KEYS[2]) or "0")
if used >= tonumber(ARGV[2]) then return {0, "USER_DAILY", used} end
local poolLimit = tonumber(ARGV[7])
if poolLimit >= 0 and tonumber(redis.call("GET", KEYS[5]) or "0") >= poolLimit then return {0, "POOL_DAILY", 0} end
if tonumber(redis.call("GET", KEYS[3]) or "0") >= tonumber(ARGV[3]) then return {0, "GLOBAL_MINUTE", 0} end
if tonumber(redis.call("GET", KEYS[4]) or "0") >= tonumber(ARGV[4]) then return {0, "GLOBAL_DAILY", 0} end
if tonumber(ARGV[1]) > 0 then redis.call("SET", KEYS[1], 1, "EX", ARGV[1]) end
used = redis.call("INCR", KEYS[2])
redis.call("EXPIRE", KEYS[2], ARGV[5])
redis.call("INCR", KEYS[3])
redis.call("EXPIRE", KEYS[3], ARGV[6])
redis.call("INCR", KEYS[4])
redis.call("EXPIRE", KEYS[4], ARGV[5])
local poolUsed = 0
if poolLimit >= 0 then
  poolUsed = redis.call("INCR", KEYS[5])
  redis.call("EXPIRE", KEYS[5], ARGV[5])
end
return {1, "OK", used, poolUsed}`;

// Gives the user's daily request back, and the pool's when there is one (ARGV[1] = "1"). Global
// counters stay spent: the call may still have reached Google. The burst flag stays too, so a
// failing endpoint can't be hammered.
const REFUND = `
local used = tonumber(redis.call("GET", KEYS[1]) or "0")
if used > 0 then used = redis.call("DECR", KEYS[1]) end
if ARGV[1] == "1" and tonumber(redis.call("GET", KEYS[2]) or "0") > 0 then redis.call("DECR", KEYS[2]) end
return used`;

function client() {
  const redis = getRedis();
  if (!redis.aiReserve) {
    redis.defineCommand("aiReserve", { numberOfKeys: 5, lua: RESERVE });
    redis.defineCommand("aiRefund", { numberOfKeys: 2, lua: REFUND });
  }
  return redis;
}

// The pool key, or one that is never read when the account isn't in a pool (the scripts take a
// fixed number of keys).
const poolKey = (pool, day) => keys.aiPoolDay(pool ?? "none", day);

function envInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function aiLimits() {
  return {
    burstSeconds: envInt("AI_USER_BURST_SECONDS", 10),
    userDaily: envInt("AI_USER_DAILY_LIMIT", 5),
    globalPerMinute: envInt("AI_GLOBAL_RPM", 8),
    globalDaily: envInt("AI_GLOBAL_DAILY_LIMIT", 50),
    // All demo accounts together (aiService.js puts them in the "demo" pool): below the global cap, so
    // a demo visitor who dodges the per-visitor counter (a forged X-Forwarded-For on a direct call)
    // can spend at most this, never what real members need.
    demoDaily: envInt("AI_DEMO_DAILY_LIMIT", 30),
  };
}

const poolLimitOf = (pool, limits) => (pool === "demo" ? limits.demoDaily : -1);

// Counters roll over at IST midnight and on each minute.
function istWindows(now) {
  const { dateKey, minutes } = istParts(now);
  const day = dateKey.replaceAll("-", "");
  return {
    day,
    minute: `${day}${formatHHmm(minutes).replace(":", "")}`,
    nextMidnight: new Date(
      new Date(`${dateKey}T00:00:00+05:30`).getTime() + DAY,
    ),
    nextMinute: new Date((Math.floor(now.getTime() / MINUTE) + 1) * MINUTE),
  };
}

const MESSAGES = {
  BURST: (limit) => `Please wait ${limit} seconds between AI requests.`,
  USER_DAILY: (limit) =>
    `You've used all ${limit} of today's AI requests. Regular search still works, and AI resets at midnight.`,
  POOL_DAILY: () =>
    "The demo accounts have used today's AI requests. Regular search still works, and AI resets at midnight.",
  GLOBAL_MINUTE: () =>
    "AI is busy right now. Try again in a minute; regular search still works.",
  GLOBAL_DAILY: () =>
    "AI has reached today's limit for the whole campus. Regular search still works, and AI resets at midnight.",
};

// status, code and headers follow the error envelope (architecture.md §6), so errorHandler can
// send them as they are.
export class AiQuotaError extends Error {
  constructor(reason, { limit, resetsAt, now }) {
    super(MESSAGES[reason](limit));
    const retryAfterSeconds = Math.max(1, Math.ceil((resetsAt - now) / 1000));
    this.name = "AiQuotaError";
    this.status = 429;
    this.code = "AI_QUOTA_EXCEEDED";
    this.details = {
      reason,
      limit,
      resetsAt: resetsAt.toISOString(),
      retryAfterSeconds,
    };
    this.headers = { "Retry-After": String(retryAfterSeconds) };
  }
}

export class AiUnavailableError extends Error {
  constructor(
    message = "AI is unavailable right now. Regular search still works.",
    options,
  ) {
    super(message, options);
    this.name = "AiUnavailableError";
    this.status = 503;
    this.code = "AI_UNAVAILABLE";
  }
}

function denial(reason, value, limits, windows, now) {
  if (reason === "BURST") {
    return {
      limit: limits.burstSeconds,
      resetsAt: new Date(now.getTime() + Math.max(Number(value), 1000)),
    };
  }
  if (reason === "USER_DAILY")
    return { limit: limits.userDaily, resetsAt: windows.nextMidnight };
  if (reason === "POOL_DAILY")
    return { limit: limits.demoDaily, resetsAt: windows.nextMidnight };
  if (reason === "GLOBAL_MINUTE")
    return { limit: limits.globalPerMinute, resetsAt: windows.nextMinute };
  return { limit: limits.globalDaily, resetsAt: windows.nextMidnight };
}

// userId: the quota subject (aiService.js aiQuotaFor). pool: "demo" for the demo accounts, else null.
// → { quota: { used, limit, remaining, resetsAt }, refund() }. Throws AiQuotaError or AiUnavailableError.
export async function reserveAiQuota(userId, now = new Date(), { pool = null } = {}) {
  const limits = aiLimits();
  const windows = istWindows(now);
  const userDayKey = keys.aiUserDay(userId, windows.day);
  const poolDayKey = poolKey(pool, windows.day);
  let reply;
  try {
    reply = await client().aiReserve(
      keys.aiBurst(userId),
      userDayKey,
      keys.aiGlobalMinute(windows.minute),
      keys.aiGlobalDay(windows.day),
      poolDayKey,
      limits.burstSeconds,
      limits.userDaily,
      limits.globalPerMinute,
      limits.globalDaily,
      TTL.aiDayCounterSeconds,
      TTL.aiMinuteCounterSeconds,
      poolLimitOf(pool, limits),
    );
  } catch (err) {
    log.warn({ err }, "AI quota check failed; AI is off until Redis is back");
    throw new AiUnavailableError(undefined, { cause: err });
  }

  const [allowed, reason, value] = reply;
  if (Number(allowed) !== 1) {
    throw new AiQuotaError(reason, {
      ...denial(reason, value, limits, windows, now),
      now,
    });
  }

  const used = Number(value);
  const userLeft = Math.max(0, limits.userDaily - used);
  const poolLeft = pool ? Math.max(0, limits.demoDaily - Number(reply[3] ?? 0)) : Infinity;
  let refunded = false;
  return {
    quota: {
      used,
      limit: limits.userDaily,
      remaining: Math.min(userLeft, poolLeft),
      resetsAt: windows.nextMidnight.toISOString(),
    },
    // Refunds the same day's counter even if the call ran past midnight. Safe to call twice.
    async refund() {
      if (refunded) return;
      refunded = true;
      try {
        await client().aiRefund(userDayKey, poolDayKey, pool ? "1" : "0");
      } catch (err) {
        // The account id only: a demo subject also carries the caller's address.
        log.warn({ err, userId: String(userId).split("@")[0] }, "AI quota refund failed");
      }
    },
  };
}

// For GET /ai/quota and the "AI requests left today" meter. In a pool, remaining is also capped by
// what the pool has left, so the meter never promises a request the pool would refuse.
export async function getAiQuota(userId, now = new Date(), { pool = null } = {}) {
  const limits = aiLimits();
  const windows = istWindows(now);
  let used;
  let poolUsed = 0;
  try {
    [used, poolUsed] = (
      await Promise.all([
        getRedis().get(keys.aiUserDay(userId, windows.day)),
        pool ? getRedis().get(poolKey(pool, windows.day)) : 0,
      ])
    ).map((value) => Number(value) || 0);
  } catch (err) {
    throw new AiUnavailableError(undefined, { cause: err });
  }
  const userLeft = Math.max(0, limits.userDaily - used);
  return {
    used,
    limit: limits.userDaily,
    remaining: pool ? Math.min(userLeft, Math.max(0, limits.demoDaily - poolUsed)) : userLeft,
    resetsAt: windows.nextMidnight.toISOString(),
  };
}

export async function isAiCircuitOpen() {
  try {
    return (await getRedis().exists(keys.aiCircuit)) === 1;
  } catch (err) {
    throw new AiUnavailableError(undefined, { cause: err });
  }
}

export async function openAiCircuit(reason = "gemini_429") {
  try {
    await getRedis().set(keys.aiCircuit, reason, "EX", TTL.aiCircuitSeconds);
    log.warn(
      { reason, seconds: TTL.aiCircuitSeconds },
      "AI circuit opened; AI is off for everyone",
    );
  } catch (err) {
    log.warn({ err }, "Could not open the AI circuit");
  }
}

const isGeminiRateLimit = (err) =>
  err?.status === 429 || err?.code === 429 || err?.response?.status === 429;

const aiCacheKey = (feature, input) =>
  keys.aiCache(
    feature,
    createHash("sha256").update(canonicalJSON(input)).digest("hex"),
  );

// feature: "search" | "incident_summary" | "condition_compare"
// input:   exactly what is sent to Gemini (no personal data, §15.3); identical input hits the cache
// call:    () => Promise<result>, the Gemini request itself
// → { result, cached, quota }
export async function withAiQuota({
  userId,
  pool = null,
  feature,
  input,
  call,
  now = new Date(),
}) {
  if (await isAiCircuitOpen()) {
    throw new AiUnavailableError(
      "AI is paused for a few minutes. Regular search still works.",
    );
  }

  let reservation = null;
  const result = await getOrSet(
    aiCacheKey(feature, input),
    TTL.aiCacheSeconds,
    async () => {
      reservation = await reserveAiQuota(userId, now, { pool });
      try {
        return await call();
      } catch (err) {
        await reservation.refund();
        if (isGeminiRateLimit(err)) {
          await openAiCircuit();
          throw new AiUnavailableError(
            "AI is paused for a few minutes. Regular search still works.",
            {
              cause: err,
            },
          );
        }
        throw err;
      }
    },
  );

  return {
    result,
    cached: reservation === null,
    quota: reservation ? reservation.quota : await getAiQuota(userId, now, { pool }),
  };
}
