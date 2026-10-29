// /api/v1/auth over HTTP (architecture.md §6 Auth, §7.1, §11): the whole app on port 0, a real MongoDB
// through fixtures.js (skipped without TEST_MONGODB_URI), ioredis-mock, and a capturing mail transport.
// The browser's part is played by hand: the refresh cookie is read from Set-Cookie and sent back.
import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import bcrypt from "bcryptjs";
import app from "../../src/app.js";
import { useMailTransport } from "../../src/config/mailer.js";
import { useRedisClient } from "../../src/config/redis.js";
import logger from "../../src/lib/logger.js";
import { TTL, keys } from "../../src/lib/redisKeys.js";
import { OTP_EMAIL_CAP } from "../../src/middleware/rateLimit.js";
import { User } from "../../src/models/index.js";
import { redis, skip, useTestDatabase } from "../integration/fixtures.js";

logger.level = "silent";
process.env.ACCESS_TOKEN_SECRET = "test-access-secret";
process.env.REFRESH_TOKEN_SECRET = "test-refresh-secret";
process.env.OTP_PEPPER = "test-pepper";

const mails = [];
useMailTransport({ sendMail: async (message) => mails.push(message) });

const EMAIL = "2024ugcs999@nitjsr.ac.in";
const PASSWORD = "printer2024";

let f; // fixtures, rebuilt for every test
let server;
let origin;

// The browser's signupProof cookie, kept from Set-Cookie and sent back like a browser would. The
// refresh cookie is passed by hand, so tests can replay old ones.
let signupProof = null;

// → { status, body, cookie (the refreshToken Set-Cookie line, if any), headers }. `from` plays a client
// at that address behind Render's proxy (X-Forwarded-For); otherwise every request comes from 127.0.0.1.
async function call(method, path, { body, cookie, token, from } = {}) {
  const headers = {};
  if (from) headers["x-forwarded-for"] = from;
  if (body !== undefined) headers["content-type"] = "application/json";
  const cookies = [
    cookie && `refreshToken=${cookie}`,
    signupProof && `signupProof=${signupProof}`,
  ].filter(Boolean);
  if (cookies.length) headers.cookie = cookies.join("; ");
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${origin}/api/v1/auth${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies = res.headers.getSetCookie();
  const proof = setCookies.find((line) => line.startsWith("signupProof="));
  if (proof) signupProof = /^signupProof=([^;]*)/.exec(proof)[1] || null;
  return {
    status: res.status,
    body: await res.json(),
    cookie: setCookies.find((line) => line.startsWith("refreshToken=")),
    proofCookie: proof,
    headers: res.headers,
  };
}

const post = (path, body, options) => call("POST", path, { body, ...options });
const cookieValue = (line) => /^refreshToken=([^;]*)/.exec(line)[1];
const isCleared = (line) =>
  /^refreshToken=;/.test(line) && /Expires=Thu, 01 Jan 1970/.test(line);
const codeFor = (email) =>
  /\b(\d{6})\b/.exec(mails.filter((m) => m.to === email).at(-1).text)[1];

async function account(email = EMAIL, extra = {}) {
  return User.create({
    name: "Kabir Singh",
    email,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    emailVerified: true,
    ...extra,
  });
}

function assertEnvelopeError(res, status, code) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, code);
  assert.ok(res.body.requestId);
}

// Today's code emails, all used up: sent in the last hour, so a slot frees in 23 hours.
async function useUpCodeEmails() {
  const at = Date.now() - 60 * 60_000;
  const members = [];
  for (let i = 0; i < OTP_EMAIL_CAP.limit; i++)
    members.push(at + i, `sent-${i}`);
  await redis.zadd(keys.otpEmailLog, ...members);
}

const redisDown = () =>
  new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error("Connection is closed.");
      },
    },
  );

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

describe("/api/v1/auth", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  before(async () => {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.close();
    await once(server, "close");
  });

  beforeEach(() => {
    mails.length = 0;
    signupProof = null;
    delete process.env.DEMO_MODE;
    delete process.env.NODE_ENV;
  });

  test("the cookie flow end to end: register → verify → me → refresh → reuse → login → logout", async () => {
    const registered = await post("/register", {
      name: "Ananya Rao",
      email: "2024UGCS999@nitjsr.ac.in",
      password: PASSWORD,
    });
    assert.equal(registered.status, 201);
    assert.deepEqual(registered.body, {
      success: true,
      data: { email: EMAIL, otpSent: true },
      requestId: registered.headers.get("x-request-id"),
    });
    assert.equal(registered.cookie, undefined);
    // The sign-up proof: httpOnly, SameSite=Strict, scoped like the refresh cookie.
    assert.match(registered.proofCookie, /; HttpOnly/);
    assert.match(registered.proofCookie, /; SameSite=Strict/);
    assert.match(registered.proofCookie, /; Path=\/api\/v1\/auth(;|$)/);
    assert.equal(
      JSON.stringify(registered.body).includes("signupProof"),
      false,
    );

    const verified = await post("/verify-otp", {
      email: EMAIL,
      otp: codeFor(EMAIL),
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.success, true);
    assert.deepEqual(Object.keys(verified.body.data).sort(), [
      "accessToken",
      "user",
    ]);
    assert.equal(verified.body.data.user.email, EMAIL);
    assert.equal(verified.body.data.user.emailVerified, true);
    assert.equal(verified.headers.get("cache-control"), "no-store");
    assert.match(verified.proofCookie, /Expires=Thu, 01 Jan 1970/);
    // architecture.md §7.1 / §16: httpOnly, SameSite=Strict, scoped to the auth routes, 7 days.
    assert.match(verified.cookie, /; HttpOnly/);
    assert.match(verified.cookie, /; SameSite=Strict/);
    assert.match(verified.cookie, /; Path=\/api\/v1\/auth(;|$)/);
    assert.match(verified.cookie, /; Max-Age=604800/);
    assert.doesNotMatch(
      verified.cookie,
      /; Secure/,
      "plain http outside production",
    );
    const firstCookie = cookieValue(verified.cookie);

    assertEnvelopeError(await call("GET", "/me"), 401, "UNAUTHENTICATED");
    const me = await call("GET", "/me", {
      token: verified.body.data.accessToken,
    });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.data, verified.body.data.user);

    const noCookie = await post("/refresh");
    assertEnvelopeError(noCookie, 401, "UNAUTHENTICATED");
    assert.ok(isCleared(noCookie.cookie), noCookie.cookie);

    const refreshed = await post("/refresh", undefined, {
      cookie: firstCookie,
    });
    assert.equal(refreshed.status, 200);
    const secondCookie = cookieValue(refreshed.cookie);
    assert.notEqual(secondCookie, firstCookie);
    assert.equal(refreshed.body.data.user._id, verified.body.data.user._id);
    const meAgain = await call("GET", "/me", {
      token: refreshed.body.data.accessToken,
    });
    assert.equal(meAgain.status, 200);

    // The first cookie again, at once: another tab, or a reload that lost the answer. It gets the
    // session's current token instead of a sign-out.
    const otherTab = await post("/refresh", undefined, { cookie: firstCookie });
    assert.equal(otherTab.status, 200);
    assert.equal(otherTab.body.data.user._id, verified.body.data.user._id);

    // A minute later it is reuse: cleared, and the rotated one is revoked with it.
    mock.timers.enable({ apis: ["Date"], now: Date.now() + 60_000 });
    try {
      const reused = await post("/refresh", undefined, { cookie: firstCookie });
      assertEnvelopeError(reused, 401, "UNAUTHENTICATED");
      assert.ok(isCleared(reused.cookie));
      assertEnvelopeError(
        await post("/refresh", undefined, { cookie: secondCookie }),
        401,
        "UNAUTHENTICATED",
      );
    } finally {
      mock.timers.reset();
    }

    const loggedIn = await post("/login", { email: EMAIL, password: PASSWORD });
    assert.equal(loggedIn.status, 200);
    const loginCookie = cookieValue(loggedIn.cookie);
    // Logout needs no access token.
    const loggedOut = await post("/logout", undefined, { cookie: loginCookie });
    assert.equal(loggedOut.status, 200);
    assert.deepEqual(loggedOut.body.data, { loggedOut: true });
    assert.ok(isCleared(loggedOut.cookie));
    assertEnvelopeError(
      await post("/refresh", undefined, { cookie: loginCookie }),
      401,
      "UNAUTHENTICATED",
    );
    const again = await post("/logout");
    assert.equal(again.status, 200);
    assert.ok(isCleared(again.cookie));
  });

  test("the cookie is Secure in production", async () => {
    process.env.DEMO_MODE = "true";
    process.env.NODE_ENV = "production";
    const res = await post("/demo-login", { role: "student" });
    assert.equal(res.status, 200);
    assert.match(res.cookie, /; Secure/);
  });

  test("bodies are checked before the rate limiter: 400 with field details, never the limiter's 500", async () => {
    process.env.DEMO_MODE = "true";
    const cases = [
      ["/register", {}, ["name", "email", "password"]],
      ["/register", undefined, ["name", "email", "password"]],
      ["/verify-otp", { email: EMAIL }, ["otp"]],
      ["/resend-otp", { email: 42 }, ["email"]],
      ["/login", { username: "not-a-user", password: "x" }, ["email"]],
      ["/demo-login", {}, ["role"]],
    ];
    for (const [path, body, fields] of cases) {
      const res = await post(path, body);
      assertEnvelopeError(res, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        res.body.error.details.map((d) => d.path),
        fields,
        path,
      );
    }
  });

  test("typos don't use up register's 3 attempts an hour, but a 4th real sign-up for one email is 429", async () => {
    for (let i = 0; i < 4; i++)
      assertEnvelopeError(
        await post("/register", {
          name: "Ananya Rao",
          email: EMAIL,
          password: "no-digits",
        }),
        400,
        "VALIDATION_ERROR",
      );
    const emails = [EMAIL, EMAIL.toUpperCase(), ` ${EMAIL}`];
    for (const email of emails) {
      const res = await post("/register", {
        name: "Ananya Rao",
        email,
        password: PASSWORD,
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
    }
    const limited = await post("/register", {
      name: "Ananya Rao",
      email: EMAIL,
      password: PASSWORD,
    });
    assertEnvelopeError(limited, 429, "RATE_LIMITED");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    const other = await post("/register", {
      name: "Kabir Singh",
      email: "2024ugcs111@nitjsr.ac.in",
      password: PASSWORD,
    });
    assert.equal(other.status, 201);
  });

  test("register: domain check and 409 EMAIL_TAKEN", async () => {
    const outside = await post("/register", {
      name: "Ananya Rao",
      email: "ananya@gmail.com",
      password: PASSWORD,
    });
    assertEnvelopeError(outside, 400, "VALIDATION_ERROR");
    assert.match(outside.body.error.details[0].message, /@nitjsr\.ac\.in/);
    await account();
    assertEnvelopeError(
      await post("/register", {
        name: "Ananya Rao",
        email: EMAIL,
        password: PASSWORD,
      }),
      409,
      "EMAIL_TAKEN",
    );
  });

  test("login: INVALID_CREDENTIALS (not UNAUTHENTICATED), EMAIL_NOT_VERIFIED, and 5 failures per 15 minutes", async () => {
    await account();
    const wrong = await post("/login", {
      email: EMAIL,
      password: "wrong-pass1",
    });
    const unknown = await post("/login", {
      email: "nobody@nitjsr.ac.in",
      password: PASSWORD,
    });
    for (const res of [wrong, unknown]) {
      assertEnvelopeError(res, 401, "INVALID_CREDENTIALS");
      assert.equal(res.cookie, undefined);
    }
    assert.equal(wrong.body.error.message, unknown.body.error.message);

    for (let i = 0; i < 4; i++)
      await post("/login", { email: EMAIL, password: "wrong-pass1" });
    const locked = await post("/login", { email: EMAIL, password: PASSWORD });
    assertEnvelopeError(locked, 429, "RATE_LIMITED");
    assert.match(locked.body.error.message, /failed login attempts/);

    await post("/register", {
      name: "Meera Iyer",
      email: "meera.iyer@nitjsr.ac.in",
      password: PASSWORD,
    });
    await redis.del("otp:meera.iyer@nitjsr.ac.in"); // the sign-up code has expired
    const unverified = await post("/login", {
      email: "meera.iyer@nitjsr.ac.in",
      password: PASSWORD,
    });
    assertEnvelopeError(unverified, 403, "EMAIL_NOT_VERIFIED");
    assert.equal(
      mails.filter((m) => m.to === "meera.iyer@nitjsr.ac.in").length,
      2,
      "a fresh code was sent",
    );
    const session = await post("/verify-otp", {
      email: "meera.iyer@nitjsr.ac.in",
      otp: codeFor("meera.iyer@nitjsr.ac.in"),
    });
    assert.equal(session.status, 200);
  });

  test("login: the right password on an unverified account isn't counted as a failed attempt", async () => {
    await post("/register", {
      name: "Meera Iyer",
      email: "meera.iyer@nitjsr.ac.in",
      password: PASSWORD,
    });
    const login = async (password) => {
      const res = await post("/login", {
        email: "meera.iyer@nitjsr.ac.in",
        password,
      });
      // The limiter takes the count back once the response has finished.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return res;
    };
    // More than the 5 failures a window allows, and none of them is a 429.
    for (let i = 0; i < 6; i++)
      assertEnvelopeError(await login(PASSWORD), 403, "EMAIL_NOT_VERIFIED");
    // A wrong password still counts: 5 of them, then the 6th attempt of any kind is 429.
    for (let i = 0; i < 5; i++)
      assertEnvelopeError(
        await login("wrong-pass1"),
        401,
        "INVALID_CREDENTIALS",
      );
    assertEnvelopeError(await login(PASSWORD), 429, "RATE_LIMITED");
  });

  test("login emails a code only while resend-otp's tiers allow it, and counts against them", async () => {
    const email = "tara.menon@nitjsr.ac.in";
    await post("/register", { name: "Tara Menon", email, password: PASSWORD });
    const sentTo = () => mails.filter((m) => m.to === email).length;
    // Someone who knows the password signs in every minute and a bit: each time the last code is
    // over a minute old, which used to send another one, with no limit per address.
    const replies = [];
    for (let i = 0; i < 5; i++) {
      await redis.expire(keys.otp(email), TTL.otpSeconds - 61);
      replies.push(await post("/login", { email, password: PASSWORD }));
    }
    for (const res of replies)
      assertEnvelopeError(res, 403, "EMAIL_NOT_VERIFIED");
    // The sign-up's code, then 3 from login: otpSend allows 3 in 15 minutes.
    assert.equal(sentTo(), 4);
    assert.equal(
      replies.at(-1).body.error.message,
      "Verify your email first. Enter the last code we sent to your inbox, or ask for a new one later.",
    );
    // The same counter as resend-otp: it is used up too.
    const resend = await post("/resend-otp", { email });
    assertEnvelopeError(resend, 429, "RATE_LIMITED");
    assert.equal(resend.body.error.details.tier, "otpSend");
    // The last code still works.
    const session = await post("/verify-otp", { email, otp: codeFor(email) });
    assert.equal(session.status, 200);
  });

  test("verify-otp needs this browser's sign-up proof, so re-registering someone's email can't take it over", async () => {
    await post("/register", {
      name: "Ananya Rao",
      email: EMAIL,
      password: PASSWORD,
    });
    const owner = signupProof;
    signupProof = null; // someone else's browser
    assert.equal(
      (
        await post("/register", {
          name: "Mallory",
          email: EMAIL,
          password: "attacker1",
        })
      ).status,
      201,
    );
    signupProof = owner;
    const refused = await post("/verify-otp", {
      email: EMAIL,
      otp: codeFor(EMAIL),
    });
    assertEnvelopeError(refused, 400, "INVALID_OTP");
    assert.equal(refused.cookie, undefined);

    // The owner signs up again here, as the message says, and keeps their own password.
    await post("/register", {
      name: "Ananya Rao",
      email: EMAIL,
      password: PASSWORD,
    });
    const verified = await post("/verify-otp", {
      email: EMAIL,
      otp: codeFor(EMAIL),
    });
    assert.equal(verified.status, 200);
    assertEnvelopeError(
      await post("/login", { email: EMAIL, password: "attacker1" }),
      401,
      "INVALID_CREDENTIALS",
    );
  });

  test("an unverified login with the right password hands this browser the sign-up proof", async () => {
    await post("/register", {
      name: "Ananya Rao",
      email: EMAIL,
      password: PASSWORD,
    });
    signupProof = null; // another browser
    await redis.del(`otp:${EMAIL}`); // the sign-up code has expired
    const unverified = await post("/login", {
      email: EMAIL,
      password: PASSWORD,
    });
    assertEnvelopeError(unverified, 403, "EMAIL_NOT_VERIFIED");
    assert.match(unverified.proofCookie, /; HttpOnly/);
    assert.equal(
      JSON.stringify(unverified.body).includes("signupProof"),
      false,
    );
    const verified = await post("/verify-otp", {
      email: EMAIL,
      otp: codeFor(EMAIL),
    });
    assert.equal(verified.status, 200);
  });

  test("verify-otp: a wrong code says how many tries are left", async () => {
    await post("/register", {
      name: "Ananya Rao",
      email: EMAIL,
      password: PASSWORD,
    });
    const code = codeFor(EMAIL);
    const wrong = await post("/verify-otp", {
      email: EMAIL,
      otp: code === "000000" ? "000001" : "000000",
    });
    assertEnvelopeError(wrong, 400, "INVALID_OTP");
    assert.equal(
      wrong.body.error.message,
      "That code is wrong. You have 4 tries left.",
    );
    assert.equal(wrong.cookie, undefined);
  });

  test("resend-otp: the same answer for every address, limited to 3 per 15 minutes", async () => {
    await account("verified1@nitjsr.ac.in");
    for (const email of ["nobody@nitjsr.ac.in", "verified1@nitjsr.ac.in"]) {
      const res = await post("/resend-otp", { email });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data, { sent: true, retryAfter: 60 });
    }
    assert.equal(mails.length, 0);
    for (let i = 0; i < 2; i++)
      await post("/resend-otp", { email: "nobody@nitjsr.ac.in" });
    assertEnvelopeError(
      await post("/resend-otp", { email: "nobody@nitjsr.ac.in" }),
      429,
      "RATE_LIMITED",
    );
  });

  test("sign-ups from one network stop at the IP ceiling (100 an hour), whichever emails they use", async () => {
    await redis.set("rl:registerIp:127.0.0.1", 100, "PX", 60_000);
    const limited = await post("/register", {
      name: "Ananya Rao",
      email: EMAIL,
      password: PASSWORD,
    });
    assertEnvelopeError(limited, 429, "RATE_LIMITED");
    assert.equal(limited.body.error.details.tier, "registerIp");
    assert.equal(await User.countDocuments({ email: EMAIL }), 0);
    // A student on another network signs up as usual.
    const elsewhere = await post(
      "/register",
      { name: "Ananya Rao", email: EMAIL, password: PASSWORD },
      { from: "198.51.100.20" },
    );
    assert.equal(elsewhere.status, 201);
  });

  test("failed logins from one network stop at the IP ceiling; the right password from elsewhere still works", async () => {
    await account();
    await redis.set("rl:loginIp:127.0.0.1", 100, "PX", 60_000);
    const limited = await post("/login", { email: EMAIL, password: PASSWORD });
    assertEnvelopeError(limited, 429, "RATE_LIMITED");
    assert.equal(limited.body.error.details.tier, "loginIp");
    const elsewhere = await post(
      "/login",
      { email: EMAIL, password: PASSWORD },
      { from: "198.51.100.20" },
    );
    assert.equal(elsewhere.status, 200);
  });

  // One address used to fill the whole day's cap in about 20 seconds: 63 made-up campus sign-ups,
  // then 3 resends each. Now each network gets a share, and everyone else keeps signing up.
  test("each network gets a share of the day's code emails: register, resend-otp and an unverified login all count", async () => {
    const share = "rl:otpSendIp:127.0.0.1";
    await post("/register", {
      name: "Meera Iyer",
      email: "meera.iyer@nitjsr.ac.in",
      password: PASSWORD,
    });
    await post("/resend-otp", { email: "nobody@nitjsr.ac.in" });
    await redis.expire(keys.otp("meera.iyer@nitjsr.ac.in"), TTL.otpSeconds - 61);
    assertEnvelopeError(
      await post("/login", {
        email: "meera.iyer@nitjsr.ac.in",
        password: PASSWORD,
      }),
      403,
      "EMAIL_NOT_VERIFIED",
    );
    assert.equal(Number(await redis.get(share)), 3);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(mails.length, 2, "the sign-up's code and the login's");

    // This network's 50 are used up.
    await redis.incrby(share, 47);
    mails.length = 0;
    const refused = await post("/register", {
      name: "Ananya Rao",
      email: EMAIL,
      password: PASSWORD,
    });
    assertEnvelopeError(refused, 429, "RATE_LIMITED");
    assert.equal(refused.body.error.details.tier, "otpSendIp");
    assert.equal(
      refused.body.error.message,
      "Too many verification codes asked for from your network today. Try again in 1 day.",
    );
    assert.equal(await User.countDocuments({ email: EMAIL }), 0);
    const resend = await post("/resend-otp", { email: "meera.iyer@nitjsr.ac.in" });
    assertEnvelopeError(resend, 429, "RATE_LIMITED");
    assert.equal(resend.body.error.details.tier, "otpSendIp");
    await redis.expire(keys.otp("meera.iyer@nitjsr.ac.in"), TTL.otpSeconds - 61);
    const login = await post("/login", {
      email: "meera.iyer@nitjsr.ac.in",
      password: PASSWORD,
    });
    assertEnvelopeError(login, 403, "EMAIL_NOT_VERIFIED");
    assert.match(login.body.error.message, /ask for a new one later/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(mails.length, 0);
    assert.equal(
      await redis.zcard(keys.otpEmailLog),
      2,
      "nothing refused took a slot of the global cap",
    );

    // A student on another network signs up as usual.
    const elsewhere = await post(
      "/register",
      { name: "Ananya Rao", email: EMAIL, password: PASSWORD },
      { from: "198.51.100.20" },
    );
    assert.equal(elsewhere.status, 201);
  });

  test("once today's code emails are used up, register and resend-otp are 503 and send nothing", async () => {
    await post("/register", {
      name: "Meera Iyer",
      email: "meera.iyer@nitjsr.ac.in",
      password: PASSWORD,
    });
    mails.length = 0;
    await useUpCodeEmails();

    const refused = await post("/register", {
      name: "Ananya Rao",
      email: EMAIL,
      password: PASSWORD,
    });
    assertEnvelopeError(refused, 503, "SERVICE_UNAVAILABLE");
    assert.equal(
      refused.body.error.message,
      "We've reached today's limit for emailing codes, so no code was sent. Try again in 23 hours.",
    );
    assert.ok(refused.body.error.details.retryAfterSeconds > 22 * 3600);
    assert.equal(
      refused.headers.get("retry-after"),
      String(refused.body.error.details.retryAfterSeconds),
    );
    assert.equal(refused.proofCookie, undefined);
    assert.equal(await User.countDocuments({ email: EMAIL }), 0);

    // The same 503 for every address, so it says nothing about which have accounts.
    for (const email of ["meera.iyer@nitjsr.ac.in", "nobody@nitjsr.ac.in"])
      assertEnvelopeError(
        await post("/resend-otp", { email }),
        503,
        "SERVICE_UNAVAILABLE",
      );
    // Login still answers, without a code.
    await redis.expire(
      keys.otp("meera.iyer@nitjsr.ac.in"),
      TTL.otpSeconds - 61,
    );
    const login = await post("/login", {
      email: "meera.iyer@nitjsr.ac.in",
      password: PASSWORD,
    });
    assertEnvelopeError(login, 403, "EMAIL_NOT_VERIFIED");
    assert.match(login.body.error.message, /ask for a new one later/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(mails.length, 0);
  });

  test("demo-login: one network using up a role leaves it open elsewhere, under a role-wide ceiling", async () => {
    process.env.DEMO_MODE = "true";
    await redis.set("rl:demoIp:student:127.0.0.1", 60, "PX", 60_000);
    const limited = await post("/demo-login", { role: "student" });
    assertEnvelopeError(limited, 429, "RATE_LIMITED");
    assert.equal(limited.body.error.details.tier, "demoIp");
    // Another role from the same network, and the same role from another network, still sign in.
    assert.equal((await post("/demo-login", { role: "admin" })).status, 200);
    const judge = await post(
      "/demo-login",
      { role: "student" },
      { from: "198.51.100.20" },
    );
    assert.equal(judge.status, 200);
    // Every network together: 1000 sign-ins per role in 15 minutes.
    await redis.set("rl:demo:student", 1000, "PX", 60_000);
    const everyone = await post(
      "/demo-login",
      { role: "student" },
      { from: "192.0.2.5" },
    );
    assertEnvelopeError(everyone, 429, "RATE_LIMITED");
    assert.equal(everyone.body.error.details.tier, "demo");
  });

  test("demo-config and demo-login follow DEMO_MODE", async () => {
    const off = await call("GET", "/demo-config");
    assert.equal(off.status, 200);
    assert.deepEqual(off.body.data, { demoMode: false, roles: [] });
    for (const body of [{ role: "student" }, {}, undefined])
      assertEnvelopeError(await post("/demo-login", body), 404, "NOT_FOUND");
    // Demo addresses can't use the password login either.
    assertEnvelopeError(
      await post("/login", { email: f.student.email, password: PASSWORD }),
      400,
      "VALIDATION_ERROR",
    );

    process.env.DEMO_MODE = "true";
    const on = await call("GET", "/demo-config");
    assert.deepEqual(on.body.data, {
      demoMode: true,
      roles: ["student", "student2", "faculty", "manager", "admin"],
    });
    const session = await post("/demo-login", { role: "admin" });
    assert.equal(session.status, 200);
    assert.equal(session.body.data.user._id, String(f.admin._id));
    assert.ok(session.cookie);
    const me = await call("GET", "/me", {
      token: session.body.data.accessToken,
    });
    assert.deepEqual(me.body.data.roles, ["admin"]);

    assertEnvelopeError(
      await post("/demo-login", { role: "root" }),
      400,
      "VALIDATION_ERROR",
    );
    const missing = await post("/demo-login", { role: "faculty" });
    assertEnvelopeError(missing, 404, "NOT_FOUND");
    assert.match(missing.body.error.message, /Run npm run seed/);
  });

  test("refresh and logout are in the general tier, keyed by the user id in the cookie", async () => {
    const user = await account();
    const session = await post("/login", { email: EMAIL, password: PASSWORD });
    const cookie = cookieValue(session.cookie);
    // The general tier's 300 requests in 5 minutes are used up.
    await redis.set(`rl:general:${user._id}`, 300, "PX", 60_000);
    for (const path of ["/refresh", "/logout"])
      assertEnvelopeError(
        await post(path, undefined, { cookie }),
        429,
        "RATE_LIMITED",
      );
    // Without a signed cookie there is nothing to count, and the answer is the usual one.
    assertEnvelopeError(
      await post("/refresh", undefined, { cookie: "garbage" }),
      401,
      "UNAUTHENTICATED",
    );
    assert.equal((await post("/logout")).status, 200);
    await redis.del(`rl:general:${user._id}`);
    assert.equal((await post("/refresh", undefined, { cookie })).status, 200);
  });

  test("two tabs refreshing with the same cookie at once both stay signed in", async () => {
    await account();
    const session = await post("/login", { email: EMAIL, password: PASSWORD });
    const cookie = cookieValue(session.cookie);
    const tabs = await Promise.all([
      post("/refresh", undefined, { cookie }),
      post("/refresh", undefined, { cookie }),
    ]);
    for (const tab of tabs) {
      assert.equal(tab.status, 200, JSON.stringify(tab.body));
      assert.equal(isCleared(tab.cookie), false);
    }
    for (const tab of tabs)
      assert.equal(
        (await post("/refresh", undefined, { cookie: cookieValue(tab.cookie) }))
          .status,
        200,
      );
  });

  test("a demo session ends at its next refresh once DEMO_MODE is off", async () => {
    process.env.DEMO_MODE = "true";
    const session = await post("/demo-login", { role: "admin" });
    delete process.env.DEMO_MODE;
    const refreshed = await post("/refresh", undefined, {
      cookie: cookieValue(session.cookie),
    });
    assertEnvelopeError(refreshed, 401, "UNAUTHENTICATED");
    assert.ok(isCleared(refreshed.cookie));
    assertEnvelopeError(
      await call("GET", "/me", { token: session.body.data.accessToken }),
      401,
      "UNAUTHENTICATED",
    );
  });

  test("if Redis can't store the jti, sign-in still answers 200, without the cookie", async () => {
    process.env.DEMO_MODE = "true";
    useRedisClient(redisFailing("set"));
    const res = await post("/demo-login", { role: "student" });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.accessToken);
    assert.equal(res.cookie, undefined);
    const me = await call("GET", "/me", { token: res.body.data.accessToken });
    assert.equal(me.status, 200);
  });

  test("refresh while Redis is down is 503 and keeps the cookie for the retry", async () => {
    await account();
    const session = await post("/login", { email: EMAIL, password: PASSWORD });
    const cookie = cookieValue(session.cookie);
    useRedisClient(redisDown());
    const down = await post("/refresh", undefined, { cookie });
    assertEnvelopeError(down, 503, "SERVICE_UNAVAILABLE");
    assert.equal(down.cookie, undefined);
    useRedisClient(redis);
    assert.equal((await post("/refresh", undefined, { cookie })).status, 200);
  });

  test("register, verify-otp and resend-otp answer 503 while Redis is down", async () => {
    useRedisClient(redisDown());
    for (const [path, body] of [
      ["/register", { name: "Ananya Rao", email: EMAIL, password: PASSWORD }],
      ["/verify-otp", { email: EMAIL, otp: "123456" }],
      ["/resend-otp", { email: EMAIL }],
    ])
      assertEnvelopeError(await post(path, body), 503, "SERVICE_UNAVAILABLE");
  });

  test("/me with an expired-looking or foreign token is 401; for a deleted account too", async () => {
    assertEnvelopeError(
      await call("GET", "/me", { token: "not.a.jwt" }),
      401,
      "UNAUTHENTICATED",
    );
    const user = await account();
    const { body } = await post("/login", { email: EMAIL, password: PASSWORD });
    await User.deleteOne({ _id: user._id });
    assertEnvelopeError(
      await call("GET", "/me", { token: body.data.accessToken }),
      401,
      "UNAUTHENTICATED",
    );
  });
});
