import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import RedisMock from "ioredis-mock";
import app from "../src/app.js";
import { disconnectRedis, useRedisClient } from "../src/config/redis.js";
import logger from "../src/lib/logger.js";

// The shared pino logger: silent here, so request logs don't fill the test output.
logger.level = "silent";
// /health pings Redis; the mock answers PONG, and no real server is dialled.
useRedisClient(new RedisMock());

let server;
let origin;
let listenError;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  } catch (error) {
    listenError = error;
  }
});

after(async () => {
  await disconnectRedis();
  if (!server?.listening) return;
  server.close();
  await once(server, "close");
});

// mongoose.connection.readyState is a getter; 1 means connected.
function withMongoState(state, fn) {
  Object.defineProperty(mongoose.connection, "readyState", {
    configurable: true,
    get: () => state,
  });
  return fn().finally(() => delete mongoose.connection.readyState);
}

test("health is 503 while MongoDB is down, and exposes the supplied request ID", async (t) => {
  if (listenError)
    return t.skip(
      `HTTP listener unavailable: ${listenError.code || listenError.message}`,
    );
  const response = await fetch(`${origin}/health`, {
    headers: { "X-Request-Id": "health_test_1" },
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-request-id"), "health_test_1");
  assert.equal(body.status, "down");
  assert.equal(body.mongo, "down");
  assert.equal(body.redis, "up");
  assert.equal(body.requestId, "health_test_1");
  assert.ok(Number.isInteger(body.uptime));
});

test("health is 200 once MongoDB is connected, even with Redis down", async (t) => {
  if (listenError)
    return t.skip(
      `HTTP listener unavailable: ${listenError.code || listenError.message}`,
    );
  await withMongoState(1, async () => {
    const up = await (await fetch(`${origin}/health`)).json();
    assert.deepEqual([up.status, up.mongo, up.redis], ["ok", "up", "up"]);

    useRedisClient({
      ping: async () => {
        throw new Error("Connection is closed.");
      },
    });
    const response = await fetch(`${origin}/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).redis, "degraded");
    useRedisClient(new RedisMock());
  });
});

test("invalid request IDs are replaced, and unmatched routes include the generated ID", async (t) => {
  if (listenError)
    return t.skip(
      `HTTP listener unavailable: ${listenError.code || listenError.message}`,
    );
  const response = await fetch(`${origin}/does-not-exist?private=query-value`, {
    headers: { "X-Request-Id": "invalid id with spaces" },
  });
  const body = await response.json();
  const requestId = response.headers.get("x-request-id");

  assert.equal(response.status, 404);
  assert.ok(requestId);
  assert.notEqual(requestId, "invalid id with spaces");
  assert.deepEqual(body, {
    success: false,
    error: { code: "NOT_FOUND", message: "There's nothing at this address." },
    requestId,
  });
  assert.equal(JSON.stringify(body).includes("private=query-value"), false);
});

test("a body that isn't JSON is a 400 in the envelope, not an HTML page", async (t) => {
  if (listenError)
    return t.skip(
      `HTTP listener unavailable: ${listenError.code || listenError.message}`,
    );
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": "bad_json_1",
    },
    body: '{"username": ',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "The request body isn't valid JSON.",
    },
    requestId: "bad_json_1",
  });
});

// Login is by email now (architecture.md §6 Auth): the old mock's { username } body is a field error in
// the envelope, answered before the rate limiter and the database. Wrong credentials (401
// INVALID_CREDENTIALS) need MongoDB and are tested in test/routes/auth.test.js.
test("a login without an email is 400 VALIDATION_ERROR in the envelope, with the request ID", async (t) => {
  if (listenError)
    return t.skip(
      `HTTP listener unavailable: ${listenError.code || listenError.message}`,
    );
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": "login_test_1",
    },
    body: JSON.stringify({ username: "not-a-user", password: "test-password" }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("x-request-id"), "login_test_1");
  assert.deepEqual(body, {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "1 field is invalid.",
      details: [{ path: "email", message: "Required." }],
    },
    requestId: "login_test_1",
  });
});

test("GET /api/v1/auth/me without a token is 401 UNAUTHENTICATED, the code the client refreshes on", async (t) => {
  if (listenError)
    return t.skip(
      `HTTP listener unavailable: ${listenError.code || listenError.message}`,
    );
  const response = await fetch(`${origin}/api/v1/auth/me`);
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error.code, "UNAUTHENTICATED");
});

test("demo-config needs no database and reports DEMO_MODE", async (t) => {
  if (listenError)
    return t.skip(
      `HTTP listener unavailable: ${listenError.code || listenError.message}`,
    );
  const saved = process.env.DEMO_MODE;
  t.after(() => {
    if (saved === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = saved;
  });
  process.env.DEMO_MODE = "false";
  const off = await (await fetch(`${origin}/api/v1/auth/demo-config`)).json();
  assert.deepEqual(off.data, { demoMode: false, roles: [] });
  process.env.DEMO_MODE = "true";
  const on = await (await fetch(`${origin}/api/v1/auth/demo-config`)).json();
  assert.equal(on.data.demoMode, true);
  assert.equal(on.data.roles.length, 5);
});

test("CORS continues to allow the configured client origin and credentials", async (t) => {
  if (listenError)
    return t.skip(
      `HTTP listener unavailable: ${listenError.code || listenError.message}`,
    );
  const response = await fetch(`${origin}/health`, {
    headers: { Origin: process.env.CLIENT_URL || "http://localhost:5173" },
  });

  assert.equal(
    response.headers.get("access-control-allow-origin"),
    process.env.CLIENT_URL || "http://localhost:5173",
  );
  assert.equal(
    response.headers.get("access-control-allow-credentials"),
    "true",
  );
  assert.match(
    response.headers.get("access-control-expose-headers") || "",
    /X-Request-Id/i,
  );
});

// architecture.md §11: behind Render, req.ip is the address Render's proxy forwarded, which the coarse
// IP ceilings key on. One trusted hop: only the last X-Forwarded-For entry counts, so a client can't
// pick its own address by sending the header. These requests stop at the limiter, before MongoDB.
test("trust proxy is one hop, and the IP ceilings key on the address the proxy forwarded", async (t) => {
  if (listenError)
    return t.skip(
      `HTTP listener unavailable: ${listenError.code || listenError.message}`,
    );
  assert.equal(app.get("trust proxy"), 1);
  const redis = new RedisMock();
  useRedisClient(redis);
  t.after(() => useRedisClient(new RedisMock()));
  await redis.set("rl:loginIp:203.0.113.7", 100, "PX", 60_000); // that network's 100 failures are used up

  const login = (forwardedFor) =>
    fetch(`${origin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": forwardedFor,
      },
      body: JSON.stringify({
        email: "2024ugcs999@nitjsr.ac.in",
        password: "printer2024",
      }),
    });
  // A forged first entry changes nothing: the proxy's own entry, last, is the address.
  const response = await login("198.51.100.1, 203.0.113.7");
  const body = await response.json();
  assert.equal(response.status, 429);
  assert.equal(body.error.details.tier, "loginIp");
  assert.match(body.error.message, /from your network/);
  // The email tier ran first and counted the attempt; the refusal took it back (the response is done
  // before the count is, hence the short wait).
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(Number(await redis.get("rl:login:2024ugcs999@nitjsr.ac.in")), 0);
});
