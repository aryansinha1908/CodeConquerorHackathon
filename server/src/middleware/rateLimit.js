// Request rate limits (architecture.md §11), keyed by user id or by email, never by IP: hostels and
// departments share a few public IPs, so an IP limit would let one heavy user lock out everyone on
// the same Wi-Fi. Fails open: if Redis is down, requests pass and a warning is logged (§10.2).
// AI requests have their own hard quota in services/aiQuotaService.js.
//
// Mounting order:
//   auth routes:    validate(schema) → loginLimiter → handler   (needs a validated req.body.email)
//   API router:     requireAuth → generalLimiter → routes        (needs req.user)
//   refresh/logout: refreshCookieUser → refreshLimiter             (needs req.refreshUserId)
//   POST /bookings: bookingCreateLimiter;  upload routes: uploadLimiter
//   private file links (badge evidence, ID cards): fileLinkLimiter, after generalLimiter
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

// /auth/refresh and /auth/logout carry no access token: routes/auth.js puts the user id from the signed
// refresh cookie in req.refreshUserId. They count against that user's general tier (architecture.md §6).
function byRefreshCookie(req) {
  const id = req.refreshUserId;
  if (!id)
    throw new Error(
      "Rate limiter needs req.refreshUserId: mount it after refreshCookieUser",
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

// The login route sets res.locals.passwordMatched on 403 EMAIL_NOT_VERIFIED: the password was right,
// so it isn't a failed attempt. Counting it would lock out a member who signs in a few times before
// finding the code in their inbox, and it guards nothing: only the password holder gets that answer.
const PASSWORD_MATCHED = "passwordMatched";
export const markPasswordMatched = (res) => {
  res.locals[PASSWORD_MATCHED] = true;
};

export const TIERS = {
  login: {
    windowMs: 15 * MINUTE,
    limit: 5,
    key: byEmail,
    skipSuccessfulRequests: true, // only failed attempts count
    succeeded: (_req, res) =>
      res.statusCode < 400 || res.locals[PASSWORD_MATCHED] === true,
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
  // Each signed link to a private file costs a Cloudinary Admin API call (config/cloudinary.js), and
  // that hourly quota is shared by everyone: without this, one member opening their own evidence in
  // a loop could stop every reviewer opening ID cards and certificates.
  fileLink: {
    windowMs: 15 * MINUTE,
    limit: 20,
    key: byUser,
    message: (wait) =>
      `You've opened 20 files in the last 15 minutes. Try again in ${wait}.`,
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
    // What "successful" means for skipSuccessfulRequests; the library's default is status < 400.
    ...(tier.succeeded && { requestWasSuccessful: tier.succeeded }),
    skip: tier.skip,
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
// A code emailed by another route (an unverified login sends one) counts against resend-otp's two
// counters, in the same order as otpSendLimiter, so no path emails an address more often than
// resend-otp may. The login tier can't cap it: that 403 isn't a failed attempt (markPasswordMatched).
// → false once either tier is used up: send nothing. Fails open like the limiters; with Redis down
// the code couldn't be issued anyway.
const otpSendCounters = ["otpSend", "otpSendDaily"].map((tierName) => {
  const store = new RedisRateLimitStore({
    prefix: keys.rateLimitPrefix(tierName),
  });
  store.init({ windowMs: TIERS[tierName].windowMs });
  return { store, limit: TIERS[tierName].limit };
});

export async function takeOtpSend(email) {
  const key = String(email).trim().toLowerCase();
  try {
    for (const { store, limit } of otpSendCounters)
      if ((await store.increment(key)).totalHits > limit) return false;
  } catch (err) {
    log.warn({ err }, "Couldn't count an OTP email; sending it unlimited");
  }
  return true;
}

export const otpVerifyLimiter = createLimiter("otpVerify");
export const demoLimiter = createLimiter("demo");
export const generalLimiter = createLimiter("general");
// The same counters as generalLimiter. Without a signed cookie there is nothing to count: the route
// answers 401 (refresh) or 200 (logout) without touching Redis.
export const refreshLimiter = createLimiter("general", {
  key: byRefreshCookie,
  skip: (req) => !req.refreshUserId,
});
export const bookingCreateLimiter = createLimiter("bookingCreate");
export const uploadLimiter = createLimiter("upload");
// One counter for GET /badge-requests/:id/evidence and GET /admin/verifications/:userId/id-card.
export const fileLinkLimiter = createLimiter("fileLink");
