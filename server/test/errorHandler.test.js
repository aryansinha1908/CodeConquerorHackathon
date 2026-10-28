import assert from 'node:assert/strict';
import test from 'node:test';
import { errorHandler } from '../src/middleware/errorHandler.js';

test('unexpected errors return a safe response with the request ID', () => {
  let responseBody;
  let responseStatus;
  const logged = [];
  const req = { id: 'request_123', log: { error: (...args) => logged.push(args) } };
  const res = {
    headersSent: false,
    status(status) {
      responseStatus = status;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  errorHandler(new Error('internal database detail'), req, res, assert.fail);

  assert.equal(responseStatus, 500);
  assert.deepEqual(responseBody, {
    error: 'Internal server error',
    requestId: 'request_123',
  });
  assert.equal(JSON.stringify(responseBody).includes('internal database detail'), false);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0].requestId, 'request_123');
  assert.equal(logged[0][0].stack.includes('internal database detail'), true);
});

test('errors after headers are sent are passed to Express', () => {
  const error = new Error('late failure');
  let passedError;
  const res = { headersSent: true };

  errorHandler(error, { id: 'request_456' }, res, (err) => { passedError = err; });

  assert.equal(passedError, error);
});
