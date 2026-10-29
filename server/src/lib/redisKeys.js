// Every Redis key the app uses, from the catalogue in architecture.md §10.1. Build keys here instead
// of by hand, so names and TTLs live in one place.

const normaliseEmail = (email) => String(email).trim().toLowerCase();

export const keys = {
  otp: (email) => `otp:${normaliseEmail(email)}`,
  otpTries: (email) => `otp:tries:${normaliseEmail(email)}`,
  // One key per session (a refresh-token family); the value is the family's current jti.
  refreshFamily: (userId, familyId) => `auth:refresh:${userId}:${familyId}`,
  // Prefix for the rate-limit store; it appends the user id, email, role or IP itself.
  rateLimitPrefix: (tier) => `rl:${tier}:`,
  // The global OTP email cap (middleware/rateLimit.js): a sorted set of send times, 24-hour window.
  otpEmailLog: "rl:otpEmail:global",
  resourceLock: (resourceId) => `lock:resource:${resourceId}`,
  sweepLock: "lock:cron:sweep",
  cacheVersion: (namespace) => `cache:${namespace}:ver`,
  resourceList: (version, queryHash) =>
    `cache:resources:v${version}:${queryHash}`,
  resourceDetail: (resourceId) => `cache:resource:${resourceId}`,
  catalogue: (name) => `cache:${name}`, // "orgunits" | "badges"
  // AI quota (§15.2). "{q}" is a literal hash tag: it keeps these keys in one cluster slot,
  // so the multi-key Lua script also works on clustered providers. Day and minute stamps are IST.
  aiBurst: (userId) => `ai:{q}:burst:${userId}`,
  aiUserDay: (userId, day) => `ai:{q}:user:${userId}:${day}`,
  aiGlobalDay: (day) => `ai:{q}:global:${day}`,
  aiGlobalMinute: (minute) => `ai:{q}:rpm:${minute}`,
  aiCache: (feature, inputHash) => `ai:cache:${feature}:${inputHash}`,
  aiCircuit: "ai:circuit",
};

// *Seconds are for EX, *Ms for PX.
export const TTL = {
  otpSeconds: 10 * 60,
  refreshTokenSeconds: 7 * 24 * 60 * 60,
  resourceLockMs: 5_000,
  sweepLockMs: 4 * 60 * 1000,
  resourceListSeconds: 60,
  resourceDetailSeconds: 5 * 60,
  catalogueSeconds: 10 * 60,
  aiDayCounterSeconds: 48 * 60 * 60,
  aiMinuteCounterSeconds: 120,
  aiCacheSeconds: 24 * 60 * 60,
  aiCircuitSeconds: 10 * 60,
};
