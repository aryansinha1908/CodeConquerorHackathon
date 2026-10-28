import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { verifyAuth } from '../../src/middleware/auth.js';

process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';

// → what verifyAuth passed to next(), and the request it saw.
function run(authorization) {
  const req = { headers: authorization ? { authorization } : {} };
  return new Promise((resolve) => {
    verifyAuth(req, {}, (err) => resolve({ err, req }));
  });
}

test('a valid Bearer token sets req.user', async () => {
  const token = jwt.sign({ id: 'u1', roles: ['member'] }, process.env.ACCESS_TOKEN_SECRET);
  const { err, req } = await run(`Bearer ${token}`);
  assert.equal(err, undefined);
  assert.equal(req.user.id, 'u1');
});

test('a missing, expired or forged token is 401 UNAUTHENTICATED, which the client refreshes on', async () => {
  const expired = jwt.sign({ id: 'u1', exp: Math.floor(Date.now() / 1000) - 60 }, process.env.ACCESS_TOKEN_SECRET);
  const forged = jwt.sign({ id: 'u1' }, 'someone-elses-secret');
  for (const header of [undefined, 'Bearer', `Bearer ${expired}`, `Bearer ${forged}`]) {
    const { err, req } = await run(header);
    assert.equal(err?.status, 401, String(header));
    assert.equal(err.code, 'UNAUTHENTICATED');
    assert.equal(req.user, undefined);
  }
});
