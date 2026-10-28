// Request rate limits (architecture.md §11), keyed by user id or by email, never by IP: hostels and
// departments share a few public IPs, so an IP limit would let one heavy user lock out everyone on
// the same Wi-Fi. Fails open: if Redis is down, requests pass and a warning is logged (§10.2).
// AI requests have their own hard quota in services/aiQuotaService.js.
//
// Mounting order:
//   auth routes:    validate(schema) → loginLimiter → handler   (needs a validated req.body.email)
//   API router:     requireAuth → generalLimiter → routes        (needs req.user)
//   POST /bookings: bookingCreateLimiter;  upload routes: uploadLimiter
import { rateLimit } from "express-rate-limit";
import { log } from "../config/redis.js";
import { keys } from "../lib/redisKeys.js";
import { RedisRateLimitStore } from "../lib/redisRateLimitStore.js";
import { formatDuration } from "../lib/time.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Key generators throw when their input is missing: that is a mounting mistake, and a loud
// 500 is safer than silently sharing one counter between everybody.
function byEmail(req) {
  const email = req.body?.email;
  if (typeof email !== "string" || !email.trim()) {
    throw new Error(
      "Rate limiter needs req.body.email: run the Zod validator before it",
    );
  }
  return email.trim().toLowerCase();
}

function byUser(req) {
  const id = req.user?.id ?? req.user?._id;
  if (!id)
    throw new Error(
      "Rate limiter needs req.user: mount it after the auth middleware",
    );
  return String(id);
}

// Judges share the seeded demo accounts, so demo-login is limited per role.
function byDemoRole(req) {
  const role = req.body?.role;
  if (typeof role !== "string" || !role) {
    throw new Error(
      "Rate limiter needs req.body.role: run the Zod validator before it",
    );
  }
  return role;
}

export const TIERS = {
  login: {
    windowMs: 15 * MINUTE,
    limit: 5,
    key: byEmail,
    skipSuccessfulRequests: true, // only failed attempts count
    message: (wait) =>
      `Too many failed login attempts for this account. Try again in ${wait}.`,
  },
  register: {
    windowMs: HOUR,
    limit: 3,
    key: byEmail,
    message: (wait) =>
      `Too many sign-up attempts for this email. Try again in ${wait}.`,
  },
  otpSend: {
    windowMs: 15 * MINUTE,
    limit: 3,
    key: byEmail,
    message: (wait) =>
      `Too many codes sent to this email. Try again in ${wait}.`,
  },
  otpSendDaily: {
    windowMs: DAY,
    limit: 10,
    key: byEmail,
    message: (wait) =>
      `This email has reached today's limit of 10 codes. Try again in ${wait}.`,
  },
  otpVerify: {
    windowMs: 15 * MINUTE,
    limit: 10,
    key: byEmail,
    message: (wait) =>
      `Too many attempts to enter a code for this email. Try again in ${wait}.`,
  },
  demo: {
    windowMs: 15 * MINUTE,
    limit: 60,
    key: byDemoRole,
    message: (wait) =>
      `This demo account is being used a lot right now. Try again in ${wait}.`,
  },
  general: {
    windowMs: 5 * MINUTE,
    limit: 300,
    key: byUser,
    message: (wait) =>
      `You're sending requests too quickly. Try again in ${wait}.`,
  },
  bookingCreate: {
    windowMs: HOUR,
    limit: 10,
    key: byUser,
    message: (wait) =>
      `You've sent 10 booking requests in the last hour. Try again in ${wait}.`,
  },
  upload: {
    windowMs: HOUR,
    limit: 20,
    key: byUser,
    message: (wait) =>
      `You've uploaded 20 files in the last hour. Try again in ${wait}.`,
  },
};

const secondsUntil = (date) =>
  Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));

// overrides: tests shorten windows or swap the store.
export function createLimiter(tierName, overrides = {}) {
  const tier = { ...TIERS[tierName], ...overrides };
  return rateLimit({
    windowMs: tier.windowMs,
    limit: tier.limit,
    keyGenerator: tier.key,
    skipSuccessfulRequests: tier.skipSuccessfulRequests ?? false,
    standardHeaders: "draft-7", // RateLimit headers, plus Retry-After on a 429
    legacyHeaders: false,
    passOnStoreError: true,
    store:
      tier.store ??
      new RedisRateLimitStore({ prefix: keys.rateLimitPrefix(tierName) }),
    logger: log,
    handler(req, res) {
      const retryAfterSeconds = req.rateLimit?.resetTime
        ? secondsUntil(req.rateLimit.resetTime)
        : Math.ceil(tier.windowMs / 1000);
      res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: tier.message(
            formatDuration(Math.ceil(retryAfterSeconds / 60)),
          ),
          details: { tier: tierName, limit: tier.limit, retryAfterSeconds },
        },
        requestId: req.id ?? null,
      });
    },
  });
}

export const loginLimiter = createLimiter("login");
export const registerLimiter = createLimiter("register");
// Two limiters stacked: 3 per 15 minutes and 10 per day. Express accepts the array as middleware.
export const otpSendLimiter = [
  createLimiter("otpSend"),
  createLimiter("otpSendDaily"),
];
export const otpVerifyLimiter = createLimiter("otpVerify");
export const demoLimiter = createLimiter("demo");
export const generalLimiter = createLimiter("general");
export const bookingCreateLimiter = createLimiter("bookingCreate");
export const uploadLimiter = createLimiter("upload");
