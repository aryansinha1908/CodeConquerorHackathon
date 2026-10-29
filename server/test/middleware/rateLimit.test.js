import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import RedisMock from "ioredis-mock";
import { setRedisLogger, useRedisClient } from "../../src/config/redis.js";
import {
  TIERS,
  createLimiter,
  markPasswordMatched,
  otpSendLimiter,
} from "../../src/middleware/rateLimit.js";

const logged = { warn: [], error: [] };
setRedisLogger({
  info() {},
  warn: (...args) => logged.warn.push(args),
  error: (...args) => logged.error.push(args),
});

const redis = new RedisMock();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const unreachable = () => {
  const fail = async () => {
    throw new Error(
      "Stream isn't writeable and enableOfflineQueue options is false",
    );
  };
  return {
    defineCommand(name) {
      this[name] = fail;
    },
    del: fail,
  };
};

// Every request in these tests comes from 127.0.0.1, like students behind one hostel NAT.
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const user = req.get("x-test-user");
  if (user) req.user = { id: user };
  next();
});
const ok = (_req, res) => res.json({ success: true });

app.get("/general", createLimiter("general", { limit: 3 }), ok);
// "unverified": the right password on an account whose email isn't verified, which the real route
// answers 403 EMAIL_NOT_VERIFIED after marking the response.
app.post("/login", createLimiter("login", { limit: 3 }), (req, res) => {
  if (req.body.password === "unverified") {
    markPasswordMatched(res);
    return res.status(403).json({});
  }
  return res.status(req.body.password === "right" ? 200 : 401).json({});
});
app.post(
  "/otp",
  createLimiter("otpSend", { limit: 2, windowMs: 150 }),
  createLimiter("otpSendDaily", { limit: 3 }),
  ok,
);
app.post("/demo", createLimiter("demo", { limit: 2 }), ok);
app.use((err, _req, res, _next) =>
  res.status(500).json({ message: err.message }),
);

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

beforeEach(async () => {
  useRedisClient(redis);
  await redis.flushall();
  logged.warn.length = 0;
  logged.error.length = 0;
});

const get = (path, user) =>
  fetch(base + path, { headers: user ? { "x-test-user": user } : {} });
const post = (path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const statuses = async (requests) => {
  const out = [];
  for (const request of requests) out.push((await request()).status);
  return out;
};

describe("per-user limits (never per IP)", () => {
  test("one user hitting the limit doesn't block another user on the same IP", async () => {
    assert.deepEqual(
      await statuses(
        Array.from({ length: 4 }, () => () => get("/general", "student-a")),
      ),
      [200, 200, 200, 429],
    );
    assert.equal((await get("/general", "student-b")).status, 200);
  });

  test("a 429 uses the error envelope, Retry-After and RateLimit headers", async () => {
    for (let i = 0; i < 3; i++) await get("/general", "student-a");
    const res = await get("/general", "student-a");
    const body = await res.json();
    assert.equal(res.status, 429);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.equal(
      body.error.message,
      "You're sending requests too quickly. Try again in 5 minutes.",
    );
    assert.deepEqual(body.error.details, {
      tier: "general",
      limit: 3,
      retryAfterSeconds: 300,
    });
    assert.equal(res.headers.get("retry-after"), "300");
    assert.match(res.headers.get("ratelimit"), /limit=3, remaining=0/);
    assert.equal(
      logged.error.length,
      0,
      "no express-rate-limit configuration errors",
    );
  });

  test("counts live in Redis under rl:{tier}:{userId}", async () => {
    await get("/general", "student-a");
    assert.equal(Number(await redis.get("rl:general:student-a")), 1);
    assert.ok((await redis.pttl("rl:general:student-a")) > 0);
  });

  test("mounting before the auth middleware fails loudly instead of sharing one counter", async () => {
    const res = await get("/general");
    assert.equal(res.status, 500);
    assert.match(
      (await res.json()).message,
      /mount it after the auth middleware/,
    );
  });
});

describe("per-email limits on auth routes", () => {
  test("login counts only failed attempts", async () => {
    const attempt = (password) => () =>
      post("/login", { email: "2024ugcs999@nitjsr.ac.in", password });
    assert.deepEqual(
      await statuses([
        attempt("wrong"),
        attempt("wrong"),
        attempt("right"),
        attempt("right"),
      ]),
      [401, 401, 200, 200],
    );
    await sleep(20); // successful requests are uncounted after the response finishes
    assert.deepEqual(
      await statuses([attempt("wrong"), attempt("wrong")]),
      [401, 429],
    );
    const body = await (
      await post("/login", {
        email: "2024ugcs999@nitjsr.ac.in",
        password: "right",
      })
    ).json();
    assert.equal(
      body.error.message,
      "Too many failed login attempts for this account. Try again in 15 minutes.",
    );
  });

  test("the right password on an unverified account isn't a failed attempt; a plain 403 still is", async () => {
    const attempt = (password) => async () => {
      const res = await post("/login", {
        email: "2024ugcs999@nitjsr.ac.in",
        password,
      });
      await sleep(20); // the count is taken back after the response finishes
      return res;
    };
    assert.deepEqual(
      await statuses(Array.from({ length: 5 }, () => attempt("unverified"))),
      [403, 403, 403, 403, 403],
    );
    assert.deepEqual(
      await statuses([
        attempt("wrong"),
        attempt("wrong"),
        attempt("wrong"),
        attempt("unverified"),
      ]),
      [401, 401, 401, 429],
    );
  });

  test("the email is normalised, so case and spaces don't give extra attempts", async () => {
    const emails = [
      "2024UGCS999@nitjsr.ac.in",
      " 2024ugcs999@nitjsr.ac.in ",
      "2024ugcs999@NITJSR.ac.in",
    ];
    for (const email of emails)
      await post("/login", { email, password: "wrong" });
    assert.equal(
      (
        await post("/login", {
          email: "2024ugcs999@nitjsr.ac.in",
          password: "wrong",
        })
      ).status,
      429,
    );
    assert.equal(
      (
        await post("/login", {
          email: "2024ugcs111@nitjsr.ac.in",
          password: "wrong",
        })
      ).status,
      401,
    );
  });

  test("OTP sending has a short window and a daily cap stacked", async () => {
    const send = () => post("/otp", { email: "a@nitjsr.ac.in" });
    assert.deepEqual(await statuses([send, send, send]), [200, 200, 429]);
    await sleep(200); // the short window resets, the daily count (2) doesn't
    assert.equal((await send()).status, 200);
    const res = await send();
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.match(body.error.message, /today's limit of 10 codes/);
    assert.equal(body.error.details.tier, "otpSendDaily");
  });

  test("demo login is limited per role", async () => {
    const login = (role) => () => post("/demo", { role });
    assert.deepEqual(
      await statuses([
        login("member"),
        login("member"),
        login("member"),
        login("admin"),
      ]),
      [200, 200, 429, 200],
    );
  });

  test("missing email fails loudly (the validator must run first)", async () => {
    const res = await post("/login", { password: "x" });
    assert.equal(res.status, 500);
    assert.match((await res.json()).message, /run the Zod validator before it/);
  });
});

describe("fails open when Redis is down", () => {
  test("requests pass and the store error is logged", async () => {
    useRedisClient(unreachable());
    assert.deepEqual(
      await statuses(
        Array.from({ length: 5 }, () => () => get("/general", "student-a")),
      ),
      [200, 200, 200, 200, 200],
    );
    assert.ok(
      logged.error.some(([, message]) =>
        /error from store, allowing request/.test(message),
      ),
    );
  });
});

describe("tiers match architecture.md §11", () => {
  test("windows, limits and keys", () => {
    const minutes = (name) => TIERS[name].windowMs / 60_000;
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(TIERS).map((name) => [
          name,
          [TIERS[name].limit, minutes(name)],
        ]),
      ),
      {
        login: [5, 15],
        register: [3, 60],
        otpSend: [3, 15],
        otpSendDaily: [10, 1440],
        otpVerify: [10, 15],
        demo: [60, 15],
        general: [300, 5],
        bookingCreate: [10, 60],
        upload: [20, 60],
        fileLink: [20, 15],
      },
    );
    assert.equal(TIERS.login.skipSuccessfulRequests, true);
    // Only the marked 403 counts as a success besides status < 400.
    const res = (statusCode, locals = {}) => ({ statusCode, locals });
    assert.deepEqual(
      [
        TIERS.login.succeeded({}, res(200)),
        TIERS.login.succeeded({}, res(401)),
        TIERS.login.succeeded({}, res(403)),
        TIERS.login.succeeded({}, res(403, { passwordMatched: true })),
      ],
      [true, false, false, true],
    );
    assert.equal(otpSendLimiter.length, 2);
  });

  test("no key generator reads the IP", () => {
    for (const tier of Object.values(TIERS)) {
      assert.doesNotMatch(
        tier.key.toString(),
        /\.ip\b|x-forwarded-for|remoteAddress/i,
      );
    }
  });
});
