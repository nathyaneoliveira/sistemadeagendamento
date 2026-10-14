import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'auth-route-tests-only-secret-at-least-32-bytes';
const { createAuthRouter } = await import('../src/routes/authRoutes.js');

let baseUrl;
let loginCalls;
let selectionCalls;
let accountCalls;
let queryCalls;
let server;

before(async () => {
  loginCalls = [];
  selectionCalls = [];
  accountCalls = [];
  queryCalls = [];
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter({
    login: async (credentials) => {
      loginCalls.push(credentials);
      return { token: 'synthetic-session-token', user: { role: 'admin' } };
    },
    selectClinic: async (selection) => {
      selectionCalls.push(selection);
      return { token: 'synthetic-selected-session-token', user: { role: 'professional' } };
    },
    authenticate: (req, res, next) => {
      req.user = { userId: 'synthetic-user', clinicId: 'synthetic-clinic', role: 'admin' };
      return next();
    },
    queryExecutor: async (sql, values) => {
      queryCalls.push({ sql, values });
      return { rows: [], rowCount: 1 };
    },
    requireUserManagement: (req, res, next) => next(),
    createAccount: async (account) => {
      accountCalls.push(account);
      return { id: 'synthetic-user', ...account, password: undefined };
    },
  }));
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('login accepts only the email/password credentials and delegates account lookup', async () => {
  const response = await post('/login', {
    email: 'admin@example.invalid',
    password: 'legacy',
    clinicId: 'client-supplied-clinic',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(loginCalls.at(-1), {
    email: 'admin@example.invalid',
    password: 'legacy',
  });
  assert.equal(response.body.data.token, 'synthetic-session-token');
});

test('empty and invalid login fields are rejected before authentication', async () => {
  const callsBeforeValidation = loginCalls.length;
  for (const body of [
    {},
    { email: '', password: 'synthetic' },
    { email: 'not-an-email', password: 'synthetic' },
    { email: 'user@example.invalid', password: '' },
    { email: 'user@example.invalid', password: 123 },
    { email: 'user@example.invalid', password: 'x'.repeat(1025) },
  ]) {
    assert.equal((await post('/login', body)).status, 400);
  }
  assert.equal(loginCalls.length, callsBeforeValidation);
});

test('clinic account registration accepts a compliant password and assigns the authenticated tenant', async () => {
  const response = await post('/register', {
    name: 'Synthetic Staff',
    email: 'staff@example.invalid',
    password: 'Synthetic-password-123!',
    role: 'professional',
    clinicId: 'client-supplied-clinic',
  });

  assert.equal(response.status, 201);
  assert.equal(accountCalls.length, 1);
  assert.equal(accountCalls[0].clinicId, 'synthetic-clinic');
  assert.equal(accountCalls[0].password, 'Synthetic-password-123!');
});

test('clinic account registration rejects weak, oversized and malformed passwords before account creation', async () => {
  const callsBeforeValidation = accountCalls.length;
  for (const password of [
    'short',
    'x'.repeat(73),
    `${'a'.repeat(71)}é`,
    123,
  ]) {
    const response = await post('/register', {
      name: 'Synthetic Staff',
      email: 'staff@example.invalid',
      password,
      role: 'professional',
    });
    assert.equal(response.status, 400);
  }
  assert.equal(accountCalls.length, callsBeforeValidation);
});

test('clinic selection requires both signed selection token and clinic identifier', async () => {
  const callsBeforeValidation = selectionCalls.length;
  assert.equal((await post('/login/select-clinic', {})).status, 400);
  assert.equal(selectionCalls.length, callsBeforeValidation);

  const response = await post('/login/select-clinic', {
    selectionToken: 'synthetic-signed-selection',
    clinicId: 'authorized-clinic',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(selectionCalls.at(-1), {
    selectionToken: 'synthetic-signed-selection',
    clinicId: 'authorized-clinic',
  });
});

test('clinic logout revokes only the authenticated user session in the authenticated clinic', async () => {
  const response = await post('/logout', {});

  assert.equal(response.status, 200);
  assert.match(queryCalls.at(-1).sql, /token_version = token_version \+ 1/);
  assert.deepEqual(queryCalls.at(-1).values, ['synthetic-user', 'synthetic-clinic']);
});
