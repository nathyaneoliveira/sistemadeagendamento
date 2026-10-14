import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import pg from 'pg';

test(
  'real PostgreSQL subscription migration, tenant API, constraints, and audit',
  { skip: process.env.RUN_SUBSCRIPTION_DB_INTEGRATION !== '1' },
  async () => {
    assert.equal(process.env.DB_HOST, '127.0.0.1');
    assert.equal(process.env.DB_PORT, '55432');
    assert.equal(process.env.DB_NAME, 'agendamento_test');
    assert.equal(process.env.DB_USER, 'agendamento_test');
    assert.ok(process.env.DB_PASSWORD);

    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');

    const { app } = await import('../src/app.js');
    const {
      createSubscriptionService,
      SUBSCRIPTION_PRICES_BY_PLAN_IN_CENTS,
    } = await import('../src/services/subscriptionService.js');
    const { pool } = await import('../src/db/index.js');
    const client = new pg.Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectionTimeoutMillis: 4000,
    });
    const clinicIds = [];
    const cycleMonths = { monthly: 1, quarterly: 3, yearly: 12 };
    const secretPassword = randomBytes(24).toString('base64url');
    const uniqueSuffix = randomUUID();
    let server;
    let baseUrl;
    let countsBefore;
    let testFailed = false;

    async function getCounts() {
      const result = await client.query(`
        SELECT
          (SELECT count(*)::int FROM clinics) AS clinics,
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM subscriptions) AS subscriptions,
          (SELECT count(*)::int FROM audit_logs) AS audit_logs
      `);
      return result.rows[0];
    }

    async function request(path, token, options = {}) {
      const headers = {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    }

    async function assertCheckConstraint(name, values) {
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO subscriptions
             (clinic_id, plan, billing_cycle, status, started_at,
              current_period_start, current_period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          values
        );
        assert.fail(`Expected check constraint ${name} to reject the row.`);
      } catch (error) {
        assert.equal(error.code, '23514');
        assert.equal(error.constraint, name);
      } finally {
        await client.query('ROLLBACK');
      }
    }

    async function assertForeignKeyConstraint(name, values) {
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO subscriptions
             (clinic_id, plan, billing_cycle, status, started_at,
              current_period_start, current_period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          values
        );
        assert.fail(`Expected foreign key ${name} to reject the row.`);
      } catch (error) {
        assert.equal(error.code, '23503');
        assert.equal(error.constraint, name);
      } finally {
        await client.query('ROLLBACK');
      }
    }

    try {
      await client.connect();
      const identity = await client.query(`
        SELECT current_database() AS database, current_user AS username,
               inet_server_port() AS server_port,
               current_setting('server_version_num') AS version,
               to_regclass('public.subscriptions') IS NOT NULL AS migrated
      `);
      assert.equal(identity.rows[0].database, 'agendamento_test');
      assert.equal(identity.rows[0].username, 'agendamento_test');
      assert.equal(Number(identity.rows[0].server_port), 5432);
      assert.ok(Number(identity.rows[0].version) >= 160000);
      assert.ok(Number(identity.rows[0].version) < 170000);
      assert.equal(identity.rows[0].migrated, true);

      countsBefore = await getCounts();
      const passwordHash = await bcrypt.hash(secretPassword, 12);
      const clinics = {};
      for (const label of ['A', 'B', 'C', 'D']) {
        const clinicId = randomUUID();
        const userId = randomUUID();
        const email = `subscription.${label.toLowerCase()}.${uniqueSuffix}@example.invalid`;
        clinicIds.push(clinicId);
        await client.query('INSERT INTO clinics (id, name) VALUES ($1, $2)', [
          clinicId,
          `Synthetic Subscription ${label} ${uniqueSuffix}`,
        ]);
        await client.query(
          `INSERT INTO users (id, clinic_id, name, email, password_hash, role, status)
           VALUES ($1, $2, $3, $4, $5, 'admin', 'active')`,
          [userId, clinicId, `Synthetic Admin ${label}`, email, passwordHash]
        );
        clinics[label] = { id: clinicId, userId, email };
      }

      server = createServer(app);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      baseUrl = `http://127.0.0.1:${server.address().port}/api`;

      const tokens = {};
      for (const label of ['A', 'B', 'C', 'D']) {
        const login = await request('/auth/login', null, {
          method: 'POST',
          body: JSON.stringify({ email: clinics[label].email, password: secretPassword }),
        });
        assert.equal(login.status, 200);
        tokens[label] = login.body.data.token;
      }

      assert.equal((await request('/subscriptions/current', null)).status, 401);
      assert.equal((await request('/subscriptions/current', tokens.A)).body.data, null);

      const service = createSubscriptionService();
      const subscriptions = {};
      for (const [label, plan, billingCycle] of [
        ['A', 'essential', 'monthly'],
        ['B', 'professional', 'quarterly'],
        ['C', 'premium', 'yearly'],
      ]) {
        const periodStart = new Date();
        const periodEnd = new Date(periodStart);
        periodEnd.setUTCMonth(periodEnd.getUTCMonth() + cycleMonths[billingCycle]);
        subscriptions[label] = await service.createSubscription({
          clinicId: clinics[label].id,
          userId: clinics[label].userId,
          plan,
          billingCycle,
          status: 'active',
          startedAt: periodStart,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        });
      }

      const expectedSubscriptions = [
        ['A', 'essential', 'monthly', 15000],
        ['B', 'professional', 'quarterly', 67500],
        ['C', 'premium', 'yearly', 384000],
      ];
      for (const [label, plan, billingCycle, priceInCents] of expectedSubscriptions) {
        assert.equal(SUBSCRIPTION_PRICES_BY_PLAN_IN_CENTS[plan][billingCycle], priceInCents);
        const current = await request('/subscriptions/current', tokens[label]);
        assert.equal(current.status, 200);
        assert.equal(current.body.data.plan, plan);
        assert.equal(current.body.data.billingCycle, billingCycle);
        assert.equal(current.body.data.priceInCents, priceInCents);
      }

      const overrideA = await request(
        `/subscriptions/current?clinicId=${clinics.B.id}`,
        tokens.A
      );
      const overrideB = await request(
        `/subscriptions/current?clinicId=${clinics.A.id}`,
        tokens.B
      );
      assert.equal(overrideA.body.data.billingCycle, 'monthly');
      assert.equal(overrideB.body.data.billingCycle, 'quarterly');
      assert.equal(
        (await request(`/subscriptions/current/${subscriptions.B.id}`, tokens.A)).status,
        404
      );
      assert.equal(
        (await request('/subscriptions/current', tokens.A, {
          method: 'PATCH',
          body: JSON.stringify({ clinicId: clinics.B.id, status: 'cancelled' }),
        })).status,
        403
      );
      assert.equal(
        (await request('/subscriptions/current', tokens.A, {
          method: 'POST',
          body: JSON.stringify({ clinicId: clinics.B.id, plan: 'premium' }),
        })).status,
        403
      );
      assert.equal((await request('/subscriptions/current', tokens.D)).body.data, null);

      const receptionEmail = `subscription.reception.${uniqueSuffix}@example.invalid`;
      await client.query(
        `INSERT INTO users (clinic_id, name, email, password_hash, role, status)
         VALUES ($1, 'Reception', $2, $3, 'reception', 'active')`,
        [clinics.A.id, receptionEmail, passwordHash]
      );
      const receptionLogin = await request('/auth/login', null, {
        method: 'POST',
        body: JSON.stringify({
          email: receptionEmail,
          password: secretPassword,
        }),
      });
      assert.equal(receptionLogin.status, 200);
      assert.equal(
        (await request('/subscriptions/current', receptionLogin.body.data.token)).status,
        403
      );

      const original = subscriptions.A;
      const insertValues = [
        clinics.A.id,
        'complete',
        'monthly',
        'active',
        original.started_at,
        original.current_period_start,
        original.current_period_end,
      ];
      const invalidPlan = [...insertValues];
      invalidPlan[1] = 'unknown';
      await assertCheckConstraint('subscriptions_plan_check', invalidPlan);
      const invalidCycle = [...insertValues];
      invalidCycle[2] = 'weekly';
      await assertCheckConstraint('subscriptions_billing_cycle_check', invalidCycle);
      const invalidStatus = [...insertValues];
      invalidStatus[3] = 'invalid';
      await assertCheckConstraint('subscriptions_status_check', invalidStatus);
      const invertedPeriod = [...insertValues];
      invertedPeriod[5] = original.current_period_end;
      invertedPeriod[6] = original.current_period_start;
      await assertCheckConstraint('ck_subscriptions_period_order', invertedPeriod);
      const missingClinic = [...insertValues];
      missingClinic[0] = randomUUID();
      await assertForeignKeyConstraint('subscriptions_clinic_id_fkey', missingClinic);

      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO subscriptions
             (clinic_id, plan, billing_cycle, status, started_at,
              current_period_start, current_period_end)
           VALUES ($1, 'complete', 'monthly', 'active', $2, $3, $4)`,
          [
            clinics.A.id,
            original.started_at,
            original.current_period_start,
            original.current_period_end,
          ]
        );
        assert.fail('Duplicate current subscription was accepted.');
      } catch (error) {
        assert.equal(error.code, '23505');
        assert.equal(error.constraint, 'uq_subscriptions_one_current_per_clinic');
      } finally {
        await client.query('ROLLBACK');
      }

      const creationAudits = await client.query(
        `SELECT clinic_id, user_id, entity_id, action, details
         FROM audit_logs
         WHERE clinic_id = ANY($1::uuid[]) AND entity_type = 'subscriptions'
         ORDER BY created_at`,
        [clinicIds]
      );
      assert.equal(creationAudits.rowCount, 3);
      for (const [index, label] of ['A', 'B', 'C'].entries()) {
        assert.equal(creationAudits.rows[index].clinic_id, clinics[label].id);
        assert.equal(creationAudits.rows[index].user_id, clinics[label].userId);
        assert.equal(creationAudits.rows[index].entity_id, subscriptions[label].id);
        assert.equal(creationAudits.rows[index].action, 'subscription.created');
        assert.equal(
          creationAudits.rows[index].details.priceInCents,
          [15000, 67500, 384000][index]
        );
        assert.equal(JSON.stringify(creationAudits.rows[index].details).includes(secretPassword), false);
      }

      await client.query('SELECT pg_sleep(0.02)');
      const cancelled = await service.transitionSubscription({
        clinicId: clinics.A.id,
        subscriptionId: subscriptions.A.id,
        userId: clinics.A.userId,
        status: 'cancelled',
      });
      assert.equal(cancelled.status, 'cancelled');
      assert.ok(cancelled.cancelled_at);
      assert.ok(cancelled.updated_at > subscriptions.A.updated_at);
      const pastDue = await service.transitionSubscription({
        clinicId: clinics.B.id,
        subscriptionId: subscriptions.B.id,
        userId: clinics.B.userId,
        status: 'past_due',
      });
      assert.equal(pastDue.status, 'past_due');
      const reactivated = await service.transitionSubscription({
        clinicId: clinics.B.id,
        subscriptionId: subscriptions.B.id,
        userId: clinics.B.userId,
        status: 'active',
      });
      assert.equal(reactivated.status, 'active');

      const replacementStart = new Date();
      const replacementEnd = new Date(replacementStart);
      replacementEnd.setUTCMonth(replacementEnd.getUTCMonth() + 1);
      await service.createSubscription({
        clinicId: clinics.A.id,
        userId: clinics.A.userId,
        billingCycle: 'monthly',
        status: 'active',
        startedAt: replacementStart,
        currentPeriodStart: replacementStart,
        currentPeriodEnd: replacementEnd,
      });
      const refreshedA = await request('/subscriptions/current', tokens.A);
      assert.equal(refreshedA.body.data.status, 'active');
      assert.equal(refreshedA.body.data.priceInCents, 14999);
      assert.equal((await request('/subscriptions/current', tokens.B)).body.data.status, 'active');

      const allSubscriptionAudits = await client.query(
        `SELECT clinic_id, user_id, entity_id, action, details
         FROM audit_logs
         WHERE clinic_id = ANY($1::uuid[]) AND entity_type = 'subscriptions'`,
        [clinicIds]
      );
      const auditCounts = Object.fromEntries(
        allSubscriptionAudits.rows.reduce((counts, event) => {
          counts.set(event.action, (counts.get(event.action) || 0) + 1);
          return counts;
        }, new Map())
      );
      assert.deepEqual(auditCounts, {
        'subscription.created': 4,
        'subscription.cancelled': 1,
        'subscription.updated': 2,
      });
      for (const event of allSubscriptionAudits.rows) {
        const clinic = Object.values(clinics).find(({ id }) => id === event.clinic_id);
        assert.ok(clinic);
        assert.equal(event.user_id, clinic.userId);
        assert.equal(JSON.stringify(event.details).includes(secretPassword), false);
      }

      const integrity = await client.query(
        `SELECT
          (SELECT count(*)::int FROM subscriptions s
           LEFT JOIN clinics c ON c.id = s.clinic_id WHERE c.id IS NULL) AS orphan_clinics,
          (SELECT count(*)::int FROM subscriptions
           WHERE plan NOT IN ('complete', 'essential', 'professional', 'premium')
              OR billing_cycle NOT IN ('monthly', 'quarterly', 'yearly')
              OR status NOT IN ('trialing', 'active', 'past_due', 'cancelled', 'expired')
              OR started_at > current_period_start
              OR current_period_start >= current_period_end
              OR (trial_ends_at IS NOT NULL AND
                  (trial_ends_at < started_at OR trial_ends_at > current_period_end))
              OR (status = 'cancelled' AND cancelled_at IS NULL)) AS invalid_rows,
          (SELECT count(*)::int FROM (
            SELECT clinic_id FROM subscriptions
            WHERE status IN ('trialing', 'active', 'past_due')
            GROUP BY clinic_id HAVING count(*) > 1
          ) duplicates) AS duplicate_current,
          (SELECT count(*)::int FROM audit_logs a
           LEFT JOIN subscriptions s ON s.id = a.entity_id AND s.clinic_id = a.clinic_id
           WHERE a.clinic_id = ANY($1::uuid[])
             AND a.entity_type = 'subscriptions' AND s.id IS NULL) AS inconsistent_audit`,
        [clinicIds]
      );
      assert.deepEqual(integrity.rows[0], {
        orphan_clinics: 0,
        invalid_rows: 0,
        duplicate_current: 0,
        inconsistent_audit: 0,
      });
    } catch (error) {
      testFailed = true;
      throw error;
    } finally {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
      try {
        if (client._connected && clinicIds.length) {
          const deleted = await client.query(
            'DELETE FROM clinics WHERE id = ANY($1::uuid[]) RETURNING id',
            [clinicIds]
          );
          const countsAfter = await getCounts();
          assert.equal(deleted.rowCount, clinicIds.length);
          assert.deepEqual(countsAfter, countsBefore);
        }
      } catch (cleanupError) {
        testFailed = true;
        if (!testFailed) throw cleanupError;
        console.error('Synthetic fixture cleanup failed; inspect the isolated test database.');
        throw cleanupError;
      } finally {
        await client.end().catch(() => {});
        await pool.end().catch(() => {});
      }
    }
  }
);
