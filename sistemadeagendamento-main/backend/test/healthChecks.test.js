import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadinessHandler } from '../src/healthChecks.js';

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

test('readiness succeeds when required dependencies respond', async () => {
  let checkCount = 0;
  const handler = createReadinessHandler(async () => {
    checkCount += 1;
  });
  const response = responseRecorder();

  await handler({}, response);

  assert.equal(checkCount, 1);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, status: 'ready' });
});

test('readiness fails generically when a dependency check fails', async () => {
  const warnings = [];
  const handler = createReadinessHandler(async () => {
    throw new Error('sensitive database connection detail');
  }, {
    warn: (...args) => warnings.push(args),
  });
  const response = responseRecorder();

  await handler({ requestId: 'request-id-1' }, response);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { ok: false, status: 'not_ready' });
  assert.equal(JSON.stringify(response.body).includes('sensitive'), false);
  assert.deepEqual(warnings, [[
    'Readiness dependency check failed',
    { requestId: 'request-id-1' },
  ]]);
});
