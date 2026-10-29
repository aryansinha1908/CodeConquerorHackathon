// Registration, email OTP, login, sessions and demo login (architecture.md §6 Auth, §7.1 and §8;
// backend.md B-01, B-02, B-04). routes/auth.js runs the read*Input checks below before the rate
// limiters, which key on the validated, lower-cased email (§11); the flows run them again, as every
// service validates its own input (backend.md §7).
//
// No enumeration: resend-otp answers the same for every address, and a wrong email or password is the
// same 401 INVALID_CREDENTIALS, after a bcrypt compare either way so the timing matches. The one
// exception is by design: registering an already verified email is 409 EMAIL_TAKEN.
// INVALID_CREDENTIALS is deliberately not UNAUTHENTICATED, which makes the client try a token refresh.
//
// The code alone doesn't verify an account. Registering an unverified email again replaces its
// password, and the code goes to the inbox either way, so whoever re-registered last would own the
// account once the real owner typed in the code. verify-otp therefore also needs the sign-up proof:
// a cookie set by register, and by a login with the right password, that is only good for the
// password the account has now. The route moves it between the cookie and these functions.
import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { sendMail } from "../config/mailer.js";
import { log } from "../lib/log.js";
import { ServiceError } from "../lib/serviceError.js";
import { formatDuration } from "../lib/time.js";
import {
  otpEmailsLeft,
  takeOtpEmail,
  takeOtpSend,
} from "../middleware/rateLimit.js";
import { User } from "../models/index.js";
import { record } from "./auditService.js";
import {
  checkOtp,
  assertCodeStoreUp,
  issueOtp,
  sentWithin,
} from "./authOtp.js";
import {
  issueRefreshToken,
  readRefreshClaims,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  unauthenticated,
} from "./authTokens.js";
import {
  absent,
  assertValid,
  isPlainObject,
  readEnum,
  readText,
} from "./params.js";

export const BCRYPT_COST = 12;
export const DEMO_DOMAIN = "demo.campuscommons.test";
// The login page's demo buttons, in order (frontend.md F-03), and the seeded account each one uses.
export const DEMO_ROLES = [
  "student",
  "student2",
  "faculty",
  "manager",
  "admin",
];
export const OTP_RETRY_AFTER_SECONDS = 60;

// A cost-12 hash of a random string nobody kept: unknown emails are compared against it, so they take
// as long as a wrong password.
const DUMMY_HASH =
  "$2b$12$gh4Mm8yYbi87zUoWDr.64u32baaujeuWXxx9nHtiQUT3zFjWQaTza";
// The same pattern as the User model's email field.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// architecture.md §8. Years outside the model's 2000–2100 give no hints rather than a failed save.
const ROLL_NUMBER =
  /^(?<year>\d{4})(?<level>ug|pg|rs)(?<branch>[a-z]{2,6})(?<serial>\d{2,4})@nitjsr\.ac\.in$/;

const USER_VIEW_DEPARTMENT = { path: "department", select: "code name" };

export const demoMode = () => process.env.DEMO_MODE === "true";
// Emails are stored lower-cased, so the suffix is enough. Also used by services that keep demo
// sessions away from real members' data (verificationService).
export const isDemoAccount = (user) =>
  String(user.email).endsWith(`@${DEMO_DOMAIN}`);
// The same test as a query on User.email.
export const DEMO_EMAIL = new RegExp(`@${DEMO_DOMAIN.replaceAll(".", "\\.")}$`);

export function allowedDomains() {
  const list = (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return list.length ? list : ["nitjsr.ac.in"];
}

// ── Input ──────────────────────────────────────────────────────────────────

const asBody = (body) => (isPlainObject(body) ? body : {});

// purpose: "register" (allowed domains only), "code" (verify / resend) or "login" (also the demo
// domain while DEMO_MODE is on). Demo accounts are made by the seed and never get codes, since *.test
// addresses are never emailed.
function readEmail(value, problems, purpose) {
  if (absent(value)) {
    problems.push({ path: "email", message: "Required." });
    return undefined;
  }
  if (typeof value !== "string") {
    problems.push({ path: "email", message: "Must be text." });
    return undefined;
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    problems.push({ path: "email", message: "Must be a valid email address." });
    return undefined;
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (domain === DEMO_DOMAIN) {
    if (purpose === "login" && demoMode()) return email;
    problems.push({
      path: "email",
      message:
        purpose === "login"
          ? "Demo accounts are switched off."
          : "Demo accounts can't sign up or get codes.",
    });
    return undefined;
  }
  const domains = allowedDomains();
  if (!domains.includes(domain)) {
    problems.push({
      path: "email",
      message: `Use your college email (${domains.map((d) => `@${d}`).join(" or ")}).`,
    });
    return undefined;
  }
  return email;
}

// architecture.md §7.1: 8–72 characters with a letter and a digit. 72 is bcrypt's limit in bytes, and
// bcryptjs silently drops the rest, so bytes are checked too.
function readNewPassword(value, problems) {
  const path = "password";
  if (absent(value)) problems.push({ path, message: "Required." });
  else if (typeof value !== "string")
    problems.push({ path, message: "Must be text." });
  else if (value.length < 8)
    problems.push({ path, message: "Must be at least 8 characters." });
  else if (value.length > 72 || Buffer.byteLength(value) > 72)
    problems.push({
      path,
      message:
        "Can be at most 72 characters (accented letters and emoji count as more than one).",
    });
  else if (!/\p{L}/u.test(value) || !/\d/.test(value))
    problems.push({
      path,
      message: "Must contain at least one letter and one digit.",
    });
  else return value;
  return undefined;
}

// Shown to other people (managers, the audit log), so one plain line: no line breaks or other
// control characters.
function readName(value, problems) {
  const name = readText(value, "name", problems, {
    required: true,
    min: 2,
    max: 80,
  });
  if (name === undefined || !/\p{Cc}/u.test(name)) return name;
  problems.push({
    path: "name",
    message: "Can't contain line breaks or control characters.",
  });
  return undefined;
}

export function readRegisterInput(body) {
  const { name, email, password } = asBody(body);
  const problems = [];
  const clean = {
    name: readName(name, problems),
    email: readEmail(email, problems, "register"),
    password: readNewPassword(password, problems),
  };
  assertValid(problems, "field");
  return clean;
}

export function readOtpInput(body) {
  const { email, otp } = asBody(body);
  const problems = [];
  const clean = { email: readEmail(email, problems, "code") };
  if (absent(otp)) problems.push({ path: "otp", message: "Required." });
  else if (typeof otp !== "string" || !/^\d{6}$/.test(otp.trim()))
    problems.push({ path: "otp", message: "Must be the 6-digit code." });
  else clean.otp = otp.trim();
  assertValid(problems, "field");
  return clean;
}

export function readEmailInput(body) {
  const problems = [];
  const clean = { email: readEmail(asBody(body).email, problems, "code") };
  assertValid(problems, "field");
  return clean;
}

export function readLoginInput(body) {
  const { email, password } = asBody(body);
  const problems = [];
  const clean = { email: readEmail(email, problems, "login") };
  if (absent(password))
    problems.push({ path: "password", message: "Required." });
  else if (typeof password !== "string")
    problems.push({ path: "password", message: "Must be text." });
  else if (password.length > 72)
    problems.push({
      path: "password",
      message: "Can be at most 72 characters.",
    });
  else clean.password = password;
  assertValid(problems, "field");
  return clean;
}

export function readDemoInput(body) {
  const problems = [];
  const clean = {
    role: readEnum(asBody(body).role, DEMO_ROLES, "role", problems, {
      required: true,
    }),
  };
  assertValid(problems, "field");
  return clean;
}

// ── Views ──────────────────────────────────────────────────────────────────

// B-02: { year, level, branch, serial } from a roll-number address such as 2024ugcs999@nitjsr.ac.in,
// or null. A hint for the ID-card form only; the admin confirms member type and department.
export function emailHints(email) {
  const match = ROLL_NUMBER.exec(String(email).trim().toLowerCase());
  if (!match) return null;
  const { year, level, branch, serial } = match.groups;
  const y = Number(year);
  if (y < 2000 || y > 2100) return null;
  return { year: y, level, branch, serial };
}

const idOf = (value) => (value == null ? null : String(value._id ?? value));

// The user view: what the client may know about the signed-in user. Never the password hash or the
// ID card's Cloudinary id. `user` is lean, with the department populated (or not).
export function publicUser(user) {
  const dept = user.department;
  const hints = user.emailHints;
  return {
    _id: String(user._id),
    name: user.name,
    email: user.email,
    roles: user.roles ?? [],
    memberType: user.memberType ?? null,
    department:
      dept && dept.code
        ? { _id: String(dept._id), code: dept.code, name: dept.name }
        : null,
    managedOrgUnits: (user.managedOrgUnits ?? []).map(idOf),
    emailVerified: Boolean(user.emailVerified),
    verification: {
      status: user.verification?.status ?? "unsubmitted",
      reason: user.verification?.reason ?? null,
      submittedAt: user.verification?.submittedAt ?? null,
    },
    strikes: user.strikes ?? 0,
    suspendedUntil: user.suspendedUntil ?? null,
    suspensionReason: user.suspensionReason ?? null,
    emailHints:
      hints && (hints.year != null || hints.level)
        ? {
            year: hints.year ?? null,
            level: hints.level ?? null,
            branch: hints.branch ?? null,
            serial: hints.serial ?? null,
          }
        : null,
  };
}

const loadUser = (filter, { withPassword = false } = {}) => {
  const query = User.findOne(filter).populate(USER_VIEW_DEPARTMENT);
  return (withPassword ? query.select("+passwordHash") : query).lean();
};

// → { accessToken, refreshToken (null when Redis couldn't store it), user }. The route sets the cookie.
async function startSession(user) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: await issueRefreshToken(user._id),
    user: publicUser(user),
  };
}

// ── Sign-up proof ──────────────────────────────────────────────────────────

// Keyed by the password hash, which never leaves the server: nobody else can make one, and setting a
// new password (registering again) makes every earlier one useless.
const signupProof = ({ email, passwordHash }) =>
  createHmac("sha256", passwordHash)
    .update(`signup-proof:${email}`)
    .digest("base64url");

function proofMatches(given, user) {
  if (typeof given !== "string" || !user.passwordHash) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(signupProof(user));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── OTP email ──────────────────────────────────────────────────────────────

// backend.md §8.2: email goes out after the response, so a slow SMTP server neither delays the answer
// nor tells an attacker (by timing) which addresses have accounts. Failures are logged, not retried.
// No name in the greeting: anyone can register any campus address, and the name is what they typed.
function emailCode(user, code) {
  sendMail({
    to: user.email,
    subject: `${code} is your CampusCommons code`,
    text: [
      "Hi,",
      "",
      `Your CampusCommons verification code is ${code}. It expires in 10 minutes.`,
      "",
      "If you didn't ask for it, you can ignore this email: nothing happens without the code.",
    ].join("\n"),
  }).catch((err) =>
    log.error({ err, userId: String(user._id) }, "Couldn't email an OTP"),
  );
}

// The caller has taken a slot of the global cap on code emails first (takeOtpEmail).
async function sendCode(user) {
  emailCode(user, await issueOtp(user.email));
}

// 503 once the global cap on code emails (middleware/rateLimit.js, architecture.md §11) is used up:
// register and resend-otp say so and send nothing. The wait is until the oldest send in the window
// drops out.
function codeEmailsUsedUp(retryAfterSeconds) {
  const wait = formatDuration(Math.ceil(retryAfterSeconds / 60));
  const err = new ServiceError(
    503,
    "SERVICE_UNAVAILABLE",
    `We've reached today's limit for emailing codes, so no code was sent. Try again in ${wait}.`,
    { retryAfterSeconds },
  );
  err.headers = { "Retry-After": String(retryAfterSeconds) };
  return err;
}

// resend-otp's code, after the answer. The slot is taken only now, so if the cap ran out in between
// nothing is sent, and that is logged.
async function resendCode(user) {
  if (!(await takeOtpEmail()).allowed) {
    log.warn(
      { userId: String(user._id) },
      "The OTP email cap ran out before a resent code went out",
    );
    return;
  }
  await sendCode(user);
}

// ── Flows ──────────────────────────────────────────────────────────────────

const emailTaken = () =>
  new ServiceError(
    409,
    "EMAIL_TAKEN",
    "An account with this email already exists. Sign in instead.",
  );

// POST /auth/register → { email, otpSent: true, signupProof }; the route sets signupProof as a cookie.
// A new address gets an account (emailVerified false, hints from the roll number); an unverified one
// gets the new name and password. Either way a fresh code goes out.
export async function register(input, { requestId } = {}) {
  const { name, email, password } = readRegisterInput(input);
  // Without Redis no code can be sent: answer 503 before creating anything.
  await assertCodeStoreUp(email);
  const existing = await User.findOne({ email }).select("emailVerified").lean();
  if (existing?.emailVerified) throw emailTaken();
  // The same once the global cap on code emails is used up: nothing is created or changed.
  const slot = await takeOtpEmail();
  if (!slot.allowed) throw codeEmailsUsedUp(slot.retryAfterSeconds);

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const hints = emailHints(email) ?? undefined;
  let user;
  if (existing) {
    // Conditional, so an account verified meanwhile keeps its password.
    user = await User.findOneAndUpdate(
      { _id: existing._id, emailVerified: { $ne: true } },
      { $set: { name, passwordHash, ...(hints && { emailHints: hints }) } },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!user) throw emailTaken();
  } else {
    try {
      user = (
        await User.create({ name, email, passwordHash, emailHints: hints })
      ).toObject();
    } catch (err) {
      // Two sign-ups for one address at once: the unique index lets one through.
      if (err?.code === 11000) throw emailTaken();
      throw err;
    }
    await record({
      actor: { id: user._id, role: "member" },
      action: "user.registered",
      entity: { type: "user", id: user._id },
      requestId,
    });
  }
  await sendCode(user);
  return {
    email,
    otpSent: true,
    signupProof: signupProof({ email, passwordHash }),
  };
}

const otherBrowser = () =>
  new ServiceError(
    400,
    "INVALID_OTP",
    "This code is for a sign-up made in another browser, or one changed since. Sign in, or sign up again, here to get a new code.",
  );

// POST /auth/verify-otp → a session. Marks the email verified and uses the code up. `signupProof` is
// the cookie from this browser's register or login (see the top of this file). The code is checked
// first, so Redis being down is still 503 and every guess counts as a try; a right code entered in
// the wrong browser is used up, and the message says how to get a new one.
export async function verifyOtp(input, { signupProof: proof } = {}) {
  const { email, otp } = readOtpInput(input);
  await checkOtp(email, otp);
  const account = await User.findOne({ email })
    .select("email +passwordHash")
    .lean();
  // A code with no account behind it (deleted meanwhile) reads like any other bad code.
  if (!account)
    throw new ServiceError(
      400,
      "INVALID_OTP",
      "This code has expired or was already used. Request a new code.",
    );
  if (!proofMatches(proof, account)) throw otherBrowser();
  // Only while the password is still the one the proof is for: a sign-up again meanwhile wins.
  const user = await User.findOneAndUpdate(
    { _id: account._id, passwordHash: account.passwordHash },
    { $set: { emailVerified: true } },
    { returnDocument: "after" },
  )
    .populate(USER_VIEW_DEPARTMENT)
    .lean();
  if (!user) throw otherBrowser();
  return startSession(user);
}

// POST /auth/resend-otp → { sent: true, retryAfter } for every address. Only an existing, unverified
// account actually gets a code, issued after the answer like the email itself: waiting on Redis for
// those accounts only would let the response time single them out. A used-up cap on code emails is
// a 503 for every address, for the same reason.
export async function resendOtp(input) {
  const { email } = readEmailInput(input);
  await assertCodeStoreUp(email);
  const cap = await otpEmailsLeft();
  if (!cap.allowed) throw codeEmailsUsedUp(cap.retryAfterSeconds);
  const user = await User.findOne({ email })
    .select("name email emailVerified")
    .lean();
  if (user && !user.emailVerified)
    resendCode(user).catch((err) =>
      log.error({ err, userId: String(user._id) }, "Couldn't resend an OTP"),
    );
  return { sent: true, retryAfter: OTP_RETRY_AFTER_SECONDS };
}

const invalidCredentials = () =>
  new ServiceError(
    401,
    "INVALID_CREDENTIALS",
    "That email and password don't match an account.",
  );

// A stored hash bcrypt can't read (a hand-made or half-migrated row) is a mismatch, logged, not a 500.
async function passwordMatches(password, hash, userId) {
  try {
    return await bcrypt.compare(password, hash);
  } catch (err) {
    log.warn(
      { err, userId: userId && String(userId) },
      "Stored password hash is unreadable",
    );
    return false;
  }
}

// POST /auth/login → a session. An unverified email is 403 EMAIL_NOT_VERIFIED with a fresh code, unless
// one went out in the last minute (that code still works, and replacing it would break the email the
// user is reading), resend-otp's limits for the address or for the caller's network (`network`, the
// route's ipKey) are used up (this path counts against them, takeOtpSend, since the login tier
// doesn't count this 403 and registering needs no inbox), or the global cap on code emails is. The
// narrower limits are checked first, so a code they refuse doesn't use up a slot everyone shares.
export async function login(input, { network } = {}) {
  const { email, password } = readLoginInput(input);
  const user = await loadUser({ email }, { withPassword: true });
  // A password over 72 bytes can't be right (register refuses it), and bcrypt would only read 72.
  const comparable = Buffer.byteLength(password) <= 72;
  const matches = await passwordMatches(
    comparable ? password : "",
    user?.passwordHash ?? DUMMY_HASH,
    user?._id,
  );
  if (!user || !comparable || !matches) throw invalidCredentials();

  if (!user.emailVerified) {
    let message =
      "Verify your email first. We've sent a 6-digit code to your inbox.";
    if (!(await sentWithin(email, OTP_RETRY_AFTER_SECONDS))) {
      if ((await takeOtpSend(email, network)) && (await takeOtpEmail()).allowed)
        await sendCode(user);
      else
        message =
          "Verify your email first. Enter the last code we sent to your inbox, or ask for a new one later.";
    }
    const err = new ServiceError(403, "EMAIL_NOT_VERIFIED", message, {
      email,
    });
    // The right password: this browser may enter the code. The route sets it as a cookie; the error
    // handler only ever sends status, code, message and details.
    err.signupProof = signupProof(user);
    throw err;
  }
  return startSession(user);
}

// A demo session outlives DEMO_MODE only until its next refresh: it is ended there (and every other
// session of that demo user with it), and /me refuses it, so the client signs it out.
const demoSwitchedOff = () =>
  unauthenticated("Demo accounts are switched off. Sign in again.");

async function endDemoSessions(user) {
  try {
    await revokeAllRefreshTokens(user._id);
  } catch (err) {
    log.warn(
      { err, userId: String(user._id) },
      "Couldn't revoke a demo user's refresh tokens",
    );
  }
}

// POST /auth/refresh (cookie) → a new session; the old refresh token is used up. The user is read
// before the token is touched, so a MongoDB error leaves the cookie good for the retry.
export async function refreshSession(refreshToken, { now } = {}) {
  const claims = readRefreshClaims(refreshToken);
  if (!claims) throw unauthenticated();
  const user = await loadUser({ _id: claims.sub });
  if (!user) throw unauthenticated();
  if (isDemoAccount(user) && !demoMode()) {
    await endDemoSessions(user);
    throw demoSwitchedOff();
  }
  return {
    accessToken: signAccessToken(user),
    refreshToken: await rotateRefreshToken(claims, { now }),
    user: publicUser(user),
  };
}

// POST /auth/logout (cookie) → { loggedOut: true }, whatever state the token is in.
export async function logout(refreshToken) {
  await revokeRefreshToken(refreshToken);
  return { loggedOut: true };
}

// GET /auth/me → the user view. An account deleted since the token was issued is 401, so the client
// tries a refresh, which fails the same way, and shows the login page.
export async function getMe(userId) {
  const user = await loadUser({ _id: userId });
  if (!user) throw unauthenticated("Your account no longer exists.");
  if (isDemoAccount(user) && !demoMode()) throw demoSwitchedOff();
  return publicUser(user);
}

// GET /auth/demo-config → what the login page needs to show (or hide) the demo buttons.
export const demoConfig = () => {
  const on = demoMode();
  return { demoMode: on, roles: on ? [...DEMO_ROLES] : [] };
};

// The 404 for demo routes while DEMO_MODE is off: the same as an address that doesn't exist.
export const demoOff = () =>
  new ServiceError(404, "NOT_FOUND", "There's nothing at this address.");

// POST /auth/demo-login { role } → a session as the seeded demo user, no password (judges share them).
export async function demoLogin(input) {
  if (!demoMode()) throw demoOff();
  const { role } = readDemoInput(input);
  const user = await loadUser({ email: `${role}@${DEMO_DOMAIN}` });
  if (!user)
    throw new ServiceError(
      404,
      "NOT_FOUND",
      "The demo accounts haven't been created yet. Run npm run seed.",
    );
  return startSession(user);
}
