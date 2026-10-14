import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'settings-validation-tests-only-secret-32bytes';
const { createSettingsRouter } = await import('../src/routes/settingsRoutes.js');

let baseUrl;
let queryCalls;
let server;

before(async () => {
  queryCalls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/settings', createSettingsRouter({
    authenticate: (_req, _res, next) => next(),
    requireClinic: (req, _res, next) => {
      req.clinicId = 'clinic-synthetic';
      next();
    },
    requireActiveSubscription: (_req, _res, next) => next(),
    authorizeRolesMiddleware: () => (_req, _res, next) => next(),
    queryExecutor: async () => {
      queryCalls += 1;
      return { rows: [{ id: 'configuration-synthetic' }], rowCount: 1 };
    },
  }));
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/settings`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function postSettings(body) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  return {
    status: response.status,
    body: response.headers.get('content-type')?.includes('application/json')
      ? JSON.parse(responseText)
      : responseText,
  };
}

test('settings reject invalid data before queries and accept valid schema-bounded data', async () => {
  const invalidPayloads = [
    { name: { clinic: 'Invalid' } },
    { name: 'n'.repeat(201) },
    { phone: '1'.repeat(21) },
    { whatsapp: ['invalid'] },
    { addressLine1: 'a'.repeat(256) },
    { email: 'not-an-email' },
    { email: 'e'.repeat(251) + '@x.co' },
    { timezone: null },
    { timezone: 'Invalid/Zone' },
    { timezone: 'x'.repeat(65) },
    { openingHours: 'not-json-object' },
    { publicSlug: 'Invalid Slug' },
    { unsupported: true },
    null,
    [],
  ];

  for (const payload of invalidPayloads) {
    const response = await postSettings(payload);
    assert.equal(response.status, 400, JSON.stringify(payload));
  }
  assert.equal(queryCalls, 0);

  const validResponse = await postSettings({
    name: 'S'.repeat(200),
    phone: '1'.repeat(20),
    addressLine1: 'A'.repeat(255),
    email: 'clinic@example.test',
    openingHours: { monday: [] },
    timezone: 'America/Sao_Paulo',
    publicSlug: 'a'.repeat(63),
    logoUrl: null,
    serviceInfo: null,
  });
  assert.equal(validResponse.status, 200);
  assert.equal(queryCalls, 2);

  const nullOptionalValues = await postSettings({
    name: null,
    email: null,
    openingHours: null,
  });
  assert.equal(nullOptionalValues.status, 200);
  assert.equal(queryCalls, 4);
});
