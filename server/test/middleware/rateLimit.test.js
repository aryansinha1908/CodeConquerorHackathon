import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import RedisMock from "ioredis-mock";
import { trustProxyHops } from "../../src/config/env.js";
import { setRedisLogger, useRedisClient } from "../../src/config/redis.js";
import { keys } from "../../src/lib/redisKeys.js";
import {
  OTP_EMAIL_CAP,
  TIERS,
  createLimiter,
  demoLimiter,
  loginLimiter,
  markPasswordMatched,
  otpEmailsLeft,
  otpSendLimiter,
  registerLimiter,
  takeOtpEmail,
  takeOtpSend,
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

// Every request in these tests comes from 127.0.0.1, like students behind one hostel NAT. The app
// trusts one proxy hop, as app.js does behind Render: a request sent with `from` plays a client at
// that address, as Render's proxy would forward it.
const app = express();
app.set("trust proxy", 1);
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
// The stacks as the auth routes mount them, with small limits.
app.post(
  "/stacked-login",
  createLimiter("login", { limit: 3 }),
  createLimiter("loginIp", { limit: 4 }),
  (req, res) => res.status(req.body.password === "right" ? 200 : 401).json({}),
);
app.post(
  "/stacked-register",
  createLimiter("register", { limit: 2 }),
  createLimiter("registerIp", { limit: 3 }),
  ok,
);
app.post(
  "/stacked-demo",
  createLimiter("demoIp", { limit: 2 }),
  createLimiter("demo", { limit: 3 }),
  ok,
);
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
// from: the client address Render's proxy would put last in X-Forwarded-For.
const post = (path, body, from) =>
  fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(from && { "x-forwarded-for": from }),
    },
    body: JSON.stringify(body),
  });
const tierOf = async (res) => (await res.json()).error?.details?.tier;
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

describe("coarse IP ceilings, stacked on the email and role tiers", () => {
  test("one address signing up email after email hits the IP ceiling; another address doesn't", async () => {
    const signUp = (n, from) => () =>
      post("/stacked-register", { email: `s${n}@nitjsr.ac.in` }, from);
    assert.deepEqual(
      await statuses([1, 2, 3, 4].map((n) => signUp(n, "203.0.113.7"))),
      [200, 200, 200, 429],
    );
    const refused = await post(
      "/stacked-register",
      { email: "s5@nitjsr.ac.in" },
      "203.0.113.7",
    );
    const body = await refused.json();
    assert.equal(body.error.details.tier, "registerIp");
    assert.equal(
      body.error.message,
      "Too many sign-ups from your network. Try again in 1 hour.",
    );
    assert.equal((await signUp(6, "198.51.100.20")()).status, 200);
  });

  test("the email tier runs first: one address hammering one email doesn't use up its network's ceiling", async () => {
    const same = () =>
      post("/stacked-register", { email: "s1@nitjsr.ac.in" }, "203.0.113.7");
    assert.deepEqual(
      await statuses([same, same, same, same]),
      [200, 200, 429, 429],
    );
    assert.equal(await tierOf(await same()), "register");
    // 2 of the ceiling's 3 are used, so a classmate on the same Wi-Fi still signs up.
    assert.equal(
      (
        await post(
          "/stacked-register",
          { email: "s2@nitjsr.ac.in" },
          "203.0.113.7",
        )
      ).status,
      200,
    );
  });

  test("the login ceiling counts failures across accounts, and a sign-in it refuses isn't a failed attempt on the account", async () => {
    const attempt = (email, password) => async () => {
      const res = await post(
        "/stacked-login",
        { email, password },
        "203.0.113.7",
      );
      await sleep(20); // the count is taken back after the response finishes
      return res;
    };
    // Successes don't count towards the ceiling either.
    assert.deepEqual(
      await statuses([
        attempt("a@nitjsr.ac.in", "right"),
        attempt("a@nitjsr.ac.in", "wrong"),
        attempt("b@nitjsr.ac.in", "wrong"),
        attempt("c@nitjsr.ac.in", "wrong"),
        attempt("d@nitjsr.ac.in", "wrong"),
        attempt("e@nitjsr.ac.in", "wrong"),
      ]),
      [200, 401, 401, 401, 401, 429],
    );
    const refused = await post(
      "/stacked-login",
      { email: "e@nitjsr.ac.in", password: "right" },
      "203.0.113.7",
    );
    const body = await refused.json();
    assert.equal(body.error.details.tier, "loginIp");
    assert.match(body.error.message, /from your network/);
    // e@ was refused by the ceiling twice: neither counts against e@'s own 3 failures, so from
    // another network e@ still has all 3 before the account tier refuses (counted, it would have 1).
    await sleep(20);
    const elsewhere = (password) => () =>
      post(
        "/stacked-login",
        { email: "e@nitjsr.ac.in", password },
        "198.51.100.20",
      );
    assert.deepEqual(
      await statuses([
        elsewhere("wrong"),
        elsewhere("wrong"),
        elsewhere("wrong"),
      ]),
      [401, 401, 401],
    );
    assert.equal(await tierOf(await elsewhere("wrong")()), "login");
  });

  test("demo-login: one network using up a role leaves it open to judges elsewhere, under a role-wide ceiling", async () => {
    const demo = (role, from) => () => post("/stacked-demo", { role }, from);
    assert.deepEqual(
      await statuses([
        demo("admin", "203.0.113.7"),
        demo("admin", "203.0.113.7"),
        demo("admin", "203.0.113.7"),
        demo("student", "203.0.113.7"),
      ]),
      [200, 200, 429, 200],
    );
    assert.equal(await tierOf(await demo("admin", "203.0.113.7")()), "demoIp");
    // A judge on another network still gets in; then the role-wide ceiling (3) holds for everyone.
    assert.deepEqual(
      await statuses([
        demo("admin", "198.51.100.20"),
        demo("admin", "192.0.2.5"),
      ]),
      [200, 429],
    );
    assert.equal(await tierOf(await demo("admin", "192.0.2.6")()), "demo");
    assert.equal(
      Number(await redis.get("rl:demoIp:admin:203.0.113.7")),
      4,
      "keyed by role and address",
    );
  });

  test("only the address the trusted proxy saw counts: a forged X-Forwarded-For entry gets no fresh counter", async () => {
    // Render appends the address it saw; whatever the client sent comes before it.
    for (let n = 1; n <= 3; n++)
      await post(
        "/stacked-register",
        { email: `s${n}@nitjsr.ac.in` },
        `10.0.0.${n}, 203.0.113.7`,
      );
    const forged = await post(
      "/stacked-register",
      { email: "s4@nitjsr.ac.in" },
      "10.9.9.9, 203.0.113.7",
    );
    assert.equal(forged.status, 429);
    assert.equal(Number(await redis.get("rl:registerIp:203.0.113.7")), 4);
  });

  test("IPv6 clients are counted per /56, so one host can't step through its own addresses", async () => {
    for (const host of ["1", "2", "3"])
      await post(
        "/stacked-register",
        { email: `s${host}@nitjsr.ac.in` },
        `2001:db8:abcd:1200::${host}`,
      );
    const sameSubnet = await post(
      "/stacked-register",
      { email: "s4@nitjsr.ac.in" },
      "2001:db8:abcd:12ff::9",
    );
    assert.equal(sameSubnet.status, 429);
    const otherSubnet = await post(
      "/stacked-register",
      { email: "s5@nitjsr.ac.in" },
      "2001:db8:abcd:1300::1",
    );
    assert.equal(otherSubnet.status, 200);
  });

  test("an IPv4 client seen as an IPv6-mapped address shares its IPv4 counter", async () => {
    for (let n = 1; n <= 3; n++)
      await post(
        "/stacked-register",
        { email: `s${n}@nitjsr.ac.in` },
        "::ffff:203.0.113.7",
      );
    const res = await post(
      "/stacked-register",
      { email: "s4@nitjsr.ac.in" },
      "203.0.113.7",
    );
    assert.equal(res.status, 429);
  });

  test("express-rate-limit's own checks stay quiet: trust proxy is a hop count and IP keys use ipKeyGenerator", async () => {
    // Its configuration checks run when a limiter is created, its request checks on the first request.
    for (const name of Object.keys(TIERS)) createLimiter(name);
    await post(
      "/stacked-login",
      { email: "a@nitjsr.ac.in", password: "wrong" },
      "203.0.113.7",
    );
    await post("/stacked-register", { email: "a@nitjsr.ac.in" }, "2001:db8::1");
    await post("/stacked-demo", { role: "admin" }, "203.0.113.7");
    assert.deepEqual(logged.error, []);
    assert.deepEqual(logged.warn, []);
  });
});

// The deployed path (docs/deploy.md §6): browser → Vercel's rewrite → Render's proxy → the app, with
// the hop count render.yaml ships. Vercel replaces X-Forwarded-For with the visitor's address and
// Render's proxy appends Vercel's, so the app sees "visitor, Vercel". Someone calling the onrender.com
// URL directly writes whatever they like, and Render appends their real address.
describe("behind Vercel and Render, with the hop count render.yaml ships", () => {
  const renderYaml = readFileSync(
    new URL("../../../render.yaml", import.meta.url),
    "utf8",
  );
  const shipped = /- key: TRUST_PROXY_HOPS\s+value: "(\d+)"/.exec(
    renderYaml,
  )?.[1];
  const VERCEL = "76.76.21.21";
  const site = (visitor) => `${visitor}, ${VERCEL}`;
  const ATTACKER = "192.0.2.99";
  const direct = (written) => `${written}, ${ATTACKER}`;

  const deployed = express();
  deployed.set("trust proxy", trustProxyHops({ TRUST_PROXY_HOPS: shipped }));
  deployed.use(express.json());
  deployed.post(
    "/login",
    createLimiter("login", { limit: 3 }),
    createLimiter("loginIp", { limit: 4 }),
    (req, res) =>
      res.status(req.body.password === "right" ? 200 : 401).json({}),
  );
  deployed.post(
    "/demo",
    createLimiter("demoIp", { limit: 2 }),
    createLimiter("demo", { limit: 100 }),
    ok,
  );
  deployed.post("/codes", createLimiter("otpSendIp", { limit: 2 }), ok);

  let deployedServer;
  let deployedBase;
  before(async () => {
    deployedServer = deployed.listen(0);
    await new Promise((resolve) => deployedServer.once("listening", resolve));
    deployedBase = `http://127.0.0.1:${deployedServer.address().port}`;
  });
  after(() => deployedServer.close());

  const send = (path, body, forwardedFor) =>
    fetch(deployedBase + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": forwardedFor,
      },
      body: JSON.stringify(body),
    });
  // Failed logins with made-up accounts, so the per-email tier never refuses first.
  const failedLogin = (n, forwardedFor) => async () => {
    const res = await send(
      "/login",
      { email: `made-up-${n}@nitjsr.ac.in`, password: "wrong" },
      forwardedFor,
    );
    await sleep(20); // the count settles after the response
    return res;
  };
  const rightLogin = (forwardedFor) =>
    send("/login", { email: "judge@nitjsr.ac.in", password: "right" }, forwardedFor);

  test("render.yaml trusts both proxies on the site's path", () => {
    assert.ok(Number(shipped) >= 2, `TRUST_PROXY_HOPS is ${shipped}`);
  });

  test("visitors arriving from the same Vercel address keep their own ceilings", async () => {
    assert.deepEqual(
      await statuses([1, 2, 3, 4, 5].map((n) => failedLogin(n, site("203.0.113.66")))),
      [401, 401, 401, 401, 429],
    );
    assert.equal((await rightLogin(site("198.51.100.7"))).status, 200);

    for (let i = 0; i < 3; i++)
      await send("/demo", { role: "admin" }, site("203.0.113.66"));
    assert.equal(
      (await send("/demo", { role: "admin" }, site("198.51.100.7"))).status,
      200,
    );

    for (let i = 0; i < 3; i++) await send("/codes", {}, site("203.0.113.66"));
    assert.equal((await send("/codes", {}, site("198.51.100.7"))).status, 200);
  });

  test("a direct caller who writes a visitor's address into X-Forwarded-For gets a counter of their own, never the visitor's", async () => {
    assert.deepEqual(
      await statuses([1, 2, 3, 4, 5].map((n) => failedLogin(n, direct("198.51.100.7")))),
      [401, 401, 401, 401, 429],
    );
    for (let i = 0; i < 3; i++)
      await send("/demo", { role: "admin" }, direct("198.51.100.7"));
    for (let i = 0; i < 3; i++) await send("/codes", {}, direct("198.51.100.7"));

    assert.equal((await rightLogin(site("198.51.100.7"))).status, 200);
    assert.equal(
      (await send("/demo", { role: "admin" }, site("198.51.100.7"))).status,
      200,
    );
    assert.equal((await send("/codes", {}, site("198.51.100.7"))).status, 200);
    assert.equal(
      Number(await redis.get(`rl:loginIp:198.51.100.7,${ATTACKER}`)),
      5,
      "keyed by the written address and the caller's own",
    );
  });
});

describe("the global cap on OTP emails", () => {
  const capKey = keys.otpEmailLog;
  const fill = async (count, at) => {
    const args = [];
    for (let i = 0; i < count; i++) args.push(at + i, `old-${i}`);
    await redis.zadd(capKey, ...args);
  };

  test("250 in any 24 hours: the next one waits for the oldest to drop out", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 2, 4, 30) });
    const start = Date.now();
    await fill(OTP_EMAIL_CAP.limit - 1, start - 60 * 60_000); // an hour ago
    assert.deepEqual(await takeOtpEmail(), { allowed: true });
    assert.equal(await redis.zcard(capKey), OTP_EMAIL_CAP.limit);
    // 23 hours until the oldest send is a day old.
    assert.deepEqual(await takeOtpEmail(), {
      allowed: false,
      retryAfterSeconds: 23 * 60 * 60,
    });
    assert.equal(
      await redis.zcard(capKey),
      OTP_EMAIL_CAP.limit,
      "a refusal takes nothing",
    );

    t.mock.timers.setTime(start + 23 * 60 * 60_000);
    assert.deepEqual(await takeOtpEmail(), { allowed: true });
    assert.deepEqual((await takeOtpEmail()).allowed, false);
    assert.ok(
      (await redis.pttl(capKey)) > 0,
      "the log expires a day after the last send",
    );
  });

  test("a warning is logged once 80% of the cap is used, once per crossing", async () => {
    const warnings = () =>
      logged.warn.filter(([, message]) => /80% of the code emails/.test(message));
    await fill(OTP_EMAIL_CAP.limit * 0.8 - 1, Date.now() - 60_000);
    await otpEmailsLeft(); // looking never warns
    await takeOtpEmail();
    assert.equal(warnings().length, 1);
    assert.deepEqual(warnings()[0][0], {
      used: OTP_EMAIL_CAP.limit * 0.8,
      limit: OTP_EMAIL_CAP.limit,
    });
    await takeOtpEmail();
    assert.equal(warnings().length, 1);
  });

  test("looking takes no slot", async () => {
    await fill(OTP_EMAIL_CAP.limit - 1, Date.now());
    for (let i = 0; i < 3; i++)
      assert.deepEqual(await otpEmailsLeft(), { allowed: true });
    assert.deepEqual(await takeOtpEmail(), { allowed: true });
    assert.equal((await otpEmailsLeft()).allowed, false);
  });

  test("fails open when Redis is down, like the limiters", async () => {
    useRedisClient(unreachable());
    assert.deepEqual(await takeOtpEmail(), { allowed: true });
    assert.deepEqual(await otpEmailsLeft(), { allowed: true });
    assert.ok(logged.warn.some(([, message]) => /OTP email cap/.test(message)));
  });
});

describe("a network's share of code emails (otpSendIp)", () => {
  test("an unverified login's code counts against the network's share, after the email's own counters", async () => {
    await redis.set("rl:otpSendIp:203.0.113.7", 49, "PX", 60_000);
    assert.equal(await takeOtpSend("a@nitjsr.ac.in", "203.0.113.7"), true);
    assert.equal(await takeOtpSend("b@nitjsr.ac.in", "203.0.113.7"), false);
    // Another network's share is its own.
    assert.equal(await takeOtpSend("c@nitjsr.ac.in", "198.51.100.20"), true);
    // An email whose own counter is used up takes nothing from the network's share.
    await redis.set("rl:otpSend:d@nitjsr.ac.in", 3, "PX", 60_000);
    assert.equal(await takeOtpSend("d@nitjsr.ac.in", "198.51.100.20"), false);
    assert.equal(Number(await redis.get("rl:otpSendIp:198.51.100.20")), 1);
    // Without an address, only the email's counters are taken.
    assert.equal(await takeOtpSend("e@nitjsr.ac.in"), true);
    assert.deepEqual((await redis.keys("rl:otpSendIp:*")).sort(), [
      "rl:otpSendIp:198.51.100.20",
      "rl:otpSendIp:203.0.113.7",
    ]);
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
        loginIp: [100, 15],
        register: [3, 60],
        registerIp: [100, 60],
        otpSend: [3, 15],
        otpSendDaily: [10, 1440],
        otpSendIp: [50, 1440],
        otpVerify: [10, 15],
        demoIp: [60, 15],
        demo: [1000, 15],
        general: [300, 5],
        bookingCreate: [10, 60],
        upload: [20, 60],
        fileLink: [20, 15],
      },
    );
    assert.deepEqual(OTP_EMAIL_CAP, { limit: 250, windowMs: 24 * 60 * 60_000 });
    assert.equal(TIERS.login.skipSuccessfulRequests, true);
    assert.equal(TIERS.loginIp.skipSuccessfulRequests, true);
    assert.equal(TIERS.loginIp.succeeded, TIERS.login.succeeded);
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
  });

  test("IP is never the only key: each IP tier is stacked after a tier keyed by email or role", () => {
    const readsIp = (tier) =>
      /byIp|\.ips?\b|x-forwarded-for|remoteAddress/i.test(tier.key.toString());
    assert.deepEqual(
      Object.keys(TIERS).filter((name) => readsIp(TIERS[name])),
      ["loginIp", "registerIp", "otpSendIp", "demoIp"],
    );
    // One key function for every IP tier, grouping each IPv6 address with ipKeyGenerator.
    assert.match(TIERS.loginIp.key.toString(), /ipKeyGenerator\(address\)/);
    for (const name of ["registerIp", "otpSendIp"])
      assert.equal(TIERS[name].key, TIERS.loginIp.key, name);
    assert.match(TIERS.demoIp.key.toString(), /byIp\(req\)/);
    // The demo tier stacked on demoIp keys on the role alone; demoIp keys on the role too.
    assert.doesNotMatch(TIERS.demo.key.toString(), /\.ip\b|byIp/);
    assert.deepEqual(
      [loginLimiter, registerLimiter, otpSendLimiter, demoLimiter].map(
        (stack) => stack.map((limiter) => limiter.tier),
      ),
      [
        ["login", "loginIp"],
        ["register", "registerIp", "otpSendIp"],
        ["otpSend", "otpSendDaily", "otpSendIp"],
        ["demoIp", "demo"],
      ],
    );
  });
});
