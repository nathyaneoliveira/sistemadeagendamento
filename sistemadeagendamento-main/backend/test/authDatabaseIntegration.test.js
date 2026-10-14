import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hashPassword } from '../src/utils/password.js';

const enabled = process.env.RUN_AUTH_DATABASE_INTEGRATION === '1';
const expectedDatabase = 'auth_login_test';
const expectedPort = 55439;
const expectedUser = 'postgres';

if (enabled) {
  process.env.NODE_ENV = 'test';
  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_PORT = String(expectedPort);
  process.env.DB_NAME = expectedDatabase;
  process.env.DB_USER = expectedUser;
  process.env.DB_PASSWORD = '';
  process.env.DB_SSL = 'false';
  process.env.JWT_SECRET = 'auth-database-integration-only-secret-32-bytes';
}

test('email/password authentication, clinic selection, JWT, and tenant scope use an isolated PostgreSQL database', {
  skip: !enabled,
}, async (t) => {
  const { Client } = pg;
  const client = new Client({
    host: process.env.DB_HOST,
    port: expectedPort,
    database: expectedDatabase,
    user: expectedUser,
  });
  let pool;
  let server;
  let identityVerified = false;
  const clinicIds = [randomUUID(), randomUUID(), randomUUID()];
  const userIds = Array.from({ length: 4 }, () => randomUUID());
  const uniqueSuffix = randomUUID();
  const password = 'Synthetic-auth-database-test-password!';
  const email = `duplicate.${uniqueSuffix}@example.invalid`;
  const clinics = [
    { id: clinicIds[0], name: 'Synthetic Clinic A' },
    { id: clinicIds[1], name: 'Synthetic Clinic B' },
    { id: clinicIds[2], name: 'Synthetic Clinic C' },
  ];

  try {
    await client.connect();
    const identity = await client.query(`
      SELECT current_database() AS database, current_user AS username,
             inet_server_port() AS server_port
    `);
    assert.equal(identity.rows[0].database, expectedDatabase);
    assert.equal(identity.rows[0].username, expectedUser);
    assert.equal(Number(identity.rows[0].server_port), expectedPort);
    const existingTables = await client.query(
      "SELECT COUNT(*)::integer AS count FROM pg_tables WHERE schemaname = 'public'"
    );
    assert.equal(existingTables.rows[0].count, 0);
    identityVerified = true;

    const schema = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8');
    await client.query(schema);

    const passwordHash = await hashPassword(password);
    for (const clinic of clinics) {
      await client.query('INSERT INTO clinics (id, name) VALUES ($1, $2)', [clinic.id, clinic.name]);
    }
    await client.query(
      `INSERT INTO users (id, clinic_id, name, email, password_hash, role, status)
       VALUES
         ($1, $2, 'Synthetic Admin', $3, $4, 'admin', 'active'),
         ($5, $6, 'Synthetic Reception', $7, $4, 'reception', 'active'),
         ($8, $9, 'Synthetic Professional', $10, $4, 'professional', 'active'),
         ($11, $12, 'Synthetic Patient', $13, $4, 'patient', 'active')`,
      [
        userIds[0], clinics[0].id, `admin.${uniqueSuffix}@example.invalid`, passwordHash,
        userIds[1], clinics[0].id, `reception.${uniqueSuffix}@example.invalid`,
        userIds[2], clinics[0].id, `professional.${uniqueSuffix}@example.invalid`,
        userIds[3], clinics[0].id, `patient.${uniqueSuffix}@example.invalid`,
      ]
    );
    await client.query(
      `INSERT INTO users (clinic_id, name, email, password_hash, role, status)
       VALUES ($1, 'Synthetic Duplicate A', $3, $4, 'admin', 'active'),
              ($2, 'Synthetic Duplicate B', $3, $4, 'professional', 'active')`,
      [clinics[0].id, clinics[1].id, email, passwordHash]
    );
    await client.query(
      `INSERT INTO users (clinic_id, name, email, password_hash, role, status)
       VALUES ($1, 'Synthetic Inactive', $2, $3, 'patient', 'inactive')`,
      [clinics[2].id, `inactive.${uniqueSuffix}@example.invalid`, passwordHash]
    );

    const { pool: dbPool } = await import('../src/db/index.js');
    pool = dbPool;
    const { createAuthRouter } = await import('../src/routes/authRoutes.js');
    const { authenticateToken, requireClinicAccess } = await import('../src/middlewares/auth.js');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter());
    app.get(
      '/api/protected/:clinicId',
      authenticateToken,
      requireClinicAccess,
      (req, res) => res.status(200).json({ ok: true, clinicId: req.clinicId, role: req.user.role })
    );
    app.use((error, req, res, next) => {
      res.status(error.statusCode || 500).json({ ok: false, message: error.message });
    });
    server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

    async function request(path, { body, token } = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    }

    await t.test('valid credentials for each existing role resolve the clinic without client clinic input', async () => {
      for (const [role, accountEmail, userId] of [
        ['admin', `admin.${uniqueSuffix}@example.invalid`, userIds[0]],
        ['reception', `reception.${uniqueSuffix}@example.invalid`, userIds[1]],
        ['professional', `professional.${uniqueSuffix}@example.invalid`, userIds[2]],
        ['patient', `patient.${uniqueSuffix}@example.invalid`, userIds[3]],
      ]) {
        const login = await request('/auth/login', {
          body: { email: accountEmail, password, clinicId: clinics[1].id },
        });
        assert.equal(login.status, 200);
        assert.equal(login.body.data.user.id, userId);
        assert.equal(login.body.data.user.clinicId, clinics[0].id);
        assert.equal(login.body.data.user.role, role);
      }
    });

    await t.test('wrong password, unknown email, inactive account, and empty input do not authenticate', async () => {
      const failures = [];
      for (const credentials of [
        { email, password: 'wrong-password' },
        { email: `missing.${uniqueSuffix}@example.invalid`, password },
        { email: `inactive.${uniqueSuffix}@example.invalid`, password },
      ]) {
        const response = await request('/auth/login', { body: credentials });
        failures.push({ status: response.status, message: response.body.message });
      }
      assert.equal((await request('/auth/login', { body: {} })).status, 400);
      assert.deepEqual(failures[0], failures[1]);
      assert.deepEqual(failures[0], failures[2]);
    });

    await t.test('duplicate matching emails require a signed choice restricted to the matching clinics', async () => {
      const login = await request('/auth/login', { body: { email, password } });
      assert.equal(login.status, 200);
      assert.equal(login.body.data.requiresClinicSelection, true);
      assert.deepEqual(
        login.body.data.clinics.map(({ clinicId }) => clinicId).sort(),
        clinics.slice(0, 2).map(({ id }) => id).sort()
      );

      const invalidChoice = await request('/auth/login/select-clinic', {
        body: { selectionToken: login.body.data.selectionToken, clinicId: clinics[2].id },
      });
      assert.equal(invalidChoice.status, 401);

      const selected = await request('/auth/login/select-clinic', {
        body: { selectionToken: login.body.data.selectionToken, clinicId: clinics[1].id },
      });
      assert.equal(selected.status, 200);
      assert.equal(selected.body.data.user.clinicId, clinics[1].id);
      assert.equal((await request(`/protected/${clinics[1].id}`, { token: selected.body.data.token })).status, 200);
      assert.equal((await request(`/protected/${clinics[0].id}`, { token: selected.body.data.token })).status, 403);
      assert.equal((await request(`/protected/${clinics[1].id}`)).status, 401);
    });
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (pool) await pool.end();
    if (identityVerified) {
      await client.query('DELETE FROM users WHERE clinic_id = ANY($1::uuid[])', [clinicIds]);
      await client.query('DELETE FROM clinics WHERE id = ANY($1::uuid[])', [clinicIds]);
    }
    await client.end();
  }
});
