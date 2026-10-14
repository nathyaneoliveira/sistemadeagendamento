import assert from 'node:assert/strict';
import test from 'node:test';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { rateLimitMiddleware } from '../src/middlewares/rateLimiter.js';

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('rate limit rejection returns 429', async () => {
  const middleware = rateLimitMiddleware({
    consume: async () => {
      throw new RateLimiterRes(0, 1000, 1, false);
    },
  });
  const response = responseRecorder();

  await middleware({ ip: '192.0.2.10' }, response, (error) => {
    assert.ifError(error);
  });

  assert.equal(response.statusCode, 429);
  assert.equal(response.body.ok, false);
});

test('limiter key uses Express req.ip and ignores client-supplied forwarding headers', async () => {
  let consumedKey;
  const middleware = rateLimitMiddleware({
    consume: async (key) => {
      consumedKey = key;
    },
  });
  const response = responseRecorder();

  await middleware({
    ip: '192.0.2.10',
    headers: { 'x-forwarded-for': '203.0.113.99' },
  }, response, (error) => {
    assert.ifError(error);
  });

  assert.equal(consumedKey, '192.0.2.10');
});

test('unexpected limiter failures are forwarded to error middleware', async () => {
  const failure = new Error('limiter unavailable');
  const middleware = rateLimitMiddleware({
    consume: async () => {
      throw failure;
    },
  });
  const response = responseRecorder();
  let forwardedError;

  await middleware({ ip: '192.0.2.10' }, response, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError, failure);
  assert.equal(response.statusCode, null);
});
