import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hashPassword } from '../src/utils/password.js';

const enabled = process.env.RUN_PLATFORM_ADMIN_DATABASE_INTEGRATION === '1';
const expectedDatabase = 'platform_admin_test';
const expectedPort = 55440;
const expectedUser = 'postgres';

if (enabled) {
  process.env.NODE_ENV = 'test';
  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_PORT = String(expectedPort);
  process.env.DB_NAME = expectedDatabase;
  process.env.DB_USER = expectedUser;
  process.env.DB_PASSWORD = '';
  process.env.DB_SSL = 'false';
  process.env.JWT_SECRET = 'platform-admin-database-test-secret-at-least-32-bytes';
}

test('platform admin migration, isolated login, global metrics, filtering, audit, and access separation', {
  skip: !enabled,
}, async (t) => {
  const { Client } = pg;
  const client = new Client({
    host: '127.0.0.1',
    port: expectedPort,
    database: expectedDatabase,
    user: expectedUser,
  });
  const migrationClient = new Client({
    host: '127.0.0.1',
    port: expectedPort,
    database: 'postgres',
    user: expectedUser,
  });
  let migrationTarget;
  let pool;
  let server;
  const clinicIds = Array.from({ length: 5 }, () => randomUUID());
  const userIds = Array.from({ length: 5 }, () => randomUUID());
  const subscriptionIds = Array.from({ length: 5 }, () => randomUUID());
  const platformAdminId = randomUUID();
  const password = 'Synthetic-global-admin-password-2026!';
  const email = `platform.owner.${randomUUID()}@example.invalid`;
  const names = ['Synthetic Clinic Alpha', 'Synthetic Clinic Beta', 'Synthetic Clinic Gamma', 'Synthetic Clinic Delta', 'Synthetic Clinic Epsilon'];

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

    await migrationClient.connect();
    const migrationIdentity = await migrationClient.query(`
      SELECT current_database() AS database, current_user AS username,
             inet_server_port() AS server_port
    `);
    assert.equal(migrationIdentity.rows[0].database, 'postgres');
    assert.equal(migrationIdentity.rows[0].username, expectedUser);
    assert.equal(Number(migrationIdentity.rows[0].server_port), expectedPort);
    const migrationDatabaseExists = await migrationClient.query(
      "SELECT 1 FROM pg_database WHERE datname = 'platform_admin_migration_test'"
    );
    assert.equal(migrationDatabaseExists.rowCount, 0);
    await migrationClient.query('CREATE DATABASE platform_admin_migration_test');
    migrationTarget = new Client({
      host: '127.0.0.1',
      port: expectedPort,
      database: 'platform_admin_migration_test',
      user: expectedUser,
    });
    await migrationTarget.connect();
    const migration = await readFile(
      new URL('../../database/migrations/010_platform_admin_accounts.sql', import.meta.url),
      'utf8'
    );
    await migrationTarget.query(migration);
    const migratedTables = await migrationTarget.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('platform_admin_accounts', 'platform_audit_logs')
       ORDER BY table_name`
    );
    assert.deepEqual(migratedTables.rows.map((row) => row.table_name), [
      'platform_admin_accounts',
      'platform_audit_logs',
    ]);

    const schema = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8');
    await client.query(schema);
    const passwordHash = await hashPassword(password);
    for (let index = 0; index < clinicIds.length; index += 1) {
      await client.query(
        `INSERT INTO clinics (id, name, trade_name, email, phone)
         VALUES ($1, $2, $2, $3, $4)`,
        [clinicIds[index], names[index], `clinic.${index}@example.invalid`, `+55119999999${index}`]
      );
      await client.query(
        `INSERT INTO users (id, clinic_id, name, email, password_hash, role, status)
         VALUES ($1, $2, $3, $4, $5, 'admin', 'active')`,
        [userIds[index], clinicIds[index], `Synthetic Admin ${index}`, `admin.${index}@example.invalid`, passwordHash]
      );
    }

    const now = new Date();
    const start = new Date(now.getTime() - 7 * 86400000);
    const end = new Date(now.getTime() + 30 * 86400000);
    const expiredEnd = new Date(now.getTime() - 3 * 86400000);
    const statuses = [
      { plan: 'essential', billingCycle: 'quarterly', status: 'active', periodEnd: end },
      { plan: 'professional', billingCycle: 'yearly', status: 'active', periodEnd: end },
      { plan: 'essential', billingCycle: 'monthly', status: 'past_due', periodEnd: end },
      { plan: 'essential', billingCycle: 'monthly', status: 'cancelled', periodEnd: end },
      { plan: 'professional', billingCycle: 'yearly', status: 'expired', periodEnd: expiredEnd },
    ];
    for (let index = 0; index < statuses.length; index += 1) {
      const subscription = statuses[index];
      await client.query(
        `INSERT INTO subscriptions
           (id, clinic_id, plan, billing_cycle, status, started_at, current_period_start,
            current_period_end, cancelled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8)`,
        [
          subscriptionIds[index],
          clinicIds[index],
          subscription.plan,
          subscription.billingCycle,
          subscription.status,
          start,
          subscription.periodEnd,
          subscription.status === 'cancelled' ? now : null,
        ]
      );
      await client.query(
        `INSERT INTO audit_logs (clinic_id, user_id, entity_type, entity_id, action, details)
         VALUES ($1, $2, 'subscriptions', $3, 'subscription.created', $4::jsonb)`,
        [
          clinicIds[index],
          userIds[index],
          subscriptionIds[index],
          JSON.stringify({ plan: subscription.plan, billingCycle: subscription.billingCycle, status: subscription.status }),
        ]
      );
    }
    await client.query(
      `INSERT INTO platform_admin_accounts (id, email, name, password_hash)
       VALUES ($1, LOWER($2), 'Synthetic Platform Owner', $3)`,
      [platformAdminId, email, passwordHash]
    );

    const { pool: dbPool } = await import('../src/db/index.js');
    pool = dbPool;
    const { createPlatformAdminRouter } = await import('../src/routes/platformAdminRoutes.js');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.requestId = randomUUID();
      next();
    });
    app.use('/api/platform', createPlatformAdminRouter());
    app.use((req, res) => res.status(404).json({ ok: false, message: 'Not found.' }));
    app.use((error, req, res, next) => {
      if (res.headersSent) return next(error);
      res.status(error.statusCode || 500).json({
        ok: false,
        message: error.statusCode ? error.message : 'Internal error.',
      });
    });
    server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/platform`;
    async function send(path, { method = 'GET', body, token } = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }

    await t.test('valid global login issues a distinct JWT audience and exposes no clinic claim', async () => {
      const login = await send('/auth/login', {
        method: 'POST',
        body: { email: email.toUpperCase(), password },
      });
      assert.equal(login.status, 200);
      assert.equal(login.body.data.user.id, platformAdminId);
      const decoded = jwt.verify(login.body.data.token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
        audience: 'noa-connect-platform-admin',
        issuer: 'sistema-de-agendamentos-api',
      });
      assert.equal(decoded.scope, 'platform_admin');
      assert.equal(decoded.clinicId, undefined);
      assert.equal((await send('/auth/me', { token: login.body.data.token })).status, 200);
      await client.query('UPDATE platform_admin_accounts SET token_version = token_version + 1 WHERE id = $1', [platformAdminId]);
      assert.equal((await send('/dashboard', { token: login.body.data.token })).status, 401);
      await client.query('UPDATE platform_admin_accounts SET token_version = token_version - 1 WHERE id = $1', [platformAdminId]);
    });

    let adminToken;
    await t.test('bad credentials remain generic and platform routes reject clinic and missing tokens', async () => {
      const wrongPassword = await send('/auth/login', {
        method: 'POST',
        body: { email, password: 'wrong-synthetic-password' },
      });
      const missingEmail = await send('/auth/login', {
        method: 'POST',
        body: { email: `missing.${randomUUID()}@example.invalid`, password },
      });
      assert.equal(wrongPassword.status, 401);
      assert.equal(missingEmail.status, 401);
      assert.equal(wrongPassword.body.message, missingEmail.body.message);

      const adminLogin = await send('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      adminToken = adminLogin.body.data.token;
      assert.equal((await send('/dashboard')).status, 401);
      const clinicToken = jwt.sign(
        { clinicId: clinicIds[0], sessionVersion: 0 },
        process.env.JWT_SECRET,
        {
          algorithm: 'HS256',
          audience: 'sistema-de-agendamentos-client',
          expiresIn: '1h',
          issuer: 'sistema-de-agendamentos-api',
          subject: userIds[0],
        }
      );
      assert.equal((await send('/dashboard', { token: clinicToken })).status, 401);
      assert.equal((await send('/dashboard', { token: `${adminToken.slice(0, -1)}x` })).status, 401);
      const expiredToken = jwt.sign(
        { scope: 'platform_admin', sessionVersion: 0 },
        process.env.JWT_SECRET,
        {
          algorithm: 'HS256',
          audience: 'noa-connect-platform-admin',
          expiresIn: '-1s',
          issuer: 'sistema-de-agendamentos-api',
          subject: platformAdminId,
        }
      );
      assert.equal((await send('/dashboard', { token: expiredToken })).status, 401);
    });

    await t.test('global dashboard calculates MRR/ARR without counting clinic appointment payments as SaaS revenue', async () => {
      const date = now.toISOString().slice(0, 10);
      const from = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);
      const response = await send(`/dashboard?from=${from}&to=${date}`, { token: adminToken });
      assert.equal(response.status, 200);
      assert.equal(response.body.data.metrics.totalClinics, 5);
      assert.equal(response.body.data.metrics.activeSubscriptions, 2);
      assert.equal(response.body.data.metrics.newContracts, 5);
      assert.equal(response.body.data.metrics.cancelledSubscriptions, 1);
      assert.equal(response.body.data.metrics.delinquentSubscriptions, 1);
      assert.equal(response.body.data.metrics.expiredSubscriptions, 1);
      assert.equal(response.body.data.metrics.mrrEstimateInCents, 33333);
      assert.equal(response.body.data.metrics.arrEstimateInCents, 399996);
      assert.equal(response.body.data.metrics.activeSubscriptionsWithoutPaymentConfirmation, 2);
      assert.equal(response.body.data.metrics.confirmedSubscriptionPayments.supported, false);
      assert.equal(response.body.data.metrics.pendingSubscriptionCharges.supported, false);
      assert.equal(response.body.data.contractsTimeline.length, 3);
      assert.equal(response.body.data.contractsTimeline[0].contracts, 0);
      assert.equal(response.body.data.contractsTimeline[2].contracts, 5);
      assert.equal(response.body.data.planDistribution.length, 2);
    });

    await t.test('clinic and subscription search, filters, pagination and detail endpoints return only requested fields', async () => {
      const list = await send('/clinics?page=1&pageSize=2', { token: adminToken });
      assert.equal(list.status, 200);
      assert.equal(list.body.data.length, 2);
      assert.equal(list.body.pagination.total, 5);
      assert.equal(list.body.pagination.totalPages, 3);

      const search = await send('/clinics?search=Synthetic%20Clinic%20Alpha', { token: adminToken });
      assert.equal(search.status, 200);
      assert.equal(search.body.data.length, 1);
      assert.equal(search.body.data[0].id, clinicIds[0]);
      assert.equal('cnpj' in search.body.data[0], false);

      const filteredClinics = await send('/clinics?status=active&plan=essential&clinicStatus=active', { token: adminToken });
      assert.equal(filteredClinics.status, 200);
      assert.equal(filteredClinics.body.data.length, 1);
      assert.equal(filteredClinics.body.data[0].id, clinicIds[0]);

      const active = await send('/subscriptions?status=active&pageSize=1', { token: adminToken });
      assert.equal(active.status, 200);
      assert.equal(active.body.data.length, 1);
      assert.equal(active.body.pagination.total, 2);
      assert.equal(active.body.data[0].monthlyEquivalentInCents, 20000);
      assert.equal(active.body.data[0].subscriptionPaymentStatus, 'unavailable');

      const detail = await send(`/clinics/${clinicIds[0]}`, { token: adminToken });
      assert.equal(detail.status, 200);
      assert.equal(detail.body.data.clinic.id, clinicIds[0]);
      assert.equal(detail.body.data.subscriptions.length, 1);
      assert.ok(Array.isArray(detail.body.data.subscriptionEvents));
      assert.equal((await send('/clinics/not-a-uuid', { token: adminToken })).status, 400);
      assert.equal((await send(`/clinics/${randomUUID()}`, { token: adminToken })).status, 404);
      assert.equal((await send('/clinics?status=pending', { token: adminToken })).status, 400);
    });

    await t.test('dashboard and sensitive views are written to the global audit log without tokens or passwords', async () => {
      const events = await send('/events?page=1&pageSize=5', { token: adminToken });
      assert.equal(events.status, 200);
      assert.ok(events.body.data.some((event) => event.event_type === 'subscription.created'));
      const audit = await client.query(
        `SELECT action, details FROM platform_audit_logs
         WHERE platform_admin_id = $1`,
        [platformAdminId]
      );
      assert.ok(audit.rows.some((row) => row.action === 'platform.dashboard.view'));
      assert.ok(audit.rows.some((row) => row.action === 'platform.clinics.list'));
      const auditText = JSON.stringify(audit.rows);
      assert.equal(auditText.includes(adminToken), false);
      assert.equal(auditText.includes(password), false);
    });

    await t.test('logout revokes the current token', async () => {
      const login = await send('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      const token = login.body.data.token;
      assert.equal((await send('/auth/logout', { method: 'POST', token })).status, 200);
      assert.equal((await send('/dashboard', { token })).status, 401);
    });
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    if (pool) await pool.end();
    await client.end();
    if (migrationTarget) await migrationTarget.end();
    await migrationClient.end();
  }
});
