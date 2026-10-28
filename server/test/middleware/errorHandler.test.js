import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { LockUnavailableError } from '../../src/lib/lock.js';
import { ServiceError } from '../../src/lib/serviceError.js';
import { AiQuotaError } from '../../src/services/aiQuotaService.js';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler.js';

// Runs the handler against a stub request and response; → { status, body, headers, logged }.
function handle(err, { headersSent = false, notFound = false } = {}) {
  const logged = { error: [], warn: [] };
  const req = {
    id: 'request_123',
    log: {
      error: (...args) => logged.error.push(args),
      warn: (...args) => logged.warn.push(args),
    },
  };
  const out = { headers: {}, logged };
  const res = {
    headersSent,
    set(headers) {
      Object.assign(out.headers, headers);
      return this;
    },
    status(status) {
      out.status = status;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    },
  };
  let passed;
  if (notFound) notFoundHandler(req, res);
  else errorHandler(err, req, res, (e) => { passed = e; });
  return { ...out, passed };
}

test('unexpected errors return a safe 500 with the request ID; the stack is logged', () => {
  const { status, body, logged } = handle(new Error('internal database detail'));

  assert.equal(status, 500);
  assert.deepEqual(body, {
    success: false,
    error: { code: 'INTERNAL', message: 'Something went wrong.' },
    requestId: 'request_123',
  });
  assert.equal(JSON.stringify(body).includes('internal database detail'), false);
  assert.equal(logged.error.length, 1);
  assert.equal(logged.error[0][0].requestId, 'request_123');
  assert.match(logged.error[0][0].err.stack, /internal database detail/);
});

test('service errors are sent as they are: status, code, message and details', () => {
  const details = [{ path: 'reason', message: 'Required.' }];
  const { status, body, logged } = handle(
    new ServiceError(400, 'VALIDATION_ERROR', '1 field is invalid.', details),
  );

  assert.equal(status, 400);
  assert.deepEqual(body.error, { code: 'VALIDATION_ERROR', message: '1 field is invalid.', details });
  assert.equal(logged.error.length + logged.warn.length, 0);
});

test('headers such as Retry-After go out with the error; our own 503s keep their message', () => {
  const quota = handle(
    new AiQuotaError('USER_DAILY', { limit: 5, resetsAt: new Date(60_000), now: new Date(0) }),
  );
  assert.equal(quota.status, 429);
  assert.equal(quota.body.error.code, 'AI_QUOTA_EXCEEDED');
  assert.equal(quota.headers['Retry-After'], '60');

  const busy = handle(new LockUnavailableError());
  assert.equal(busy.status, 503);
  assert.deepEqual(busy.body.error, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'This resource is busy right now. Please try again.',
  });
  assert.equal(busy.logged.warn.length, 1);
});

test('Mongoose, Zod and duplicate-key errors become 400 or 409 in the same shape', () => {
  const doc = new mongoose.Document({}, new mongoose.Schema({ n: { type: Number, required: true } }));
  const validation = handle(doc.validateSync());
  assert.equal(validation.status, 400);
  assert.deepEqual(validation.body.error.details, [{ path: 'n', message: 'Path `n` is required.' }]);

  const cast = handle(new mongoose.Error.CastError('ObjectId', 'nope', 'resourceId'));
  assert.deepEqual(
    [cast.status, cast.body.error.details],
    [400, [{ path: 'resourceId', message: 'Must be a valid id.' }]],
  );

  const zod = Object.assign(new Error('zod'), {
    name: 'ZodError',
    issues: [{ path: ['items', 0, 'label'], message: 'Required' }],
  });
  assert.deepEqual(handle(zod).body.error, {
    code: 'VALIDATION_ERROR',
    message: '1 field is invalid.',
    details: [{ path: 'items.0.label', message: 'Required' }],
  });

  const duplicate = handle(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
  assert.deepEqual([duplicate.status, duplicate.body.error.code], [409, 'CONFLICT']);
});

test('body-parser errors keep their status with a readable message', () => {
  const badJson = Object.assign(new SyntaxError('Unexpected token b'), {
    status: 400,
    expose: true,
    type: 'entity.parse.failed',
  });
  assert.deepEqual(handle(badJson).body.error, {
    code: 'VALIDATION_ERROR',
    message: "The request body isn't valid JSON.",
  });
  // A status without an envelope code and not meant for users: the status stays, the text doesn't.
  const hidden = handle(Object.assign(new Error('secret detail'), { status: 403 }));
  assert.deepEqual(hidden.body.error, {
    code: 'FORBIDDEN',
    message: "The request couldn't be processed.",
  });
  // A system error's string code isn't ours.
  const system = handle(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
  assert.equal(system.status, 500);
});

test('unmatched routes get a 404 in the same shape, without echoing the path', () => {
  const { status, body } = handle(undefined, { notFound: true });
  assert.equal(status, 404);
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(body.requestId, 'request_123');
});

test('errors after headers are sent are passed to Express', () => {
  const error = new Error('late failure');
  assert.equal(handle(error, { headersSent: true }).passed, error);
});
