import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import pg from 'pg';

test(
  'real PostgreSQL plan limits, feature gates, subscription status, and concurrent quota enforcement',
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
    const { createSubscriptionService } = await import('../src/services/subscriptionService.js');
    const { assertPlanResourceLimit } = await import('../src/services/planAccess.js');
    const { pool, withTransaction } = await import('../src/db/index.js');
    const client = new pg.Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectionTimeoutMillis: 4000,
    });
    const clinicIds = [];
    const uniqueSuffix = randomUUID();
    const password = randomBytes(24).toString('base64url');
    const clinicByPlan = {};
    let server;
    let baseUrl;
    let countsBefore;
    let connected = false;

    async function getCounts() {
      const result = await client.query(`
        SELECT
          (SELECT count(*)::int FROM clinics) AS clinics,
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM subscriptions) AS subscriptions,
          (SELECT count(*)::int FROM professionals) AS professionals,
          (SELECT count(*)::int FROM patients) AS patients,
          (SELECT count(*)::int FROM services) AS services,
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
      return { status: response.status, body: await response.json().catch(() => null) };
    }

    async function createProfessional(token, name, fields = {}) {
      return request('/professionals', token, {
        method: 'POST',
        body: JSON.stringify({ name, specialtyId: fields.specialtyId, ...fields.body }),
      });
    }

    async function createService(token, name) {
      return request('/services', token, {
        method: 'POST',
        body: JSON.stringify({ name, durationMinutes: 30, price: 0, professionalIds: [] }),
      });
    }

    try {
      await client.connect();
      connected = true;
      const identity = await client.query(`
        SELECT current_database() AS database, inet_server_port() AS port,
               current_setting('server_version_num') AS version,
               EXISTS (
                 SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.subscriptions'::regclass
                   AND conname = 'subscriptions_plan_check'
                   AND pg_get_constraintdef(oid) LIKE '%essential%'
                   AND pg_get_constraintdef(oid) LIKE '%professional%'
                   AND pg_get_constraintdef(oid) LIKE '%premium%'
               ) AS tier_migration_applied
      `);
      assert.equal(identity.rows[0].database, 'agendamento_test');
      assert.equal(Number(identity.rows[0].port), 5432);
      assert.ok(Number(identity.rows[0].version) >= 160000);
      assert.ok(Number(identity.rows[0].version) < 170000);
      assert.equal(identity.rows[0].tier_migration_applied, true);

      countsBefore = await getCounts();
      const secretHash = await bcrypt.hash(password, 12);
      const specialtyIds = {};
      for (const [label, plan] of [
        ['essential', 'essential'],
        ['professional', 'professional'],
        ['premium', 'premium'],
        ['unsubscribed', null],
      ]) {
        const clinicId = randomUUID();
        const userId = randomUUID();
        const specialtyId = randomUUID();
        const email = `plan-limit-${label}-${uniqueSuffix}@example.invalid`;
        clinicIds.push(clinicId);
        await client.query('INSERT INTO clinics (id, name) VALUES ($1, $2)', [
          clinicId,
          `Synthetic Plan Limit ${label} ${uniqueSuffix}`,
        ]);
        await client.query(
          `INSERT INTO users (id, clinic_id, name, email, password_hash, role, status)
           VALUES ($1, $2, $3, $4, $5, 'admin', 'active')`,
          [userId, clinicId, `Synthetic Admin ${label}`, email, secretHash]
        );
        await client.query(
          'INSERT INTO specialties (id, clinic_id, name) VALUES ($1, $2, $3)',
          [specialtyId, clinicId, `Specialty ${label} ${uniqueSuffix}`]
        );
        clinicByPlan[label] = { id: clinicId, userId, specialtyId, email, plan };
        specialtyIds[label] = specialtyId;
      }

      const subscriptionService = createSubscriptionService();
      for (const [label, billingCycle] of [
        ['essential', 'monthly'],
        ['professional', 'quarterly'],
        ['premium', 'yearly'],
      ]) {
        const periodStart = new Date(Date.now() - 60_000);
        const periodEnd = new Date(periodStart);
        periodEnd.setUTCMonth(periodEnd.getUTCMonth() + ({ monthly: 1, quarterly: 3, yearly: 12 })[billingCycle]);
        await subscriptionService.createSubscription({
          clinicId: clinicByPlan[label].id,
          userId: clinicByPlan[label].userId,
          plan: clinicByPlan[label].plan,
          billingCycle,
          status: 'active',
          startedAt: periodStart,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        });
      }

      server = createServer(app);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      baseUrl = `http://127.0.0.1:${server.address().port}/api`;

      const tokens = {};
      for (const label of Object.keys(clinicByPlan)) {
        const clinic = clinicByPlan[label];
        const login = await request('/auth/login', null, {
          method: 'POST',
          body: JSON.stringify({ email: clinic.email, password }),
        });
        assert.equal(login.status, 200);
        tokens[label] = login.body.data.token;
      }

      const inactiveEmployee = await createProfessional(
        tokens.essential,
        'Essential inactive employee',
        { specialtyId: specialtyIds.essential, body: { status: 'inactive' } }
      );
      assert.equal(inactiveEmployee.status, 201);
      const initialEmployees = [];
      for (let index = 0; index < 4; index += 1) {
        const created = await createProfessional(
          tokens.essential,
          `Essential employee ${index + 1}`,
          { specialtyId: specialtyIds.essential }
        );
        assert.equal(created.status, 201);
        initialEmployees.push(created.body.data.id);
      }

      const concurrentProfessionalRequests = await Promise.all([
        createProfessional(tokens.essential, 'Essential concurrent A', {
          specialtyId: specialtyIds.essential,
          body: { plan: 'premium' },
        }),
        createProfessional(tokens.essential, 'Essential concurrent B', {
          specialtyId: specialtyIds.essential,
          body: { plan: 'premium' },
        }),
      ]);
      assert.deepEqual(
        concurrentProfessionalRequests.map(({ status }) => status).sort(),
        [201, 403]
      );
      const blockedProfessional = concurrentProfessionalRequests.find(({ status }) => status === 403);
      assert.deepEqual(
        Object.fromEntries(
          ['error', 'resource', 'limit', 'current', 'plan'].map((key) => [key, blockedProfessional.body[key]])
        ),
        {
          error: 'PLAN_LIMIT_REACHED',
          resource: 'professionals',
          limit: 5,
          current: 5,
          plan: 'essential',
        }
      );
      const essentialSubscription = await client.query(
        'SELECT plan FROM subscriptions WHERE clinic_id = $1',
        [clinicByPlan.essential.id]
      );
      assert.equal(essentialSubscription.rows[0].plan, 'essential');
      const sixthEmployee = await createProfessional(
        tokens.essential,
        'Essential sixth active employee',
        { specialtyId: specialtyIds.essential }
      );
      assert.equal(sixthEmployee.status, 403);
      assert.equal(sixthEmployee.body.error, 'PLAN_LIMIT_REACHED');
      assert.equal(sixthEmployee.body.limit, 5);
      assert.equal(sixthEmployee.body.current, 5);

      for (const method of ['PATCH', 'PUT']) {
        const response = method === 'PATCH'
          ? await request(`/professionals/${inactiveEmployee.body.data.id}/status`, tokens.essential, {
              method,
              body: JSON.stringify({ status: 'active' }),
            })
          : await request(`/professionals/${inactiveEmployee.body.data.id}`, tokens.essential, {
              method,
              body: JSON.stringify({ status: 'active' }),
            });
        assert.equal(response.status, 403);
        assert.equal(response.body.error, 'PLAN_LIMIT_REACHED');
        assert.equal(response.body.current, 5);
      }

      const secondInactiveEmployee = await createProfessional(
        tokens.essential,
        'Essential second inactive employee',
        { specialtyId: specialtyIds.essential, body: { status: 'inactive' } }
      );
      assert.equal(secondInactiveEmployee.status, 201);

      const deactivateFirst = await request(
        `/professionals/${initialEmployees[0]}/status`,
        tokens.essential,
        { method: 'PATCH', body: JSON.stringify({ status: 'inactive' }) }
      );
      assert.equal(deactivateFirst.status, 200);
      const reactivateFirst = await request(
        `/professionals/${inactiveEmployee.body.data.id}/status`,
        tokens.essential,
        { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }
      );
      assert.equal(reactivateFirst.status, 200);

      const deactivateSecond = await request(
        `/professionals/${initialEmployees[1]}`,
        tokens.essential,
        { method: 'PUT', body: JSON.stringify({ status: 'inactive' }) }
      );
      assert.equal(deactivateSecond.status, 200);
      const reactivateSecond = await request(
        `/professionals/${secondInactiveEmployee.body.data.id}`,
        tokens.essential,
        { method: 'PUT', body: JSON.stringify({ status: 'active' }) }
      );
      assert.equal(reactivateSecond.status, 200);

      const invalidProfessionalStatus = await request(
        `/professionals/${initialEmployees[0]}/status`,
        tokens.essential,
        { method: 'PATCH', body: JSON.stringify({ status: 'suspended' }) }
      );
      assert.equal(invalidProfessionalStatus.status, 400);

      const essentialStaffState = await client.query(
        `SELECT
           (SELECT count(*)::int FROM professionals
            WHERE clinic_id = $1 AND status = 'active') AS active_staff,
           (SELECT count(*)::int FROM users
            WHERE clinic_id = $1 AND role = 'admin' AND status = 'active') AS active_admins`,
        [clinicByPlan.essential.id]
      );
      assert.equal(essentialStaffState.rows[0].active_staff, 5);
      assert.equal(essentialStaffState.rows[0].active_admins, 1);
      const staffAudit = await client.query(
        `SELECT action FROM audit_logs
         WHERE clinic_id = $1 AND entity_type = 'professionals'`,
        [clinicByPlan.essential.id]
      );
      assert.ok(staffAudit.rows.some(({ action }) => action === 'professional.created'));
      assert.ok(staffAudit.rows.some(({ action }) => action === 'professional.activated'));
      assert.ok(staffAudit.rows.some(({ action }) => action === 'professional.deactivated'));

      for (let index = 0; index < 7; index += 1) {
        const created = await createProfessional(
          tokens.professional,
          `Professional employee ${index + 1}`,
          { specialtyId: specialtyIds.professional }
        );
        assert.equal(created.status, 201);
      }
      const essentialRemainsAtItsOwnLimit = await createProfessional(
        tokens.essential,
        'Essential still blocked after another clinic grows',
        { specialtyId: specialtyIds.essential }
      );
      assert.equal(essentialRemainsAtItsOwnLimit.status, 403);
      assert.equal(essentialRemainsAtItsOwnLimit.body.current, 5);
      assert.equal(essentialRemainsAtItsOwnLimit.body.plan, 'essential');

      for (let index = 0; index < 7; index += 1) {
        const created = await createProfessional(
          tokens.premium,
          `Premium professional ${index + 1}`,
          { specialtyId: specialtyIds.premium }
        );
        assert.equal(created.status, 201);
      }

      for (const [label, count] of [['essential', 300], ['professional', 2000], ['premium', 2010]]) {
        await client.query(
          `INSERT INTO patients (clinic_id, name)
           SELECT $1, 'Synthetic patient ' || series::text
           FROM generate_series(1, $2::int) AS series`,
          [clinicByPlan[label].id, count]
        );
      }
      for (const label of ['essential', 'professional']) {
        const patient = await request('/patients', tokens[label], {
          method: 'POST',
          body: JSON.stringify({ name: `Above previous limit ${label}` }),
        });
        assert.equal(patient.status, 201);
      }
      const premiumPatient = await request('/patients', tokens.premium, {
        method: 'POST',
        body: JSON.stringify({ name: 'Premium patient above Pro limit' }),
      });
      assert.equal(premiumPatient.status, 201);

      for (const [label, count] of [['essential', 10], ['professional', 50], ['premium', 55]]) {
        await client.query(
          `INSERT INTO services (clinic_id, name, duration_minutes, price)
           SELECT $1, 'Synthetic service ' || series::text, 30, 0
           FROM generate_series(1, $2::int) AS series`,
          [clinicByPlan[label].id, count]
        );
      }
      for (const label of ['essential', 'professional']) {
        const service = await createService(tokens[label], `Above previous limit ${label}`);
        assert.equal(service.status, 201);
      }
      const premiumService = await createService(tokens.premium, 'Premium service above Pro limit');
      assert.equal(premiumService.status, 201);

      for (let index = 0; index < 4; index += 1) {
        await client.query(
          `INSERT INTO users (clinic_id, name, email, password_hash, role, status)
           VALUES ($1, $2, $3, $4, 'reception', 'active')`,
          [
            clinicByPlan.professional.id,
            `Professional reception ${index + 1}`,
            `professional-reception-${index}-${uniqueSuffix}@example.invalid`,
            secretHash,
          ]
        );
      }
      const proUserBeyondOldLimit = await request('/auth/register', tokens.professional, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Reception over limit',
          email: `pro-overlimit-${uniqueSuffix}@example.invalid`,
          password,
          role: 'reception',
        }),
      });
      assert.equal(proUserBeyondOldLimit.status, 201);

      for (let index = 0; index < 6; index += 1) {
        await client.query(
          `INSERT INTO users (clinic_id, name, email, password_hash, role, status)
           VALUES ($1, $2, $3, $4, 'reception', 'active')`,
          [
            clinicByPlan.premium.id,
            `Premium reception ${index + 1}`,
            `premium-reception-${index}-${uniqueSuffix}@example.invalid`,
            secretHash,
          ]
        );
      }
      const premiumUserCount = await client.query(
        `SELECT count(*)::int AS total FROM users
         WHERE clinic_id = $1 AND role IN ('admin', 'reception')`,
        [clinicByPlan.premium.id]
      );
      assert.equal(premiumUserCount.rows[0].total, 7);
      const premiumUserQuota = await withTransaction(
        (transaction) => assertPlanResourceLimit(transaction, clinicByPlan.premium.id, 'users')
      );
      assert.equal(premiumUserQuota.limit, null);

      for (const resource of ['patients', 'appointments', 'services', 'users']) {
        const unlimitedResource = await withTransaction(
          (transaction) => assertPlanResourceLimit(transaction, clinicByPlan.essential.id, resource)
        );
        assert.equal(unlimitedResource.limit, null);
      }

      const essentialAudit = await request('/audit', tokens.essential);
      assert.equal(essentialAudit.status, 403);
      assert.equal(essentialAudit.body.error, 'PLAN_FEATURE_NOT_AVAILABLE');
      assert.equal(essentialAudit.body.feature, 'audit');
      assert.equal((await request('/audit', tokens.professional)).status, 200);
      assert.equal((await request('/payments', tokens.essential)).status, 403);
      assert.equal((await request('/payments', tokens.professional)).status, 200);

      const noSubscription = await request('/appointments', tokens.unsubscribed);
      assert.equal(noSubscription.status, 403);
      assert.equal(noSubscription.body.error, 'PLAN_SUBSCRIPTION_REQUIRED');

      const foreignClinicPayload = await request('/professionals', tokens.professional, {
        method: 'POST',
        body: JSON.stringify({
          clinicId: clinicByPlan.essential.id,
          name: 'Cross-clinic attempt',
          specialtyId: specialtyIds.professional,
        }),
      });
      assert.equal(foreignClinicPayload.status, 403);

      const tenantCounts = await client.query(
        `SELECT clinic_id, count(*)::int AS total
         FROM professionals
         WHERE clinic_id = ANY($1::uuid[])
         GROUP BY clinic_id`,
        [clinicIds]
      );
      assert.ok(tenantCounts.rows.every(({ clinic_id }) => clinicIds.includes(clinic_id)));
    } finally {
      if (server?.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
      if (connected) {
        await client.query('DELETE FROM clinics WHERE id = ANY($1::uuid[])', [clinicIds]);
        if (countsBefore) {
          const countsAfter = await getCounts();
          assert.deepEqual(countsAfter, countsBefore);
        }
        await client.end();
      }
      await pool.end();
    }
  }
);
