import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'platform-admin-service-tests-only-secret-32-bytes';
const { createPlatformAdminService } = await import('../src/services/platformAdminService.js');

test('dashboard normalizes active monthly, quarterly and yearly catalog prices without calling them receipts', async () => {
  const queries = [];
  const auditEvents = [];
  const service = createPlatformAdminService({
    queryExecutor: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('WITH latest AS')) {
        return { rows: [{
          total_clinics: 5,
          active_subscriptions: 2,
          new_contracts: 3,
          cancelled_subscriptions: 1,
          delinquent_subscriptions: 1,
          expired_subscriptions: 1,
        }] };
      }
      if (sql.includes('SELECT plan, billing_cycle')) {
        return { rows: [
          { plan: 'essential', billing_cycle: 'quarterly' },
          { plan: 'professional', billing_cycle: 'yearly' },
        ] };
      }
      if (sql.includes('GROUP BY latest.plan')) {
        return { rows: [{ plan: 'essential', clinics: 1 }, { plan: 'professional', clinics: 1 }] };
      }
      if (sql.includes('date_trunc')) {
        return { rows: [{ period: '2026-10-01', contracts: 3 }] };
      }
      if (sql.includes('SELECT *') && sql.includes('events')) return { rows: [] };
      throw new Error('Unexpected dashboard query.');
    },
    auditLogger: async (event) => auditEvents.push(event),
  });

  const dashboard = await service.getDashboard(
    { from: '2026-10-01', to: '2026-10-31' },
    { id: 'synthetic-platform-admin', requestId: 'synthetic-request' }
  );

  assert.equal(dashboard.metrics.mrrEstimateInCents, 33333);
  assert.equal(dashboard.metrics.arrEstimateInCents, 399996);
  assert.equal(dashboard.metrics.activeSubscriptionsWithoutPaymentConfirmation, 2);
  assert.equal(dashboard.metrics.pendingSubscriptions.supported, false);
  assert.equal(dashboard.metrics.confirmedSubscriptionPayments.supported, false);
  assert.equal(dashboard.metrics.pendingSubscriptionCharges.supported, false);
  assert.deepEqual(dashboard.contractsTimeline, [{ period: '2026-10-01', contracts: 3 }]);
  assert.equal(dashboard.period.from, '2026-10-01');
  assert.equal(dashboard.period.to, '2026-10-31');
  assert.equal(auditEvents[0].action, 'platform.dashboard.view');
  assert.equal(auditEvents[0].requestId, 'synthetic-request');
  assert.ok(queries[0].sql.includes('status = \'active\''));
});

test('invalid filters and pagination fail before querying the database', async () => {
  let queryCalls = 0;
  const service = createPlatformAdminService({
    queryExecutor: async () => {
      queryCalls += 1;
      return { rows: [] };
    },
    auditLogger: async () => {},
  });

  await assert.rejects(
    service.listClinics({ status: 'pending' }),
    (error) => error.statusCode === 400
  );
  await assert.rejects(
    service.listSubscriptions({ page: '0' }),
    (error) => error.statusCode === 400
  );
  await assert.rejects(
    service.getDashboard({ from: '2026-02-30', to: '2026-03-01' }),
    (error) => error.statusCode === 400
  );
  assert.equal(queryCalls, 0);
});

test('clinic search stays parameterized and paginated', async () => {
  const calls = [];
  const service = createPlatformAdminService({
    queryExecutor: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ total: 0 }] };
    },
    auditLogger: async () => {},
  });

  const result = await service.listClinics({
    page: '2',
    pageSize: '10',
    search: "x%' OR 1=1 --",
    plan: 'essential',
  });

  assert.equal(result.pagination.page, 2);
  assert.equal(result.pagination.pageSize, 10);
  assert.equal(result.pagination.total, 0);
  assert.ok(calls[0].sql.includes('c.name ILIKE $2'));
  assert.ok(calls[0].params.includes("%x%' OR 1=1 --%"));
  assert.ok(!calls[0].sql.includes("x%' OR 1=1 --"));
});
