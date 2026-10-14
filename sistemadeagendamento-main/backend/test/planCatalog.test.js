import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BILLING_CYCLES,
  COMMERCIAL_PLAN_IDS,
  getPlanBillingSummary,
  PLAN_CATALOG,
} from '../../shared/planCatalog.js';

test('the public catalog contains only Essential and Professional with the official prices', () => {
  assert.deepEqual(COMMERCIAL_PLAN_IDS, ['essential', 'professional']);
  assert.deepEqual(PLAN_CATALOG.essential.pricesInCents, {
    monthly: 15000,
    quarterly: 40000,
    yearly: 140000,
  });
  assert.deepEqual(PLAN_CATALOG.professional.pricesInCents, {
    monthly: 25000,
    quarterly: 67500,
    yearly: 240000,
  });
});

test('commercial limits match the active-employee rule and leave patients, appointments, and services unlimited', () => {
  assert.equal(PLAN_CATALOG.essential.limits.professionals, 5);
  assert.equal(PLAN_CATALOG.professional.limits.professionals, null);

  for (const planId of COMMERCIAL_PLAN_IDS) {
    for (const resource of ['patients', 'appointments', 'services']) {
      assert.equal(PLAN_CATALOG[planId].limits[resource], null);
    }
  }
});

test('cycle selection produces the correct contract total, monthly equivalent, and savings', () => {
  assert.deepEqual(BILLING_CYCLES, {
    monthly: { label: 'Mensal', period: 'mês', months: 1 },
    quarterly: { label: 'Trimestral', period: 'trimestre', months: 3 },
    yearly: { label: 'Anual', period: 'ano', months: 12 },
  });
  assert.deepEqual(
    ['monthly', 'quarterly', 'yearly'].map((cycle) => getPlanBillingSummary('essential', cycle)),
    [
      { billingCycle: 'monthly', months: 1, priceInCents: 15000, monthlyEquivalentInCents: 15000, savingsInCents: 0 },
      { billingCycle: 'quarterly', months: 3, priceInCents: 40000, monthlyEquivalentInCents: 13333, savingsInCents: 5000 },
      { billingCycle: 'yearly', months: 12, priceInCents: 140000, monthlyEquivalentInCents: 11667, savingsInCents: 40000 },
    ]
  );
  assert.deepEqual(
    ['monthly', 'quarterly', 'yearly'].map((cycle) => getPlanBillingSummary('professional', cycle)),
    [
      { billingCycle: 'monthly', months: 1, priceInCents: 25000, monthlyEquivalentInCents: 25000, savingsInCents: 0 },
      { billingCycle: 'quarterly', months: 3, priceInCents: 67500, monthlyEquivalentInCents: 22500, savingsInCents: 7500 },
      { billingCycle: 'yearly', months: 12, priceInCents: 240000, monthlyEquivalentInCents: 20000, savingsInCents: 60000 },
    ]
  );
  assert.equal(getPlanBillingSummary('unknown', 'monthly'), null);
  assert.equal(getPlanBillingSummary('essential', 'weekly'), null);
});

test('legacy complete and premium plans remain available internally without entering the public offer', () => {
  assert.equal(PLAN_CATALOG.complete.legacy, true);
  assert.equal(PLAN_CATALOG.premium.legacy, true);
  assert.equal(PLAN_CATALOG.complete.compatibility.commercialPlanId, 'professional');
  assert.equal(PLAN_CATALOG.complete.compatibility.preserveExistingTerms, true);
  assert.equal(PLAN_CATALOG.premium.compatibility.commercialPlanId, null);
  assert.equal(PLAN_CATALOG.premium.compatibility.preserveExistingTerms, true);
  assert.deepEqual(PLAN_CATALOG.complete.pricesInCents, {
    monthly: 14999,
    quarterly: 39999,
    yearly: 139999,
  });
  assert.equal(PLAN_CATALOG.complete.limits.professionals, null);
  assert.equal(COMMERCIAL_PLAN_IDS.includes('complete'), false);
  assert.equal(COMMERCIAL_PLAN_IDS.includes('premium'), false);
});
