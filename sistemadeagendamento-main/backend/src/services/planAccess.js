import { query } from '../db/index.js';
import {
  PLAN_CATALOG,
  PLAN_LIMIT_RESOURCES,
} from '../../../shared/planCatalog.js';

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export class PlanAccessError extends Error {
  constructor(response) {
    super(response.message);
    this.name = 'PlanAccessError';
    this.statusCode = 403;
    this.response = response;
  }
}

export async function loadClinicPlan(client, clinicId, { now = new Date(), lock = false } = {}) {
  const result = await client.query(
    `SELECT plan, billing_cycle, status, current_period_start, current_period_end, trial_ends_at
     FROM subscriptions
     WHERE clinic_id = $1
     ORDER BY created_at DESC
     LIMIT 1${lock ? ' FOR SHARE' : ''}`,
    [clinicId]
  );
  const subscription = result.rows[0];

  if (!subscription) {
    throw new PlanAccessError({
      error: 'PLAN_SUBSCRIPTION_REQUIRED',
      message: 'Esta clínica não possui uma assinatura válida.',
    });
  }

  const plan = PLAN_CATALOG[subscription.plan];
  if (!plan) {
    throw new PlanAccessError({
      error: 'PLAN_SUBSCRIPTION_INVALID',
      message: 'O plano da assinatura não é reconhecido.',
    });
  }

  const instant = new Date(now).getTime();
  const periodStart = new Date(subscription.current_period_start).getTime();
  const periodEnd = new Date(subscription.current_period_end).getTime();
  const trialEnd = subscription.trial_ends_at === null
    ? null
    : new Date(subscription.trial_ends_at).getTime();
  const inPeriod = Number.isFinite(periodStart) && Number.isFinite(periodEnd) &&
    periodStart <= instant && instant < periodEnd;
  const trialValid = subscription.status !== 'trialing' ||
    (Number.isFinite(trialEnd) && instant < trialEnd);

  if (!ACTIVE_STATUSES.has(subscription.status) || !inPeriod || !trialValid) {
    throw new PlanAccessError({
      error: 'PLAN_SUBSCRIPTION_INACTIVE',
      plan: subscription.plan,
      status: subscription.status,
      message: 'A assinatura desta clínica não está ativa para uso dos recursos.',
    });
  }

  return { subscription, plan };
}

export async function assertPlanResourceLimit(client, clinicId, resource, { now } = {}) {
  const resourceDefinition = PLAN_LIMIT_RESOURCES[resource];
  if (!resourceDefinition) {
    throw new TypeError(`Unknown plan limit resource: ${resource}`);
  }

  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`plan-limits:${clinicId}`]
  );
  const { subscription, plan } = await loadClinicPlan(client, clinicId, { now, lock: true });
  const limit = plan.limits[resource];

  if (limit === null) return { plan, subscription, current: null, limit: null };

  const result = await client.query(
    `SELECT count(*)::int AS current
     FROM ${resourceDefinition.table}
     WHERE clinic_id = $1${resourceDefinition.where || ''}`,
    [clinicId]
  );
  const current = result.rows[0].current;

  if (current >= limit) {
    throw new PlanAccessError({
      error: 'PLAN_LIMIT_REACHED',
      resource,
      limit,
      current,
      plan: subscription.plan,
      message: `Você atingiu o limite de ${resourceDefinition.label} do seu plano.`,
    });
  }

  return { plan, subscription, current, limit };
}

export async function assertPlanCapability(client, clinicId, capability, { now } = {}) {
  const { subscription, plan } = await loadClinicPlan(client, clinicId, { now, lock: true });
  if (plan.capabilities[capability] === true) return { plan, subscription };

  throw new PlanAccessError({
    error: 'PLAN_FEATURE_NOT_AVAILABLE',
    feature: capability,
    plan: subscription.plan,
    message: 'Este recurso está disponível a partir do plano Profissional.',
  });
}

export function requirePlanCapability(capability, { queryExecutor = query } = {}) {
  return async (req, res, next) => {
    try {
      const client = {
        query: queryExecutor,
      };
      const access = await assertPlanCapability(client, req.clinicId || req.user.clinicId, capability);
      req.planAccess = access;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requireActivePlanSubscription({ queryExecutor = query } = {}) {
  return async (req, res, next) => {
    try {
      const access = await loadClinicPlan(
        { query: queryExecutor },
        req.clinicId || req.user.clinicId
      );
      req.planAccess = access;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
