import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApiErrorHandler } from '../src/httpErrorHandler.js';

function handle(error, path = '/api/public/clinics/clinic-a/appointments') {
  let response;
  const res = {
    headersSent: false,
    status(statusCode) {
      response = { statusCode };
      return this;
    },
    json(body) {
      response.body = body;
      return response;
    },
  };
  const loggerCalls = [];
  createApiErrorHandler({
    isProduction: true,
    logger: (...args) => loggerCalls.push(args),
  })(error, { path, requestId: 'request-1' }, res, (nextError) => {
    throw nextError;
  });
  return { response, loggerCalls };
}

test('public malformed JSON returns a generic 400 without exposing parser details', () => {
  const { response, loggerCalls } = handle(Object.assign(new SyntaxError('parser internals'), {
    type: 'entity.parse.failed',
    status: 400,
  }));

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, 'Dados inválidos.');
  assert.equal(JSON.stringify(response.body).includes('parser internals'), false);
  assert.equal(loggerCalls[0][1].statusCode, 400);
});

test('public oversized JSON returns 413 with a generic response', () => {
  const { response } = handle(Object.assign(new Error('request internals'), {
    type: 'entity.too.large',
    status: 413,
  }));

  assert.equal(response.statusCode, 413);
  assert.equal(response.body.message, 'Solicitação muito grande.');
  assert.equal(JSON.stringify(response.body).includes('request internals'), false);
});

test('Express JSON parser errors are returned safely on the public API', async (t) => {
  const app = express();
  app.use(express.json({ limit: '8b' }));
  app.post('/api/public/clinics/clinic-a/appointments', (_req, res) => res.sendStatus(204));
  app.use(createApiErrorHandler({
    isProduction: true,
    logger: () => {},
  }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  const malformed = await fetch(`http://127.0.0.1:${address.port}/api/public/clinics/clinic-a/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  const oversized = await fetch(`http://127.0.0.1:${address.port}/api/public/clinics/clinic-a/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"payload":"this is too large"}',
  });

  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).message, 'Dados inválidos.');
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).message, 'Solicitação muito grande.');
});
