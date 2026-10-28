// Every Redis key the MVP uses, from the catalogue in architecture.md §10.1. Build keys here instead
// of by hand, so names and TTLs live in one place. (The AI quota keys arrive with C-05.)

const normaliseEmail = (email) => String(email).trim().toLowerCase();

export const keys = {
  otp: (email) => `otp:${normaliseEmail(email)}`,
  otpTries: (email) => `otp:tries:${normaliseEmail(email)}`,
  refreshToken: (userId, jti) => `auth:refresh:${userId}:${jti}`,
  // Prefix for rate-limit-redis; it appends the user id or email itself.
  rateLimitPrefix: (tier) => `rl:${tier}:`,
  resourceLock: (resourceId) => `lock:resource:${resourceId}`,
  sweepLock: "lock:cron:sweep",
  cacheVersion: (namespace) => `cache:${namespace}:ver`,
  resourceList: (version, queryHash) =>
    `cache:resources:v${version}:${queryHash}`,
  resourceDetail: (resourceId) => `cache:resource:${resourceId}`,
  catalogue: (name) => `cache:${name}`, // "orgunits" | "badges"
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
};
