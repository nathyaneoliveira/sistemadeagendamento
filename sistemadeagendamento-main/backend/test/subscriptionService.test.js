import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'subscription-tests-only-secret-at-least-32-bytes';
const {
  canTransitionSubscription,
  createSubscriptionService,
  SUBSCRIPTION_PRICES_IN_CENTS,
  SUBSCRIPTION_PRICES_BY_PLAN_IN_CENTS,
  SubscriptionConflictError,
  SubscriptionNotFoundError,
  SubscriptionValidationError,
  validateSubscriptionTransition,
} = await import('../src/services/subscriptionService.js');

const PERIOD = {
  clinicId: 'clinic-a',
  billingCycle: 'monthly',
  status: 'active',
  startedAt: '2026-01-01T00:00:00.000Z',
  currentPeriodStart: '2026-01-01T00:00:00.000Z',
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
};

function createService({ queryHandler } = {}) {
  const auditEvents = [];
  const statements = [];
  const service = createSubscriptionService({
    transactionExecutor: (callback) => callback({
      query: async (text, values) => {
        statements.push({ text: text.replace(/\s+/g, ' ').trim(), values });
        return queryHandler
          ? queryHandler(text, values)
          : { rows: [], rowCount: 0 };
      },
    }),
    auditLogger: async (event) => auditEvents.push(event),
  });
  return { service, auditEvents, statements };
}

test('commercial pricing is centralized in integer cents', () => {
  assert.deepEqual(SUBSCRIPTION_PRICES_IN_CENTS, {
    monthly: 14999,
    quarterly: 39999,
    yearly: 139999,
  });
  assert.deepEqual(SUBSCRIPTION_PRICES_BY_PLAN_IN_CENTS, {
    essential: { monthly: 15000, quarterly: 40000, yearly: 140000 },
    professional: { monthly: 25000, quarterly: 67500, yearly: 240000 },
    premium: { monthly: 40000, quarterly: 108000, yearly: 384000 },
    complete: { monthly: 14999, quarterly: 39999, yearly: 139999 },
  });
});

test('creates a valid subscription using server-defined cycle pricing in its audit event', async () => {
  const row = {
    id: 'subscription-1',
    clinic_id: PERIOD.clinicId,
    plan: 'complete',
    billing_cycle: 'quarterly',
    status: 'active',
  };
  const { service, auditEvents, statements } = createService({
    queryHandler: async () => ({ rows: [row], rowCount: 1 }),
  });

  const created = await service.createSubscription({
    ...PERIOD,
    billingCycle: 'quarterly',
    userId: 'admin-a',
  });

  assert.equal(created.id, row.id);
  assert.equal(statements.length, 1);
  assert.match(statements[0].text, /^INSERT INTO subscriptions/);
  assert.deepEqual(statements[0].values.slice(0, 4), ['clinic-a', 'complete', 'quarterly', 'active']);
  assert.equal(auditEvents[0].action, 'subscription.created');
  assert.deepEqual(auditEvents[0].details, {
    plan: 'complete',
    billingCycle: 'quarterly',
    priceInCents: 39999,
    status: 'active',
  });
});

test('accepts all official plan and billing-cycle combinations and rejects unknown inputs', async () => {
  const { service, statements } = createService();

  await assert.rejects(
    service.createSubscription({ ...PERIOD, plan: 'unlisted' }),
    SubscriptionValidationError
  );
  await assert.rejects(
    service.createSubscription({ ...PERIOD, billingCycle: 'weekly' }),
    SubscriptionValidationError
  );
  for (const [plan, prices] of Object.entries(SUBSCRIPTION_PRICES_BY_PLAN_IN_CENTS)) {
    for (const [cycle, priceInCents] of Object.entries(prices)) {
      const validService = createService({
        queryHandler: async () => ({
          rows: [{
            id: 'subscription-1',
            clinic_id: 'clinic-a',
            plan,
            billing_cycle: cycle,
            status: 'active',
          }],
          rowCount: 1,
        }),
      });
      await validService.service.createSubscription({
        ...PERIOD,
        plan,
        billingCycle: cycle,
        priceInCents: 1,
      });
      assert.equal(validService.auditEvents[0].details.priceInCents, priceInCents);
    }
  }
  assert.equal(statements.length, 0);
});

test('rejects unsupported initial statuses and invalid period dates', async () => {
  const { service, statements } = createService();

  await assert.rejects(
    service.createSubscription({ ...PERIOD, status: 'past_due' }),
    SubscriptionValidationError
  );
  await assert.rejects(
    service.createSubscription({
      ...PERIOD,
      currentPeriodStart: '2026-02-01T00:00:00.000Z',
      currentPeriodEnd: '2026-01-01T00:00:00.000Z',
    }),
    SubscriptionValidationError
  );
  assert.equal(statements.length, 0);
});

test('trial subscriptions require a valid explicit trial end and are never activated implicitly', async () => {
  const { service, auditEvents } = createService({
    queryHandler: async () => ({
      rows: [{
        id: 'subscription-trial',
        clinic_id: 'clinic-a',
        plan: 'complete',
        billing_cycle: 'monthly',
        status: 'trialing',
        trial_ends_at: '2026-01-15T00:00:00.000Z',
      }],
      rowCount: 1,
    }),
  });

  await assert.rejects(
    service.createSubscription({ ...PERIOD, status: 'trialing' }),
    SubscriptionValidationError
  );
  await assert.rejects(
    service.createSubscription({
      ...PERIOD,
      status: 'trialing',
      trialEndsAt: '2025-12-31T00:00:00.000Z',
    }),
    SubscriptionValidationError
  );
  await assert.rejects(
    service.createSubscription({
      ...PERIOD,
      status: 'trialing',
      trialEndsAt: '2026-03-01T00:00:00.000Z',
    }),
    SubscriptionValidationError
  );

  await service.createSubscription({
    ...PERIOD,
    status: 'trialing',
    trialEndsAt: '2026-01-15T00:00:00.000Z',
  });
  assert.deepEqual(auditEvents.map(({ action }) => action), [
    'subscription.created',
    'subscription.trial_started',
  ]);
});

test('maps missing clinic and duplicate current subscription constraints to domain errors', async () => {
  const missingClinicService = createService({
    queryHandler: async () => {
      const error = new Error('foreign key');
      error.code = '23503';
      error.constraint = 'subscriptions_clinic_id_fkey';
      throw error;
    },
  }).service;
  const duplicateService = createService({
    queryHandler: async () => {
      const error = new Error('unique');
      error.code = '23505';
      error.constraint = 'uq_subscriptions_one_current_per_clinic';
      throw error;
    },
  }).service;

  await assert.rejects(
    missingClinicService.createSubscription(PERIOD),
    SubscriptionNotFoundError
  );
  await assert.rejects(
    duplicateService.createSubscription(PERIOD),
    SubscriptionConflictError
  );
});

test('enforces the documented subscription state machine', () => {
  assert.equal(canTransitionSubscription('trialing', 'active'), true);
  assert.equal(canTransitionSubscription('active', 'past_due'), true);
  assert.equal(canTransitionSubscription('past_due', 'active'), true);
  assert.equal(canTransitionSubscription('cancelled', 'expired'), true);
  assert.equal(canTransitionSubscription('expired', 'active'), false);
  assert.equal(canTransitionSubscription('active', 'trialing'), false);
  assert.throws(
    () => validateSubscriptionTransition('cancelled', 'active'),
    SubscriptionValidationError
  );
});

test('transition reads and updates the subscription using both clinic and subscription ids', async () => {
  const row = {
    id: 'subscription-1',
    clinic_id: 'clinic-a',
    plan: 'complete',
    billing_cycle: 'monthly',
    status: 'cancelled',
  };
  const { service, auditEvents, statements } = createService({
    queryHandler: async (text) => {
      if (text.includes('SELECT id, clinic_id, status')) {
        return { rows: [{ id: 'subscription-1', clinic_id: 'clinic-a', status: 'active' }], rowCount: 1 };
      }
      return { rows: [row], rowCount: 1 };
    },
  });

  await service.transitionSubscription({
    clinicId: 'clinic-a',
    subscriptionId: 'subscription-1',
    userId: 'admin-a',
    status: 'cancelled',
  });

  assert.match(statements[0].text, /WHERE id = \$1 AND clinic_id = \$2 FOR UPDATE$/);
  assert.deepEqual(statements[0].values, ['subscription-1', 'clinic-a']);
  assert.match(statements[1].text, /WHERE id = \$1 AND clinic_id = \$2/);
  assert.deepEqual(auditEvents.map(({ action }) => action), ['subscription.cancelled']);
});

test('subscription from another clinic is not found and cannot be transitioned', async () => {
  const { service, statements, auditEvents } = createService({
    queryHandler: async () => ({ rows: [], rowCount: 0 }),
  });

  await assert.rejects(
    service.transitionSubscription({
      clinicId: 'clinic-a',
      subscriptionId: 'subscription-from-b',
      status: 'cancelled',
    }),
    SubscriptionNotFoundError
  );
  assert.equal(statements.length, 1);
  assert.deepEqual(statements[0].values, ['subscription-from-b', 'clinic-a']);
  assert.equal(auditEvents.length, 0);
});
