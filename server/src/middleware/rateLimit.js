// Request rate limits (architecture.md §11), keyed by user id, email or demo role. Hostels and
// departments share a few public IPs, so an IP is never the only key: an IP limit alone would let one
// heavy user lock out everyone on the same Wi-Fi. The public auth routes also have coarse per-IP
// ceilings (loginIp, registerIp, demoIp, otpSendIp), stacked on their email or role tier and generous
// enough for a hostel, so one address can't rotate through emails, use up a demo role for everyone,
// or take every code email of the day.
// Fails open: if Redis is down, requests pass and a warning is logged (§10.2). AI requests have their
// own hard quota in services/aiQuotaService.js; OTP emails have a global cap (takeOtpEmail, below).
//
// Mounting order:
//   auth routes:    validate(schema) → loginLimiter → handler   (needs a validated req.body.email)
//   API router:     requireAuth → generalLimiter → routes        (needs req.user)
//   refresh/logout: refreshCookieUser → refreshLimiter             (needs req.refreshUserId)
//   POST /bookings: bookingCreateLimiter;  upload routes: uploadLimiter
//   private file links (badge evidence, ID cards): fileLinkLimiter, after generalLimiter
// Stacked tiers run the narrower key first (email before IP, role and IP before role), so a request
// the narrow tier refuses doesn't use up the counter everyone behind that IP, or every judge, shares.
//
// The IP tiers key on the addresses app.js's trusted proxies forwarded ('trust proxy' is a hop count,
// never true): see byIp.
import { randomUUID } from "node:crypto";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { getRedis, log } from "../config/redis.js";
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

// The coarse IP ceilings key on every address the trusted proxies forwarded (req.ips, client first),
// not on req.ip alone. Each IPv6 address is grouped by its /56 (express-rate-limit's default), so one
// host can't step through its own subnet for fresh counters. Behind Vercel and Render
// (TRUST_PROXY_HOPS=2) the key is "visitor, the Vercel address that forwarded them". So visitors
// sharing a Vercel address keep their own counters. Someone calling the onrender.com URL directly
// with a victim's address in X-Forwarded-For lands on "victim, their own address", never on the
// victim's counter. With one hop the key is req.ip. Only ever the second key on a route, never the
// only one.
function byIp(req) {
  const chain = req.ips.length ? req.ips : [req.ip];
  return chain.map((address) => ipKeyGenerator(address)).join(",");
}

// One person can use up a demo role only for their own network: judges elsewhere keep signing in.
function byDemoRoleAndIp(req) {
  return `${byDemoRole(req)}:${byIp(req)}`;
}

// A connection that closed before its turn has no address. Nobody is waiting for the answer, so
// nothing is counted rather than every such request sharing one counter.
const noAddress = (req) => !req.ip;

// The login route sets res.locals.passwordMatched on 403 EMAIL_NOT_VERIFIED: the password was right,
// so it isn't a failed attempt. Counting it would lock out a member who signs in a few times before
// finding the code in their inbox, and it guards nothing: only the password holder gets that answer.
const PASSWORD_MATCHED = "passwordMatched";
export const markPasswordMatched = (res) => {
  res.locals[PASSWORD_MATCHED] = true;
};

const signInSucceeded = (_req, res) =>
  res.statusCode < 400 || res.locals[PASSWORD_MATCHED] === true;

// Set by a tier that answers 429, so a tier stacked before it can tell the request never reached the
// route (see createLimiter).
const REFUSED_BY = "rateLimitedBy";

export const TIERS = {
  login: {
    windowMs: 15 * MINUTE,
    limit: 5,
    key: byEmail,
    skipSuccessfulRequests: true, // only failed attempts count
    succeeded: signInSucceeded,
    message: (wait) =>
      `Too many failed login attempts for this account. Try again in ${wait}.`,
  },
  // Stacked after login: one address trying password after password across many accounts.
  loginIp: {
    windowMs: 15 * MINUTE,
    limit: 100,
    key: byIp,
    skip: noAddress,
    skipSuccessfulRequests: true,
    succeeded: signInSucceeded,
    message: (wait) =>
      `Too many failed login attempts from your network. Try again in ${wait}.`,
  },
  register: {
    windowMs: HOUR,
    limit: 3,
    key: byEmail,
    message: (wait) =>
      `Too many sign-up attempts for this email. Try again in ${wait}.`,
  },
  // Stacked after register: one address signing up email after email (each costs a bcrypt hash and
  // a code email).
  registerIp: {
    windowMs: HOUR,
    limit: 100,
    key: byIp,
    skip: noAddress,
    message: (wait) =>
      `Too many sign-ups from your network. Try again in ${wait}.`,
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
  // One network's share of the global cap on code emails (OTP_EMAIL_CAP): stacked last on register
  // and resend-otp, and taken by the code an unverified login emails (takeOtpSend). Without it, one
  // address could sign up made-up campus emails and resend their codes until nobody could register
  // for a day. A fifth of the cap: it takes five networks to use it all up.
  otpSendIp: {
    windowMs: DAY,
    limit: 50,
    key: byIp,
    skip: noAddress,
    message: (wait) =>
      `Too many verification codes asked for from your network today. Try again in ${wait}.`,
  },
  otpVerify: {
    windowMs: 15 * MINUTE,
    limit: 10,
    key: byEmail,
    message: (wait) =>
      `Too many attempts to enter a code for this email. Try again in ${wait}.`,
  },
  // Per role and address: what one network can do to a demo account.
  demoIp: {
    windowMs: 15 * MINUTE,
    limit: 60,
    key: byDemoRoleAndIp,
    skip: noAddress,
    message: (wait) =>
      `This demo account has been signed into a lot from your network. Try again in ${wait}.`,
  },
  // Per role, stacked after demoIp: every demo login stores a 7-day refresh session in Redis, so
  // this bounds what many addresses together can add, and how hard they can hit one role.
  demo: {
    windowMs: 15 * MINUTE,
    limit: 1000,
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

const defaultSucceeded = (_req, res) => res.statusCode < 400;

// overrides: tests shorten windows or swap the store. The middleware's `tier` names its tier.
export function createLimiter(tierName, overrides = {}) {
  const tier = { ...TIERS[tierName], ...overrides };
  const succeeded = tier.succeeded ?? defaultSucceeded;
  const limiter = rateLimit({
    windowMs: tier.windowMs,
    limit: tier.limit,
    keyGenerator: tier.key,
    skipSuccessfulRequests: tier.skipSuccessfulRequests ?? false,
    // What "successful" means for skipSuccessfulRequests; the library's default is status < 400. A
    // request a tier stacked after this one refused never reached the route, so it isn't a failure.
    ...(tier.skipSuccessfulRequests && {
      requestWasSuccessful: (req, res) =>
        (res.locals[REFUSED_BY] !== undefined &&
          res.locals[REFUSED_BY] !== tierName) ||
        succeeded(req, res),
    }),
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
      res.locals[REFUSED_BY] = tierName;
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
  limiter.tier = tierName;
  return limiter;
}

// Stacked: the email (or role) tier first, then the coarse IP ceilings. Express takes the arrays as
// middleware.
export const loginLimiter = [createLimiter("login"), createLimiter("loginIp")];
export const registerLimiter = [
  createLimiter("register"),
  createLimiter("registerIp"),
  createLimiter("otpSendIp"),
];
// 3 per 15 minutes and 10 per day for the email, then the network's daily share of code emails.
export const otpSendLimiter = [
  createLimiter("otpSend"),
  createLimiter("otpSendDaily"),
  createLimiter("otpSendIp"),
];

// The key the IP tiers use for this request, or null when it has no address (nothing is counted).
// For takeOtpSend, which runs in the service, after the limiters.
export const ipKey = (req) => (noAddress(req) ? null : byIp(req));

// The visitor's own address only (the first the trusted proxies forwarded), without the hops after
// it: through Vercel the next hop is whichever Vercel address carried the request, which changes, so
// a counter keyed on the whole chain would split one visitor's count. A direct caller can write this
// first address themselves (see render.yaml TRUST_PROXY_HOPS), so anything keyed on it needs a
// ceiling of its own: the AI demo pool is that ceiling.
export const visitorKey = (req) =>
  noAddress(req) ? null : ipKeyGenerator((req.ips.length ? req.ips : [req.ip])[0]);

// A code emailed by another route (an unverified login sends one) counts against resend-otp's
// counters, in the same order as otpSendLimiter, so no path emails an address, or a network, more
// often than resend-otp may. The login tier can't cap it: that 403 isn't a failed attempt
// (markPasswordMatched). `network` is ipKey(req); without one, only the email's counters are taken.
// → false once any tier is used up: send nothing. Fails open like the limiters; with Redis down the
// code couldn't be issued anyway.
const counterFor = (tierName) => {
  const store = new RedisRateLimitStore({
    prefix: keys.rateLimitPrefix(tierName),
  });
  store.init({ windowMs: TIERS[tierName].windowMs });
  return { store, limit: TIERS[tierName].limit };
};
const otpSendCounters = ["otpSend", "otpSendDaily"].map(counterFor);
const otpSendIpCounter = counterFor("otpSendIp");

export async function takeOtpSend(email, network) {
  const key = String(email).trim().toLowerCase();
  const takes = otpSendCounters.map((counter) => [counter, key]);
  if (network) takes.push([otpSendIpCounter, network]);
  try {
    for (const [{ store, limit }, counterKey] of takes)
      if ((await store.increment(counterKey)).totalHits > limit) return false;
  } catch (err) {
    log.warn({ err }, "Couldn't count an OTP email; sending it unlimited");
  }
  return true;
}

export const otpVerifyLimiter = createLimiter("otpVerify");
export const demoLimiter = [createLimiter("demoIp"), createLimiter("demo")];
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

// ── The global cap on OTP emails ───────────────────────────────────────────

// At most `limit` codes are emailed in any 24 hours, to everyone together (architecture.md §11). The
// free SMTP plans allow about 300 a day (Brevo) or 500 (Gmail). Once it is used up, register and
// resend-otp answer 503 for everybody instead of the provider refusing or suspending the account,
// so each network only gets its share (otpSendIp), and a warning is logged at 80%. A sliding
// window, so the cap holds over every 24 hours, whichever day the provider counts: a sorted set of
// send times, at most `limit` members. services/authService.js takes a slot for each code it is
// about to send.
export const OTP_EMAIL_CAP = { limit: 250, windowMs: DAY };
const OTP_EMAIL_WARN_AT = Math.ceil(OTP_EMAIL_CAP.limit * 0.8);

// KEYS: the log. ARGV: now (ms), the window (ms), the limit, a unique member ("" only looks).
// → {1, 0, slots in use} when a code may go out (logged, unless only looking), or {0, ms until one
// may}.
const OTP_EMAIL_SLOT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now - window)
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[3]) then
  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  return {0, tonumber(oldest[2]) + window - now}
end
if ARGV[4] ~= "" then
  redis.call("ZADD", KEYS[1], now, ARGV[4])
  redis.call("PEXPIRE", KEYS[1], window)
end
return {1, 0, redis.call("ZCARD", KEYS[1])}`;

// → { allowed: true } or { allowed: false, retryAfterSeconds }. Fails open like the limiters: with
// Redis down no code can be issued anyway, and that path answers its own 503.
async function otpEmailSlot(member) {
  try {
    const redis = getRedis();
    if (!redis.otpEmailSlot)
      redis.defineCommand("otpEmailSlot", {
        numberOfKeys: 1,
        lua: OTP_EMAIL_SLOT,
      });
    const [allowed, waitMs, used] = await redis.otpEmailSlot(
      keys.otpEmailLog,
      Date.now(),
      OTP_EMAIL_CAP.windowMs,
      OTP_EMAIL_CAP.limit,
      member,
    );
    if (Number(allowed) === 1) {
      // Once per crossing, not on every send after it.
      if (member && Number(used) === OTP_EMAIL_WARN_AT)
        log.warn(
          { used: Number(used), limit: OTP_EMAIL_CAP.limit },
          "80% of the code emails allowed in 24 hours are used up; at the cap, nobody can sign up",
        );
      return { allowed: true };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(Number(waitMs) / 1000)),
    };
  } catch (err) {
    log.warn({ err }, "Couldn't check the OTP email cap; sending anyway");
    return { allowed: true };
  }
}

// Takes one of the cap's slots for a code about to be emailed.
export const takeOtpEmail = () => otpEmailSlot(`${Date.now()}:${randomUUID()}`);

// Only looks: resend-otp asks this for every address, so whether the cap is used up says nothing
// about which addresses have accounts.
export const otpEmailsLeft = () => otpEmailSlot("");
