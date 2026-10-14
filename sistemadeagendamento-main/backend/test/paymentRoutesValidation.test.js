import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'payment-validation-tests-only-secret-32bytes';
const { createPaymentRouter } = await import('../src/routes/paymentRoutes.js');

let baseUrl;
let queryCalls;
let appointmentExists;
let server;

before(async () => {
  queryCalls = 0;
  appointmentExists = true;
  const app = express();
  app.use(express.json());
  app.use('/api/payments', createPaymentRouter({
    authenticate: (_req, _res, next) => next(),
    requireClinic: (req, _res, next) => {
      req.clinicId = 'clinic-synthetic';
      next();
    },
    requireActiveSubscription: (_req, _res, next) => next(),
    requirePaymentsCapability: (_req, _res, next) => next(),
    authorizeRolesMiddleware: () => (_req, _res, next) => next(),
    queryExecutor: async (sql) => {
      queryCalls += 1;
      if (sql.startsWith('SELECT id FROM appointments')) {
        return { rows: appointmentExists ? [{ id: 'appointment-synthetic' }] : [], rowCount: Number(appointmentExists) };
      }
      return { rows: [{ id: 'payment-synthetic' }], rowCount: 1 };
    },
  }));
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/payments`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function request(path, method, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('payment routes reject invalid create and status data before persistence', async () => {
  const invalidCreate = await request('/', 'POST', {
    appointmentId: 'not-a-uuid',
    amount: 20,
    paymentMode: 'later',
  });
  const invalidStatus = await request('/not-a-uuid/status', 'PATCH', { status: 'paid' });
  assert.equal(invalidCreate.status, 400);
  assert.equal(invalidStatus.status, 400);
  assert.equal(queryCalls, 0);

  const validCreate = await request('/', 'POST', {
    appointmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    amount: 20.5,
    currency: 'BRL',
    provider: 'internal',
    paymentMode: 'before',
    status: 'pending',
  });
  assert.equal(validCreate.status, 201);
  assert.equal(queryCalls, 2);
});

test('payment creation retains the not-found response for a valid missing appointment reference', async () => {
  queryCalls = 0;
  appointmentExists = false;
  const response = await request('/', 'POST', {
    appointmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    amount: 20,
  });
  assert.equal(response.status, 404);
  assert.equal(queryCalls, 1);
  appointmentExists = true;
});
