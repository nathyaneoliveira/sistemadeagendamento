import catalog from './planCatalog.json' with { type: 'json' };

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export const BILLING_CYCLES = freeze(catalog.billingCycles);
export const PLAN_CAPABILITIES = freeze(catalog.capabilities);
export const COMMERCIAL_PLAN_IDS = freeze(catalog.commercialPlanIds);
export const PLAN_LIMIT_RESOURCES = freeze(catalog.planLimitResources);
export const PLAN_CATALOG = freeze(catalog.plans);
export const PLAN_IDS = freeze(Object.keys(PLAN_CATALOG));

export function getPlanPriceInCents(plan, billingCycle) {
  return PLAN_CATALOG[plan]?.pricesInCents[billingCycle] ?? null;
}

export function getPlanBillingSummary(planId, billingCycle) {
  const plan = PLAN_CATALOG[planId];
  const cycle = BILLING_CYCLES[billingCycle];
  const priceInCents = getPlanPriceInCents(planId, billingCycle);

  if (!plan || !cycle || priceInCents === null) return null;

  return {
    billingCycle,
    months: cycle.months,
    priceInCents,
    monthlyEquivalentInCents: Math.round(priceInCents / cycle.months),
    savingsInCents: plan.pricesInCents.monthly * cycle.months - priceInCents,
  };
}
