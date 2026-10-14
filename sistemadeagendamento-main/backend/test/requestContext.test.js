import assert from 'node:assert/strict';
import test from 'node:test';
import { requestIdMiddleware } from '../src/requestContext.js';

test('request ID middleware generates a new ID and returns it in a response header', () => {
  const request = { headers: { 'x-request-id': 'untrusted-client-value' } };
  const headers = {};
  const response = {
    setHeader(name, value) {
      headers[name] = value;
    },
  };
  let nextCalls = 0;
  const middleware = requestIdMiddleware(() => 'server-generated-id');

  middleware(request, response, () => {
    nextCalls += 1;
  });

  assert.equal(request.requestId, 'server-generated-id');
  assert.equal(headers['X-Request-ID'], 'server-generated-id');
  assert.equal(nextCalls, 1);
});
