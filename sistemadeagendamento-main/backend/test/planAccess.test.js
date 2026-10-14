import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'plan-access-tests-only-secret-at-least-32-bytes';

const {
  assertPlanCapability,
  assertPlanResourceLimit,
  loadClinicPlan,
  PlanAccessError,
} = await import('../src/services/planAccess.js');

const NOW = new Date('2026-10-07T12:00:00.000Z');

function createClient({ plan = 'essential', status = 'active', resourceCount = 0, subscription = true } = {}) {
  const statements = [];
  const client = {
    async query(text, values) {
      const normalized = text.replace(/\s+/g, ' ').trim();
      statements.push({ text: normalized, values });
      if (normalized.includes('FROM subscriptions')) {
        return subscription
          ? {
              rows: [{
                plan,
                billing_cycle: 'monthly',
                status,
                current_period_start: '2026-10-01T00:00:00.000Z',
                current_period_end: '2026-11-01T00:00:00.000Z',
                trial_ends_at: status === 'trialing' ? '2026-10-15T00:00:00.000Z' : null,
              }],
              rowCount: 1,
            }
          : { rows: [], rowCount: 0 };
      }
      if (normalized.includes('count(*)')) {
        return { rows: [{ current: resourceCount }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  return { client, statements };
}

test('active and unexpired trial subscriptions grant plan context', async () => {
  const active = createClient();
  const trial = createClient({ status: 'trialing' });

  assert.equal((await loadClinicPlan(active.client, 'clinic-a', { now: NOW })).plan.id, 'essential');
  assert.equal((await loadClinicPlan(trial.client, 'clinic-a', { now: NOW })).subscription.status, 'trialing');
});

test('missing, inactive, and out-of-period subscriptions never grant plan access', async () => {
  const missing = createClient({ subscription: false });
  await assert.rejects(
    loadClinicPlan(missing.client, 'clinic-a', { now: NOW }),
    (error) => error instanceof PlanAccessError && error.response.error === 'PLAN_SUBSCRIPTION_REQUIRED'
  );

  for (const status of ['past_due', 'cancelled', 'expired']) {
    const fixture = createClient({ status });
    await assert.rejects(
      loadClinicPlan(fixture.client, 'clinic-a', { now: NOW }),
      (error) => error instanceof PlanAccessError &&
        error.response.error === 'PLAN_SUBSCRIPTION_INACTIVE' &&
        error.response.status === status
    );
  }

  const expiredPeriod = createClient();
  await assert.rejects(
    loadClinicPlan(expiredPeriod.client, 'clinic-a', { now: new Date('2026-12-01T00:00:00.000Z') }),
    (error) => error instanceof PlanAccessError && error.response.error === 'PLAN_SUBSCRIPTION_INACTIVE'
  );
});

test('Essential caps active employees at five and ignores inactive employees', async () => {
  const essential = createClient({ resourceCount: 5 });
  await assert.rejects(
    assertPlanResourceLimit(essential.client, 'clinic-a', 'professionals', { now: NOW }),
    (error) => {
      assert.ok(error instanceof PlanAccessError);
      assert.deepEqual(error.response, {
        error: 'PLAN_LIMIT_REACHED',
        resource: 'professionals',
        limit: 5,
        current: 5,
        plan: 'essential',
        message: 'Você atingiu o limite de funcionários ativos do seu plano.',
      });
      return true;
    }
  );
  const activeEmployeesQuery = essential.statements.find(({ text }) => text.includes('FROM professionals'));
  assert.ok(activeEmployeesQuery);
  assert.deepEqual(activeEmployeesQuery.values, ['clinic-a']);
  assert.match(activeEmployeesQuery.text, /status = 'active'/);
});

test('Professional has no artificial employee ceiling and all commercial plans have unlimited patients, appointments, and services', async () => {
  for (const plan of ['essential', 'professional']) {
    const client = createClient({ plan, resourceCount: 10000 });
    if (plan === 'professional') {
      const employees = await assertPlanResourceLimit(
        client.client,
        'clinic-a',
        'professionals',
        { now: NOW }
      );
      assert.equal(employees.limit, null);
      assert.equal(client.statements.some(({ text }) => text.includes('count(*)')), false);
    }

    for (const resource of ['patients', 'appointments', 'services']) {
      const access = await assertPlanResourceLimit(client.client, 'clinic-a', resource, { now: NOW });
      assert.equal(access.limit, null);
      assert.equal(
        client.statements.some(({ text }) => text.includes(`FROM ${resource}`)),
        false
      );
    }
  }
});

test('capabilities are enforced using the authenticated clinic plan', async () => {
  const essential = createClient();
  await assert.rejects(
    assertPlanCapability(essential.client, 'clinic-a', 'payments', { now: NOW }),
    (error) => error.response.error === 'PLAN_FEATURE_NOT_AVAILABLE' &&
      error.response.feature === 'payments' &&
      error.response.plan === 'essential'
  );

  const professional = createClient({ plan: 'professional' });
  assert.equal(
    (await assertPlanCapability(professional.client, 'clinic-a', 'audit', { now: NOW })).plan.id,
    'professional'
  );

  const legacy = createClient({ plan: 'complete' });
  assert.equal(
    (await assertPlanCapability(legacy.client, 'clinic-a', 'payments', { now: NOW })).plan.id,
    'complete'
  );
});
