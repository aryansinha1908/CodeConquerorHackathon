// The auth service (architecture.md §6 Auth, §7.1, §8) against a real MongoDB; see fixtures.js for how
// to run it. Redis is ioredis-mock, and email goes to a capturing transport, which is where the tests
// read the codes from.
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { useMailTransport } from "../../src/config/mailer.js";
import { useRedisClient } from "../../src/config/redis.js";
import { keys, TTL } from "../../src/lib/redisKeys.js";
import { AuditLog, User } from "../../src/models/index.js";
import {
  BCRYPT_COST,
  demoConfig,
  demoLogin,
  emailHints,
  getMe,
  login as loginService,
  logout,
  refreshSession,
  register as registerService,
  resendOtp,
  verifyOtp as verifyOtpService,
} from "../../src/services/authService.js";
import { failure, redis, skip, useTestDatabase, warnings } from "./fixtures.js";

process.env.ACCESS_TOKEN_SECRET = "test-access-secret";
process.env.REFRESH_TOKEN_SECRET = "test-refresh-secret";
process.env.OTP_PEPPER = "test-pepper";

const mails = [];
useMailTransport({ sendMail: async (message) => mails.push(message) });

let f; // fixtures, rebuilt for every test

const EMAIL = "2024ugcs999@nitjsr.ac.in";
const PASSWORD = "printer2024";

function assertError(err, status, code) {
  assert.equal(err.status, status, err.message);
  assert.equal(err.code, code);
}

const mailsTo = (email) => mails.filter((m) => m.to === email);
// The code in the newest email to the address.
function codeFor(email) {
  const mail = mailsTo(email).at(-1);
  assert.ok(mail, `no email to ${email}`);
  return /\b(\d{6})\b/.exec(mail.text)[1];
}
// resend-otp issues and mails its code after answering.
async function waitFor(condition, what = "condition", ms = 2000) {
  const until = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > until) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const resent = async (email) => {
  const before = mailsTo(email).length;
  const answer = await resendOtp({ email });
  await waitFor(() => mailsTo(email).length > before, `a code for ${email}`);
  return answer;
};

const wrongCode = (code) =>
  String((Number(code) + 1) % 1_000_000).padStart(6, "0");

// One browser: it keeps the sign-up cookie (signupProof) that register and an unverified login set,
// per address, and sends it with verify-otp, as routes/auth.js does with the real cookie.
const browser = new Map();
const normalised = (email) => String(email ?? "").trim().toLowerCase();

async function register(input, options) {
  const result = await registerService(input, options);
  browser.set(result.email, result.signupProof);
  return result;
}

async function login(input) {
  try {
    return await loginService(input);
  } catch (err) {
    if (err.signupProof) browser.set(normalised(input.email), err.signupProof);
    throw err;
  }
}

const verifyOtp = (input, options) =>
  verifyOtpService(
    input,
    options ?? { signupProof: browser.get(normalised(input?.email)) },
  );

const signUp = (extra = {}) =>
  register({ name: "Ananya Rao", email: EMAIL, password: PASSWORD, ...extra });

async function signedUp(extra) {
  await signUp(extra);
  return verifyOtp({ email: EMAIL, otp: codeFor(EMAIL) });
}

// A verified account with a real (cheap) hash, without going through the OTP.
async function account(email, password = PASSWORD, extra = {}) {
  return User.create({
    name: "Kabir Singh",
    email,
    passwordHash: await bcrypt.hash(password, 4),
    emailVerified: true,
    ...extra,
  });
}

// Every command fails, like the fail-fast client while Redis is unreachable.
const redisDown = () =>
  new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error(
          "Stream isn't writeable and enableOfflineQueue options is false",
        );
      },
    },
  );

// ioredis-mock with selected commands failing.
const redisFailing = (...commands) =>
  new Proxy(redis, {
    get(target, prop) {
      if (commands.includes(prop))
        return async () => {
          throw new Error("Connection is closed.");
        };
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

const refreshKeys = (userId) => redis.keys(`auth:refresh:${userId}:*`);

// Past the window in which a just-rotated token still gets the current one (two tabs refreshing at once).
const aMinuteLater = () => ({ now: Date.now() + 60_000 });

describe("auth service", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  beforeEach(() => {
    mails.length = 0;
    browser.clear();
    delete process.env.DEMO_MODE;
    delete process.env.ALLOWED_EMAIL_DOMAINS;
  });

  describe("register", () => {
    test("creates an unverified member with email hints and a cost-12 hash, and emails a code", async () => {
      const { signupProof, ...answer } = await signUp({
        email: "  2024UGCS999@NITJSR.ac.in ",
      });
      assert.deepEqual(answer, { email: EMAIL, otpSent: true });
      assert.match(signupProof, /^[\w-]{43}$/, "for the route's cookie");
      const user = await User.findOne({ email: EMAIL })
        .select("+passwordHash")
        .lean();
      assert.equal(user.name, "Ananya Rao");
      assert.equal(user.emailVerified, false);
      assert.deepEqual(user.roles, ["member"]);
      assert.equal(user.verification.status, "unsubmitted");
      assert.deepEqual(user.emailHints, {
        year: 2024,
        level: "ug",
        branch: "cs",
        serial: "999",
      });
      assert.equal(
        user.memberType,
        undefined,
        "the admin confirms the member type",
      );
      assert.ok(user.passwordHash.startsWith(`$2b$${BCRYPT_COST}$`));
      assert.equal(BCRYPT_COST, 12);
      assert.ok(await bcrypt.compare(PASSWORD, user.passwordHash));

      const [mail] = mails;
      assert.equal(mails.length, 1);
      assert.equal(mail.to, EMAIL);
      // The name is whatever the requester typed: it stays out of a mail sent to someone's inbox.
      assert.equal(mail.text.includes("Ananya"), false);
      assert.match(mail.text, /expires in 10 minutes/);

      const audit = await AuditLog.find({ action: "user.registered" }).lean();
      assert.equal(audit.length, 1);
      assert.equal(String(audit[0].entity.id), String(user._id));
      assert.equal(audit[0].actor.role, "member");
    });

    test("Redis keeps only the peppered sha256 of the code, for 10 minutes", async () => {
      await signUp();
      const code = codeFor(EMAIL);
      const stored = await redis.get(keys.otp(EMAIL));
      assert.equal(
        stored,
        createHash("sha256").update(`${code}test-pepper`).digest("hex"),
      );
      assert.notEqual(stored, code);
      const ttl = await redis.ttl(keys.otp(EMAIL));
      assert.ok(ttl > TTL.otpSeconds - 5 && ttl <= 600, String(ttl));
      assert.equal(TTL.otpSeconds, 600);
    });

    test("only ALLOWED_EMAIL_DOMAINS can register (default nitjsr.ac.in); demo addresses never can", async () => {
      for (const email of [
        "someone@gmail.com",
        "x@sub.nitjsr.ac.in",
        "student9@demo.campuscommons.test",
        "not-an-email",
      ]) {
        const err = await failure(signUp({ email }));
        assertError(err, 400, "VALIDATION_ERROR");
        assert.deepEqual(
          err.details.map((d) => d.path),
          ["email"],
          email,
        );
      }
      assert.match(
        (await failure(signUp({ email: "a@gmail.com" }))).details[0].message,
        /@nitjsr\.ac\.in/,
      );

      process.env.ALLOWED_EMAIL_DOMAINS = "nitjsr.ac.in, @Example.EDU";
      await signUp({ email: "visiting.prof@example.edu" });
      assert.ok(await User.exists({ email: "visiting.prof@example.edu" }));
      assert.equal(mails.length, 1);
    });

    test("name, email and password are checked together; the password needs 8–72 characters, a letter and a digit", async () => {
      const err = await failure(
        register({ name: " A ", email: "", password: "short1" }),
      );
      assertError(err, 400, "VALIDATION_ERROR");
      assert.deepEqual(err.details, [
        { path: "name", message: "Must be at least 2 characters." },
        { path: "email", message: "Required." },
        { path: "password", message: "Must be at least 8 characters." },
      ]);
      const passwordProblem = async (password) =>
        (await failure(signUp({ password }))).details.map((d) => d.message);
      assert.deepEqual(await passwordProblem("onlyletters"), [
        "Must contain at least one letter and one digit.",
      ]);
      assert.deepEqual(await passwordProblem("12345678"), [
        "Must contain at least one letter and one digit.",
      ]);
      assert.match(
        (await passwordProblem(`a1${"x".repeat(71)}`))[0],
        /at most 72/,
      );
      // 72 characters but more than 72 bytes: bcrypt would ignore the end.
      assert.match(
        (await passwordProblem(`a1${"é".repeat(40)}`))[0],
        /at most 72/,
      );
      assert.deepEqual(await passwordProblem(12345678), ["Must be text."]);
      assert.equal(await User.countDocuments({ email: EMAIL }), 0);
      assert.equal(mails.length, 0);
    });

    test("a name with line breaks or other control characters is refused", async () => {
      for (const name of [
        "Ananya\n\nYour account is locked. Unlock it at http://evil.example",
        "Ananya\rRao",
        "Ananya\u0007Rao",
      ]) {
        const err = await failure(signUp({ name }));
        assertError(err, 400, "VALIDATION_ERROR");
        assert.deepEqual(err.details, [
          { path: "name", message: "Can't contain line breaks or control characters." },
        ]);
      }
      assert.equal(mails.length, 0);
      await signUp({ name: "Ananya Rao-Iyer" });
    });

    test("a verified email is 409 EMAIL_TAKEN and nothing changes", async () => {
      await account(EMAIL, "original1");
      const err = await failure(signUp());
      assertError(err, 409, "EMAIL_TAKEN");
      const user = await User.findOne({ email: EMAIL })
        .select("+passwordHash")
        .lean();
      assert.ok(await bcrypt.compare("original1", user.passwordHash));
      assert.equal(mails.length, 0);
    });

    test("an unverified account is updated with the new name and password and gets a fresh code", async () => {
      await signUp();
      const firstCode = codeFor(EMAIL);
      const { signupProof: _proof, ...answer } = await signUp({
        name: "Ananya R.",
        password: "newpass99",
      });
      assert.deepEqual(answer, { email: EMAIL, otpSent: true });
      assert.equal(await User.countDocuments({ email: EMAIL }), 1);
      const user = await User.findOne({ email: EMAIL })
        .select("+passwordHash")
        .lean();
      assert.equal(user.name, "Ananya R.");
      assert.ok(await bcrypt.compare("newpass99", user.passwordHash));
      assert.equal(mailsTo(EMAIL).length, 2);

      const secondCode = codeFor(EMAIL);
      if (secondCode !== firstCode)
        assertError(
          await failure(verifyOtp({ email: EMAIL, otp: firstCode })),
          400,
          "INVALID_OTP",
        );
      await verifyOtp({ email: EMAIL, otp: secondCode });
      assert.equal(
        await AuditLog.countDocuments({ action: "user.registered" }),
        1,
      );
    });

    test("re-registering someone's unverified email can't take the account over when they verify", async () => {
      const owner = await registerService({
        name: "Ananya Rao",
        email: EMAIL,
        password: "ownerpass1",
      });
      // Someone else, in another browser, before the owner has entered the code.
      await registerService({
        name: "Mallory",
        email: EMAIL,
        password: "attacker1",
      });
      // The owner enters the newest code from their inbox.
      const err = await failure(
        verifyOtpService(
          { email: EMAIL, otp: codeFor(EMAIL) },
          { signupProof: owner.signupProof },
        ),
      );
      assertError(err, 400, "INVALID_OTP");
      assert.match(err.message, /sign up again/i);
      assert.equal(
        (await User.findOne({ email: EMAIL }).lean()).emailVerified,
        false,
      );

      // The owner signs up again here, and the account ends up with their password.
      const again = await registerService({
        name: "Ananya Rao",
        email: EMAIL,
        password: "ownerpass1",
      });
      await verifyOtpService(
        { email: EMAIL, otp: codeFor(EMAIL) },
        { signupProof: again.signupProof },
      );
      assertError(
        await failure(loginService({ email: EMAIL, password: "attacker1" })),
        401,
        "INVALID_CREDENTIALS",
      );
      assert.ok(
        (await loginService({ email: EMAIL, password: "ownerpass1" }))
          .accessToken,
      );
    });

    test("a code entered in a browser that didn't sign up is refused; signing in there makes it work", async () => {
      await signUp();
      browser.clear(); // another browser
      assertError(
        await failure(verifyOtp({ email: EMAIL, otp: codeFor(EMAIL) })),
        400,
        "INVALID_OTP",
      );
      assertError(
        await failure(login({ email: EMAIL, password: PASSWORD })),
        403,
        "EMAIL_NOT_VERIFIED",
      );
      const { user } = await verifyOtp({ email: EMAIL, otp: codeFor(EMAIL) });
      assert.equal(user.emailVerified, true);
    });

    test("Redis down is 503 SERVICE_UNAVAILABLE, before any account is created", async () => {
      useRedisClient(redisDown());
      assertError(await failure(signUp()), 503, "SERVICE_UNAVAILABLE");
      assert.equal(await User.countDocuments({ email: EMAIL }), 0);
      assert.ok(warnings.length > 0);
    });
  });

  describe("email hints (architecture.md §8)", () => {
    test("roll-number addresses give year, level, branch and serial; others give none", () => {
      assert.deepEqual(emailHints("2024ugcs999@nitjsr.ac.in"), {
        year: 2024,
        level: "ug",
        branch: "cs",
        serial: "999",
      });
      assert.deepEqual(emailHints("2023pgcese01@nitjsr.ac.in"), {
        year: 2023,
        level: "pg",
        branch: "cese",
        serial: "01",
      });
      assert.deepEqual(emailHints("2022RSEC012@nitjsr.ac.in"), {
        year: 2022,
        level: "rs",
        branch: "ec",
        serial: "012",
      });
      for (const email of [
        "firstname.dept@nitjsr.ac.in",
        "2024mcacs001@nitjsr.ac.in",
        "2024ugcs1@nitjsr.ac.in",
        "1999ugcs999@nitjsr.ac.in",
        "2024ugcs999@example.edu",
      ])
        assert.equal(emailHints(email), null, email);
    });

    test("a faculty-style address registers with no hints", async () => {
      await signUp({ email: "meera.iyer@nitjsr.ac.in" });
      const { user } = await verifyOtp({
        email: "meera.iyer@nitjsr.ac.in",
        otp: codeFor("meera.iyer@nitjsr.ac.in"),
      });
      assert.equal(user.emailHints, null);
      const stored = await User.findOne({
        email: "meera.iyer@nitjsr.ac.in",
      }).lean();
      assert.equal(stored.emailHints?.year, undefined);
    });
  });

  describe("verify-otp", () => {
    test("the right code verifies the email, signs in and is used up", async () => {
      await signUp();
      const code = codeFor(EMAIL);
      const session = await verifyOtp({
        email: ` ${EMAIL.toUpperCase()}`,
        otp: code,
      });

      const user = await User.findOne({ email: EMAIL }).lean();
      assert.equal(user.emailVerified, true);
      assert.equal(session.user._id, String(user._id));
      assert.equal(session.user.emailVerified, true);
      assert.deepEqual(session.user.emailHints, {
        year: 2024,
        level: "ug",
        branch: "cs",
        serial: "999",
      });

      const access = jwt.verify(session.accessToken, "test-access-secret");
      assert.equal(access.sub, String(user._id));
      assert.equal(access.verified, false, "the ID card isn't approved yet");
      const refresh = jwt.verify(session.refreshToken, "test-refresh-secret");
      assert.equal(refresh.sub, String(user._id));
      assert.equal(refresh.exp - refresh.iat, TTL.refreshTokenSeconds);
      // The sign-in starts a family whose current jti is this token's.
      assert.equal(
        await redis.get(keys.refreshFamily(user._id, refresh.fam)),
        refresh.jti,
      );

      assert.equal(await redis.exists(keys.otp(EMAIL)), 0);
      assert.equal(await redis.exists(keys.otpTries(EMAIL)), 0);
      const again = await failure(verifyOtp({ email: EMAIL, otp: code }));
      assertError(again, 400, "INVALID_OTP");
      assert.match(again.message, /expired or was already used/);
    });

    test("wrong codes count down, and the 5th wrong try deletes the code", async () => {
      await signUp();
      const code = codeFor(EMAIL);
      const messages = [];
      for (let i = 0; i < 5; i++) {
        const err = await failure(
          verifyOtp({ email: EMAIL, otp: wrongCode(code) }),
        );
        assertError(err, 400, "INVALID_OTP");
        messages.push(err.message);
      }
      assert.deepEqual(messages, [
        "That code is wrong. You have 4 tries left.",
        "That code is wrong. You have 3 tries left.",
        "That code is wrong. You have 2 tries left.",
        "That code is wrong. You have 1 try left.",
        "That code is wrong, and it can't be used any more. Request a new code.",
      ]);
      assert.equal(await redis.exists(keys.otp(EMAIL)), 0);
      const late = await failure(verifyOtp({ email: EMAIL, otp: code }));
      assertError(late, 400, "INVALID_OTP");
      assert.equal(
        late.message,
        "This code has expired or was already used. Request a new code.",
      );
      assert.equal(
        (await User.findOne({ email: EMAIL }).lean()).emailVerified,
        false,
      );
    });

    test("a new code resets the count of wrong tries", async () => {
      await signUp();
      for (let i = 0; i < 4; i++)
        await failure(
          verifyOtp({ email: EMAIL, otp: wrongCode(codeFor(EMAIL)) }),
        );
      await resent(EMAIL);
      const err = await failure(
        verifyOtp({ email: EMAIL, otp: wrongCode(codeFor(EMAIL)) }),
      );
      assert.equal(err.message, "That code is wrong. You have 4 tries left.");
      await verifyOtp({ email: EMAIL, otp: codeFor(EMAIL) });
    });

    test("an expired code is refused", async () => {
      await signUp();
      await redis.pexpire(keys.otp(EMAIL), 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const err = await failure(
        verifyOtp({ email: EMAIL, otp: codeFor(EMAIL) }),
      );
      assertError(err, 400, "INVALID_OTP");
      assert.match(err.message, /expired/);
    });

    test("an address with no account reads like any wrong code, and the format is checked", async () => {
      assertError(
        await failure(
          verifyOtp({ email: "nobody@nitjsr.ac.in", otp: "123456" }),
        ),
        400,
        "INVALID_OTP",
      );
      for (const otp of ["12345", "1234567", "12a456", 123456, undefined]) {
        const err = await failure(verifyOtp({ email: EMAIL, otp }));
        assertError(err, 400, "VALIDATION_ERROR");
        assert.deepEqual(
          err.details.map((d) => d.path),
          ["otp"],
          String(otp),
        );
      }
    });

    test("Redis down is 503", async () => {
      await signUp();
      useRedisClient(redisDown());
      assertError(
        await failure(verifyOtp({ email: EMAIL, otp: "123456" })),
        503,
        "SERVICE_UNAVAILABLE",
      );
    });
  });

  describe("resend-otp", () => {
    test("answers the same for unknown, verified and unverified addresses; only the unverified one gets a code", async () => {
      await signUp();
      const firstCode = codeFor(EMAIL);
      await account("verified1@nitjsr.ac.in");
      const answers = [];
      answers.push(await resent(EMAIL));
      for (const email of ["nobody@nitjsr.ac.in", "verified1@nitjsr.ac.in"])
        answers.push(await resendOtp({ email }));
      for (const answer of answers)
        assert.deepEqual(answer, { sent: true, retryAfter: 60 });
      assert.deepEqual(
        mails.map((m) => m.to),
        [EMAIL, EMAIL],
      );
      assert.equal(await redis.exists(keys.otp("nobody@nitjsr.ac.in")), 0);
      assert.equal(await redis.exists(keys.otp("verified1@nitjsr.ac.in")), 0);
      const secondCode = codeFor(EMAIL);
      if (secondCode !== firstCode)
        assertError(
          await failure(verifyOtp({ email: EMAIL, otp: firstCode })),
          400,
          "INVALID_OTP",
        );
    });

    test("answers before the code is issued, so its timing doesn't single out unverified accounts", async () => {
      await signUp();
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      useRedisClient(
        new Proxy(redis, {
          get(target, prop) {
            if (prop === "otpIssue")
              return async (...args) => {
                await held;
                return target.otpIssue(...args);
              };
            const value = target[prop];
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      );
      const answer = await Promise.race([
        resendOtp({ email: EMAIL }),
        new Promise((resolve) =>
          setTimeout(() => resolve("still waiting on Redis"), 500),
        ),
      ]);
      assert.deepEqual(answer, { sent: true, retryAfter: 60 });
      assert.equal(mailsTo(EMAIL).length, 1, "only the sign-up code so far");
      release();
      await waitFor(() => mailsTo(EMAIL).length === 2, "the resent code");
    });

    test("Redis down is 503 for every address, so an outage reveals nothing either", async () => {
      await signUp();
      useRedisClient(redisDown());
      for (const email of [EMAIL, "nobody@nitjsr.ac.in"])
        assertError(
          await failure(resendOtp({ email })),
          503,
          "SERVICE_UNAVAILABLE",
        );
    });
  });

  describe("login", () => {
    test("a verified account signs in with the user view, never the password hash", async () => {
      await account(EMAIL, PASSWORD, {
        department: f.cse._id,
        memberType: "ug",
        verification: { status: "approved", idCardPublicId: "secret-card" },
        managedOrgUnits: [f.dic._id],
        roles: ["member", "manager"],
      });
      const session = await login({
        email: EMAIL.toUpperCase(),
        password: PASSWORD,
      });
      assert.deepEqual(Object.keys(session).sort(), [
        "accessToken",
        "refreshToken",
        "user",
      ]);
      const { user } = session;
      assert.deepEqual(user.department, {
        _id: String(f.cse._id),
        code: "cse",
        name: "Computer Science and Engineering",
      });
      assert.deepEqual(user.managedOrgUnits, [String(f.dic._id)]);
      assert.deepEqual(user.verification, {
        status: "approved",
        reason: null,
        submittedAt: null,
      });
      assert.deepEqual(Object.keys(user).sort(), [
        "_id",
        "department",
        "email",
        "emailHints",
        "emailVerified",
        "managedOrgUnits",
        "memberType",
        "name",
        "roles",
        "strikes",
        "suspendedUntil",
        "suspensionReason",
        "verification",
      ]);
      const text = JSON.stringify(session);
      assert.equal(text.includes("passwordHash"), false);
      assert.equal(text.includes("secret-card"), false);
      const access = jwt.verify(session.accessToken, "test-access-secret");
      assert.equal(access.verified, true);
      assert.deepEqual(access.managedOrgUnits, [String(f.dic._id)]);
      assert.equal(access.memberType, "ug");
    });

    test("an unknown email and a wrong password are the same 401 INVALID_CREDENTIALS", async () => {
      await account(EMAIL);
      const unknown = await failure(
        login({ email: "nobody@nitjsr.ac.in", password: PASSWORD }),
      );
      const wrong = await failure(
        login({ email: EMAIL, password: "wrong-password1" }),
      );
      const tooLong = await failure(
        login({ email: EMAIL, password: `${PASSWORD}${"é".repeat(40)}` }),
      );
      for (const err of [unknown, wrong, tooLong]) {
        assertError(err, 401, "INVALID_CREDENTIALS");
        assert.equal(err.message, unknown.message);
      }
      assert.notEqual(
        unknown.code,
        "UNAUTHENTICATED",
        "the client refreshes only on UNAUTHENTICATED",
      );
    });

    test("a row with an unreadable hash is a mismatch, not a 500", async () => {
      // The fixtures' users carry a placeholder hash.
      process.env.DEMO_MODE = "true";
      const err = await failure(
        login({ email: f.student.email, password: PASSWORD }),
      );
      assertError(err, 401, "INVALID_CREDENTIALS");
    });

    test("the right password on an unverified email is 403 EMAIL_NOT_VERIFIED with a fresh code", async () => {
      await signUp();
      // The code from sign-up is more than a minute old.
      await redis.expire(keys.otp(EMAIL), TTL.otpSeconds - 61);
      const oldCode = codeFor(EMAIL);
      const err = await failure(login({ email: EMAIL, password: PASSWORD }));
      assertError(err, 403, "EMAIL_NOT_VERIFIED");
      assert.deepEqual(err.details, { email: EMAIL });
      assert.equal(mailsTo(EMAIL).length, 2);
      const newCode = codeFor(EMAIL);
      if (newCode !== oldCode)
        assertError(
          await failure(verifyOtp({ email: EMAIL, otp: oldCode })),
          400,
          "INVALID_OTP",
        );
      await verifyOtp({ email: EMAIL, otp: newCode });
      assert.ok(
        (await login({ email: EMAIL, password: PASSWORD })).accessToken,
      );
    });

    test("within a minute of the last code, login doesn't replace it, so the email being read still works", async () => {
      await signUp();
      const code = codeFor(EMAIL);
      assertError(
        await failure(login({ email: EMAIL, password: PASSWORD })),
        403,
        "EMAIL_NOT_VERIFIED",
      );
      assert.equal(mailsTo(EMAIL).length, 1);
      await verifyOtp({ email: EMAIL, otp: code });
    });

    test("a wrong password on an unverified email is INVALID_CREDENTIALS and sends nothing", async () => {
      await signUp();
      await redis.del(keys.otp(EMAIL));
      assertError(
        await failure(login({ email: EMAIL, password: "wrong-password1" })),
        401,
        "INVALID_CREDENTIALS",
      );
      assert.equal(mailsTo(EMAIL).length, 1);
    });

    test("demo accounts can log in only while DEMO_MODE is true", async () => {
      const demo = "judge@demo.campuscommons.test";
      await account(demo);
      const off = await failure(login({ email: demo, password: PASSWORD }));
      assertError(off, 400, "VALIDATION_ERROR");
      assert.deepEqual(off.details, [
        { path: "email", message: "Demo accounts are switched off." },
      ]);
      process.env.DEMO_MODE = "1";
      assertError(
        await failure(login({ email: demo, password: PASSWORD })),
        400,
        "VALIDATION_ERROR",
      );
      process.env.DEMO_MODE = "true";
      assert.equal(
        (await login({ email: demo, password: PASSWORD })).user.email,
        demo,
      );
    });

    test("missing fields are 400 VALIDATION_ERROR", async () => {
      const err = await failure(login({}));
      assertError(err, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        err.details.map((d) => d.path),
        ["email", "password"],
      );
      assert.deepEqual(
        (await failure(login({ email: EMAIL, password: "x".repeat(73) })))
          .details,
        [{ path: "password", message: "Can be at most 72 characters." }],
      );
      assertError(await failure(login(null)), 400, "VALIDATION_ERROR");
    });
  });

  describe("sessions", () => {
    test("refresh rotates: the family's current jti moves on, and the session stays one Redis key", async () => {
      const first = await signedUp();
      const userId = first.user._id;
      const second = await refreshSession(first.refreshToken);
      assert.notEqual(second.refreshToken, first.refreshToken);
      assert.equal(second.user._id, userId);
      const old = jwt.decode(first.refreshToken);
      const next = jwt.decode(second.refreshToken);
      assert.equal(next.fam, old.fam);
      assert.notEqual(next.jti, old.jti);
      const family = keys.refreshFamily(userId, old.fam);
      assert.equal((await redis.get(family)).split(" ")[0], next.jti);
      assert.ok((await redis.ttl(family)) > TTL.refreshTokenSeconds - 5);
      const third = await refreshSession(second.refreshToken);
      assert.equal(
        (await redis.get(family)).split(" ")[0],
        jwt.decode(third.refreshToken).jti,
      );
      assert.deepEqual(await refreshKeys(userId), [family]);
    });

    test("refresh re-reads the user, so new roles and an approved ID card show in the token", async () => {
      const first = await signedUp();
      await User.updateOne(
        { _id: first.user._id },
        {
          roles: ["member", "manager"],
          managedOrgUnits: [f.dic._id],
          "verification.status": "approved",
        },
      );
      const { accessToken } = await refreshSession(first.refreshToken);
      const claims = jwt.decode(accessToken);
      assert.deepEqual(claims.roles, ["member", "manager"]);
      assert.deepEqual(claims.managedOrgUnits, [String(f.dic._id)]);
      assert.equal(claims.verified, true);
    });

    test("reusing a rotated token after the grace window ends that session, and only that one", async () => {
      const laptop = await signedUp();
      const userId = laptop.user._id;
      const phone = await login({ email: EMAIL, password: PASSWORD });
      await account("2024ugcs111@nitjsr.ac.in");
      const other = await login({
        email: "2024ugcs111@nitjsr.ac.in",
        password: PASSWORD,
      });
      const rotated = await refreshSession(laptop.refreshToken);
      assert.equal((await refreshKeys(userId)).length, 2);

      const later = aMinuteLater();
      const err = await failure(refreshSession(laptop.refreshToken, later));
      assertError(err, 401, "UNAUTHENTICATED");
      assertError(
        await failure(refreshSession(rotated.refreshToken, later)),
        401,
        "UNAUTHENTICATED",
      );
      assert.ok(
        warnings.some(([ctx]) => ctx?.event === "auth.refresh.reuse_detected"),
      );
      // The same user's phone, and someone else, stay signed in.
      assert.ok((await refreshSession(phone.refreshToken, later)).accessToken);
      assert.ok((await refreshSession(other.refreshToken, later)).accessToken);
      assert.equal((await refreshKeys(userId)).length, 1);
    });

    test("two refreshes with one token at once (two tabs, or a reload mid-refresh) both get the current token", async () => {
      const first = await signedUp();
      const [a, b] = await Promise.all([
        refreshSession(first.refreshToken),
        refreshSession(first.refreshToken),
      ]);
      const current = jwt.decode(a.refreshToken).jti;
      assert.equal(jwt.decode(b.refreshToken).jti, current);
      // A reload whose answer never reached the browser sends the old cookie again.
      const replay = await refreshSession(first.refreshToken);
      assert.equal(jwt.decode(replay.refreshToken).jti, current);
      // Whichever cookie the browser kept goes on working.
      assert.ok((await refreshSession(b.refreshToken)).accessToken);
      assert.equal(
        warnings.some(([ctx]) => ctx?.event === "auth.refresh.reuse_detected"),
        false,
      );
    });

    test("a refresh that fails on MongoDB leaves the token usable for the retry", async (t) => {
      const session = await signedUp();
      const findOne = t.mock.method(User, "findOne");
      findOne.mock.mockImplementationOnce(() => {
        throw new Error(
          "Operation `users.findOne()` buffering timed out after 10000ms",
        );
      });
      await assert.rejects(
        refreshSession(session.refreshToken),
        /buffering timed out/,
      );
      findOne.mock.restore();
      // Past the grace window, so only an untouched token gets through.
      assert.ok(
        (await refreshSession(session.refreshToken, aMinuteLater()))
          .accessToken,
      );
    });

    test("missing, forged, expired and access tokens are 401 UNAUTHENTICATED", async () => {
      const { user, accessToken } = await signedUp();
      const expired = jwt.sign(
        {
          jti: "0b5d3c1e-aaaa-bbbb-cccc-000000000000",
          exp: Math.floor(Date.now() / 1000) - 10,
        },
        "test-refresh-secret",
        { subject: user._id },
      );
      const forged = jwt.sign(
        { jti: "0b5d3c1e-aaaa-bbbb-cccc-000000000001" },
        "not-the-secret",
        {
          subject: user._id,
        },
      );
      for (const token of [
        undefined,
        "",
        "garbage",
        expired,
        forged,
        accessToken,
      ])
        assertError(
          await failure(refreshSession(token)),
          401,
          "UNAUTHENTICATED",
        );
    });

    test("a deleted account can't refresh", async () => {
      const session = await signedUp();
      await User.deleteOne({ _id: session.user._id });
      assertError(
        await failure(refreshSession(session.refreshToken)),
        401,
        "UNAUTHENTICATED",
      );
    });

    test("Redis down during refresh is 503, not a sign-out", async () => {
      const session = await signedUp();
      useRedisClient(redisDown());
      assertError(
        await failure(refreshSession(session.refreshToken)),
        503,
        "SERVICE_UNAVAILABLE",
      );
      useRedisClient(redis);
      assert.ok((await refreshSession(session.refreshToken)).accessToken);
    });

    test("if Redis can't store the jti, the session comes without a refresh token and a warning is logged", async () => {
      await account(EMAIL);
      useRedisClient(redisFailing("set"));
      const session = await login({ email: EMAIL, password: PASSWORD });
      assert.ok(jwt.verify(session.accessToken, "test-access-secret"));
      assert.equal(session.refreshToken, null);
      assert.ok(
        warnings.some(([, message]) =>
          /without the refresh cookie/.test(message),
        ),
      );
    });

    test("logout forgets the token, and never fails", async () => {
      const session = await signedUp();
      assert.deepEqual(await logout(session.refreshToken), { loggedOut: true });
      assert.deepEqual(await refreshKeys(session.user._id), []);
      assertError(
        await failure(refreshSession(session.refreshToken)),
        401,
        "UNAUTHENTICATED",
      );
      for (const token of [undefined, "garbage", session.accessToken])
        assert.deepEqual(await logout(token), { loggedOut: true });
      useRedisClient(redisDown());
      const again = await login({ email: EMAIL, password: PASSWORD }).catch(
        (e) => e,
      );
      assert.ok(
        again.accessToken,
        "login still works without Redis, minus the cookie",
      );
      assert.deepEqual(await logout(session.refreshToken), { loggedOut: true });
    });

    test("getMe returns the user view; a deleted account is 401", async () => {
      const { user } = await signedUp();
      const me = await getMe(user._id);
      assert.deepEqual(me, user);
      await User.deleteOne({ _id: user._id });
      assertError(await failure(getMe(user._id)), 401, "UNAUTHENTICATED");
    });
  });

  describe("demo", () => {
    test("demo-config lists the roles only while DEMO_MODE is true", () => {
      assert.deepEqual(demoConfig(), { demoMode: false, roles: [] });
      process.env.DEMO_MODE = "true";
      assert.deepEqual(demoConfig(), {
        demoMode: true,
        roles: ["student", "student2", "faculty", "manager", "admin"],
      });
    });

    test("demo-login is 404 while DEMO_MODE is off, whatever the role", async () => {
      for (const role of ["student", "nope", undefined])
        assertError(await failure(demoLogin({ role })), 404, "NOT_FOUND");
    });

    test("demo-login signs in as the seeded user for the role", async () => {
      process.env.DEMO_MODE = "true";
      const session = await demoLogin({ role: "manager" });
      assert.equal(session.user._id, String(f.manager._id));
      assert.equal(session.user.email, "manager@demo.campuscommons.test");
      assert.deepEqual(jwt.decode(session.accessToken).roles, [
        "member",
        "manager",
      ]);
      const refresh = jwt.decode(session.refreshToken);
      assert.equal(
        await redis.get(keys.refreshFamily(f.manager._id, refresh.fam)),
        refresh.jti,
      );
    });

    test("judges share a demo account: one replaying an old token doesn't sign out the others", async () => {
      process.env.DEMO_MODE = "true";
      const judge = await demoLogin({ role: "admin" });
      const visitor = await demoLogin({ role: "admin" });
      await refreshSession(visitor.refreshToken);
      assertError(
        await failure(refreshSession(visitor.refreshToken, aMinuteLater())),
        401,
        "UNAUTHENTICATED",
      );
      assert.ok(
        (await refreshSession(judge.refreshToken, aMinuteLater())).accessToken,
      );
    });

    test("turning DEMO_MODE off ends demo sessions: refresh and getMe are 401, and they don't come back", async () => {
      const session = await demoUserSession();
      assertError(
        await failure(refreshSession(session.refreshToken)),
        401,
        "UNAUTHENTICATED",
      );
      assertError(
        await failure(getMe(session.user._id)),
        401,
        "UNAUTHENTICATED",
      );
      assert.deepEqual(await refreshKeys(session.user._id), []);
      process.env.DEMO_MODE = "true";
      assertError(
        await failure(refreshSession(session.refreshToken)),
        401,
        "UNAUTHENTICATED",
      );
      assert.ok((await getMe(session.user._id)).email);
    });

    test("an unknown role is 400; a role whose user isn't seeded is 404 pointing to the seed", async () => {
      process.env.DEMO_MODE = "true";
      const unknown = await failure(demoLogin({ role: "superuser" }));
      assertError(unknown, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        unknown.details.map((d) => d.path),
        ["role"],
      );
      // fixtures.js seeds no faculty@ user.
      const missing = await failure(demoLogin({ role: "faculty" }));
      assertError(missing, 404, "NOT_FOUND");
      assert.match(missing.message, /Run npm run seed/);
    });
  });
});

async function demoUserSession() {
  process.env.DEMO_MODE = "true";
  try {
    return await demoLogin({ role: "student" });
  } finally {
    delete process.env.DEMO_MODE;
  }
}
