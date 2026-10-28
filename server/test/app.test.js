import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { after, before } from 'node:test';
import mongoose from 'mongoose';
import RedisMock from 'ioredis-mock';
import app from '../src/app.js';
import { disconnectRedis, useRedisClient } from '../src/config/redis.js';
import logger from '../src/lib/logger.js';

// The shared pino logger: silent here, so request logs don't fill the test output.
logger.level = 'silent';
// /health pings Redis; the mock answers PONG, and no real server is dialled.
useRedisClient(new RedisMock());

let server;
let origin;
let listenError;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  } catch (error) {
    listenError = error;
  }
});

after(async () => {
  await disconnectRedis();
  if (!server?.listening) return;
  server.close();
  await once(server, 'close');
});

// mongoose.connection.readyState is a getter; 1 means connected.
function withMongoState(state, fn) {
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => state });
  return fn().finally(() => delete mongoose.connection.readyState);
}

test('health is 503 while MongoDB is down, and exposes the supplied request ID', async (t) => {
  if (listenError) return t.skip(`HTTP listener unavailable: ${listenError.code || listenError.message}`);
  const response = await fetch(`${origin}/health`, {
    headers: { 'X-Request-Id': 'health_test_1' },
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('x-request-id'), 'health_test_1');
  assert.equal(body.status, 'down');
  assert.equal(body.mongo, 'down');
  assert.equal(body.redis, 'up');
  assert.equal(body.requestId, 'health_test_1');
  assert.ok(Number.isInteger(body.uptime));
});

test('health is 200 once MongoDB is connected, even with Redis down', async (t) => {
  if (listenError) return t.skip(`HTTP listener unavailable: ${listenError.code || listenError.message}`);
  await withMongoState(1, async () => {
    const up = await (await fetch(`${origin}/health`)).json();
    assert.deepEqual([up.status, up.mongo, up.redis], ['ok', 'up', 'up']);

    useRedisClient({ ping: async () => { throw new Error('Connection is closed.'); } });
    const response = await fetch(`${origin}/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).redis, 'degraded');
    useRedisClient(new RedisMock());
  });
});

test('invalid request IDs are replaced, and unmatched routes include the generated ID', async (t) => {
  if (listenError) return t.skip(`HTTP listener unavailable: ${listenError.code || listenError.message}`);
  const response = await fetch(`${origin}/does-not-exist?private=query-value`, {
    headers: { 'X-Request-Id': 'invalid id with spaces' },
  });
  const body = await response.json();
  const requestId = response.headers.get('x-request-id');

  assert.equal(response.status, 404);
  assert.ok(requestId);
  assert.notEqual(requestId, 'invalid id with spaces');
  assert.deepEqual(body, {
    success: false,
    error: { code: 'NOT_FOUND', message: "There's nothing at this address." },
    requestId,
  });
  assert.equal(JSON.stringify(body).includes('private=query-value'), false);
});

test('a body that isn\'t JSON is a 400 in the envelope, not an HTML page', async (t) => {
  if (listenError) return t.skip(`HTTP listener unavailable: ${listenError.code || listenError.message}`);
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'bad_json_1' },
    body: '{"username": ',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    error: { code: 'VALIDATION_ERROR', message: "The request body isn't valid JSON." },
    requestId: 'bad_json_1',
  });
});

test('authentication failures preserve the existing error field and include request ID', async (t) => {
  if (listenError) return t.skip(`HTTP listener unavailable: ${listenError.code || listenError.message}`);
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': 'login_test_1',
    },
    body: JSON.stringify({ username: 'not-a-user', password: 'test-password' }),
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('x-request-id'), 'login_test_1');
  assert.deepEqual(body, { error: 'Invalid credentials', requestId: 'login_test_1' });
});

test('CORS continues to allow the configured client origin and credentials', async (t) => {
  if (listenError) return t.skip(`HTTP listener unavailable: ${listenError.code || listenError.message}`);
  const response = await fetch(`${origin}/health`, {
    headers: { Origin: process.env.CLIENT_URL || 'http://localhost:5173' },
  });

  assert.equal(response.headers.get('access-control-allow-origin'), process.env.CLIENT_URL || 'http://localhost:5173');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.match(response.headers.get('access-control-expose-headers') || '', /X-Request-Id/i);
});
