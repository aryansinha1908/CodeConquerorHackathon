import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { after, before } from 'node:test';
import app from '../src/app.js';

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
  if (!server?.listening) return;
  server.close();
  await once(server, 'close');
});

test('health returns and exposes the supplied request ID', async (t) => {
  if (listenError) return t.skip(`HTTP listener unavailable: ${listenError.code || listenError.message}`);
  const response = await fetch(`${origin}/health`, {
    headers: { 'X-Request-Id': 'health_test_1' },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-request-id'), 'health_test_1');
  assert.deepEqual(body, { status: 'ok', requestId: 'health_test_1' });
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
  assert.deepEqual(body, { error: 'Not found', requestId });
  assert.equal(JSON.stringify(body).includes('private=query-value'), false);
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
