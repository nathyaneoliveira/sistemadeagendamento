import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'patient-validation-tests-only-secret-32bytes';
const { createPatientRouter } = await import('../src/routes/patientRoutes.js');

let baseUrl;
let queryCalls;
let transactionCalls;
let server;

before(async () => {
  queryCalls = 0;
  transactionCalls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/patients', createPatientRouter({
    authenticate: (req, _res, next) => {
      req.user = { userId: 'admin-a', clinicId: 'clinic-a', role: 'admin' };
      next();
    },
    requireActiveSubscription: (_req, _res, next) => next(),
    checkPlanLimit: async () => {},
    queryExecutor: async () => {
      queryCalls += 1;
      return { rows: [{ id: 'patient-a' }], rowCount: 1 };
    },
    transactionExecutor: async (callback) => {
      transactionCalls += 1;
      return callback({
        query: async (_sql, values) => ({
          rows: [{ id: 'patient-new', clinic_id: 'clinic-a', name: values[2] }],
          rowCount: 1,
        }),
      });
    },
  }));
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/patients`;
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

test('patient routes reject malformed create/update data before persistence and accept valid creation', async () => {
  const invalidCreate = await request('/', 'POST', { name: { value: 'invalid' } });
  const invalidUpdate = await request('/patient-a', 'PUT', { phone: 'x'.repeat(21) });
  assert.equal(invalidCreate.status, 400);
  assert.equal(invalidUpdate.status, 400);
  assert.equal(queryCalls, 0);
  assert.equal(transactionCalls, 0);

  const validCreate = await request('/', 'POST', {
    name: 'Synthetic Patient',
    birthDate: '1990-04-10',
  });
  assert.equal(validCreate.status, 201);
  assert.equal(validCreate.body.data.name, 'Synthetic Patient');
  assert.equal(transactionCalls, 1);
});
