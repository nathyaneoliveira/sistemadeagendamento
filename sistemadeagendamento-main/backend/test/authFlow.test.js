import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import test, { after, before } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { hashPassword } from '../src/utils/password.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'auth-flow-tests-only-secret-at-least-32-bytes';
const { createAuthenticateToken, requireClinicAccess } = await import('../src/middlewares/auth.js');
const { createAuthRouter } = await import('../src/routes/authRoutes.js');
const { loginUser, selectLoginClinic } = await import('../src/services/authService.js');

const email = 'multi-clinic@example.invalid';
const password = 'Synthetic-password-123!';
const accounts = [
  {
    id: 'user-clinic-a',
    clinic_id: 'clinic-a',
    name: 'Synthetic Administrator A',
    email,
    role: 'admin',
    status: 'active',
    token_version: 0,
    clinic_name: 'Synthetic Clinic A',
    clinic_trade_name: null,
    clinic_timezone: 'UTC',
  },
  {
    id: 'user-clinic-b',
    clinic_id: 'clinic-b',
    name: 'Synthetic Professional B',
    email,
    role: 'professional',
    status: 'active',
    token_version: 0,
    clinic_name: 'Synthetic Clinic B',
    clinic_trade_name: null,
    clinic_timezone: 'UTC',
  },
];
let baseUrl;
let server;

function createQueryExecutor() {
  return async (text, values = []) => {
    if (text.includes('JOIN clinics')) {
      const rows = accounts
        .filter((account) => account.email.toLowerCase() === values[0].toLowerCase())
        .map((account) => ({ ...account, password_hash: account.password_hash }));
      return { rows, rowCount: rows.length };
    }

    if (text.includes('SET last_login_at')) {
      const account = accounts.find((user) =>
        user.id === values[0] &&
        user.clinic_id === values[1] &&
        user.status === 'active'
      );
      if (!account) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          id: account.id,
          clinic_id: account.clinic_id,
          name: account.name,
          email: account.email,
          role: account.role,
          token_version: account.token_version,
        }],
        rowCount: 1,
      };
    }

    const user = accounts.find((account) =>
      account.id === values[0] && account.clinic_id === values[1]
    );
    if (!user) return { rows: [], rowCount: 0 };
    return { rows: [{ ...user }], rowCount: 1 };
  };
}

before(async () => {
  for (const account of accounts) {
    account.password_hash = await hashPassword(password);
  }
  const queryExecutor = createQueryExecutor();
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter({
    login: (credentials) => loginUser(credentials, { queryExecutor }),
    selectClinic: (selection) => selectLoginClinic(selection, { queryExecutor }),
  }));
  app.get(
    '/api/protected/:clinicId',
    createAuthenticateToken({ queryExecutor }),
    requireClinicAccess,
    (req, res) => res.status(200).json({ ok: true, clinicId: req.clinicId, role: req.user.role })
  );
  app.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({ ok: false, message: error.message });
  });
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
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

async function getProtected(clinicId, token) {
  const response = await fetch(`${baseUrl}/protected/${clinicId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

test('credential login returns a verified clinic choice, issues a tenant-bound JWT, and protects other clinic data', async () => {
  const invalid = await post('/auth/login', { email, password: 'incorrect-password' });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.message, 'Credenciais inválidas.');

  const login = await post('/auth/login', {
    email,
    password,
    clinicId: 'untrusted-client-clinic',
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.requiresClinicSelection, true);
  assert.equal(login.body.data.clinics.length, 2);

  const selection = await post('/auth/login/select-clinic', {
    selectionToken: login.body.data.selectionToken,
    clinicId: accounts[1].clinic_id,
  });
  assert.equal(selection.status, 200);
  assert.equal(selection.body.data.user.id, accounts[1].id);

  const authorized = await getProtected(accounts[1].clinic_id, selection.body.data.token);
  assert.equal(authorized.status, 200);
  assert.equal(authorized.body.clinicId, accounts[1].clinic_id);
  assert.equal(authorized.body.role, accounts[1].role);

  const crossClinic = await getProtected(accounts[0].clinic_id, selection.body.data.token);
  assert.equal(crossClinic.status, 403);
});

test('protected routes reject missing and modified JWTs', async () => {
  assert.equal((await getProtected(accounts[0].clinic_id, null)).status, 401);
  const login = await post('/auth/login', { email, password });
  const selection = await post('/auth/login/select-clinic', {
    selectionToken: login.body.data.selectionToken,
    clinicId: accounts[0].clinic_id,
  });
  const tamperedToken = `${selection.body.data.token.slice(0, -1)}x`;
  const response = await getProtected(accounts[0].clinic_id, tamperedToken);
  assert.equal(response.status, 401);
});

test('expired account-selection tokens cannot be exchanged for a user session', async () => {
  const login = await post('/auth/login', { email, password });
  const decoded = jwt.decode(login.body.data.selectionToken);
  const expiredToken = jwt.sign(
    {
      accounts: accounts.map(({ id, clinic_id: clinicId }) => ({ userId: id, clinicId })),
      iat: Math.floor(Date.now() / 1000) - 301,
    },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      audience: 'sistema-de-agendamentos-clinic-selection',
      expiresIn: '5m',
      issuer: 'sistema-de-agendamentos-api',
    }
  );
  assert.ok(decoded.exp > Math.floor(Date.now() / 1000));
  assert.equal((await post('/auth/login/select-clinic', {
    selectionToken: expiredToken,
    clinicId: accounts[0].clinic_id,
  })).status, 401);
});
