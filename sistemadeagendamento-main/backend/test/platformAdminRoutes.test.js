import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'platform-admin-route-tests-only-secret-32-bytes';
const { createPlatformAdminRouter } = await import('../src/routes/platformAdminRoutes.js');

let baseUrl;
let loginCalls;
let revokeCalls;
let server;

before(async () => {
  loginCalls = [];
  revokeCalls = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.requestId = '45c6a9b1-0ec2-4a90-b744-907493ff94b9';
    next();
  });
  app.use('/api/platform', createPlatformAdminRouter({
    authenticate: (req, res, next) => {
      if (req.headers.authorization !== 'Bearer synthetic-platform-token') {
        return res.status(401).json({ ok: false, message: 'Autenticação administrativa necessária.' });
      }
      req.platformAdmin = { id: 'synthetic-admin-id', email: 'owner@example.invalid', name: 'Owner' };
      return next();
    },
    login: async (credentials) => {
      loginCalls.push(credentials);
      return { token: 'synthetic-platform-token', user: { id: 'synthetic-admin-id', name: 'Owner' } };
    },
    revokeSession: async (session) => revokeCalls.push(session),
    auditLogger: async () => {},
    service: {
      getDashboard: async () => ({ metrics: {} }),
      listClinics: async () => ({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
      getClinicDetails: async (clinicId) => ({ clinic: { id: clinicId } }),
      listSubscriptions: async () => ({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
      listRecentEvents: async () => ({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
    },
  }));
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/platform`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, body: payload };
}

test('global login validates inputs and delegates only to the global account service', async () => {
  const beforeCalls = loginCalls.length;
  assert.equal((await request('/auth/login', { method: 'POST', body: {} })).status, 400);
  assert.equal((await request('/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.invalid', password: 'x'.repeat(1025) },
  })).status, 400);
  assert.equal(loginCalls.length, beforeCalls);

  const response = await request('/auth/login', {
    method: 'POST',
    body: { email: ' OWNER@example.invalid ', password: 'legacy' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(loginCalls.at(-1), {
    email: 'owner@example.invalid',
    password: 'legacy',
    requestId: '45c6a9b1-0ec2-4a90-b744-907493ff94b9',
  });
});

test('clinic and missing bearer tokens cannot access any global endpoint', async () => {
  for (const path of ['/dashboard', '/clinics', '/subscriptions', '/events']) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { token: 'clinic-admin-jwt' })).status, 401);
  }
});

test('global logout delegates revocation for the authenticated administrator', async () => {
  const response = await request('/auth/logout', {
    token: 'synthetic-platform-token',
    method: 'POST',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(revokeCalls.at(-1), {
    platformAdminId: 'synthetic-admin-id',
    requestId: '45c6a9b1-0ec2-4a90-b744-907493ff94b9',
  });
});

test('authenticated global endpoints return read-only data and support clinic detail lookup', async () => {
  const token = 'synthetic-platform-token';
  assert.equal((await request('/dashboard', { token })).status, 200);
  assert.equal((await request('/clinics?page=1&pageSize=10', { token })).status, 200);
  const clinic = await request('/clinics/00000000-0000-4000-8000-000000000001', { token });
  assert.equal(clinic.status, 200);
  assert.equal(clinic.body.data.clinic.id, '00000000-0000-4000-8000-000000000001');
  assert.equal((await request('/subscriptions', { token })).status, 200);
  assert.equal((await request('/events', { token })).status, 200);
  assert.equal((await request('/clinics', { token, method: 'DELETE' })).status, 404);
});
