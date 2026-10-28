import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import pino from 'pino';
import { loggerRedaction } from '../src/lib/logger.js';

test('logger redaction removes authentication secrets and project PII', () => {
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (chunk) => chunks.push(chunk));

  const logger = pino({ level: 'info', redact: loggerRedaction }, output);
  logger.info({
    password: 'secret-password',
    token: 'secret-token',
    email: 'private@example.test',
    req: {
      headers: {
        authorization: 'Bearer secret-access-token',
        cookie: 'refreshToken=secret-cookie',
      },
      body: { studentId: 'private-student-id' },
    },
  }, 'redaction test');

  const serialized = Buffer.concat(chunks).toString('utf8');
  const record = JSON.parse(serialized);
  assert.equal(record.password, '[REDACTED]');
  assert.equal(record.token, '[REDACTED]');
  assert.equal(record.email, '[REDACTED]');
  assert.equal(record.req.headers.authorization, '[REDACTED]');
  assert.equal(record.req.headers.cookie, '[REDACTED]');
  assert.equal(record.req.body.studentId, '[REDACTED]');
  for (const secret of [
    'secret-password',
    'secret-token',
    'private@example.test',
    'secret-access-token',
    'secret-cookie',
    'private-student-id',
  ]) {
    assert.equal(serialized.includes(secret), false, `log unexpectedly contains ${secret}`);
  }
});
