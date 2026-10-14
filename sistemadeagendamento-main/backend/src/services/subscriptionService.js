import { withTransaction } from '../db/index.js';
import { logAudit } from './auditService.js';
import {
  PLAN_CATALOG,
  PLAN_IDS,
  getPlanPriceInCents,
} from '../../../shared/planCatalog.js';

export const SUBSCRIPTION_PRICES_IN_CENTS = PLAN_CATALOG.complete.pricesInCents;
export const SUBSCRIPTION_PRICES_BY_PLAN_IN_CENTS = Object.freeze(
  Object.fromEntries(PLAN_IDS.map((plan) => [plan, PLAN_CATALOG[plan].pricesInCents]))
);

export const SUBSCRIPTION_STATUSES = Object.freeze([
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired',
]);

const INITIAL_STATUSES = new Set(['trialing', 'active']);
const ALLOWED_TRANSITIONS = Object.freeze({
  trialing: new Set(['active', 'cancelled', 'expired']),
  active: new Set(['past_due', 'cancelled', 'expired']),
  past_due: new Set(['active', 'cancelled', 'expired']),
  cancelled: new Set(['expired']),
  expired: new Set(),
});

const SUBSCRIPTION_COLUMNS = `
  id, clinic_id, plan, billing_cycle, status, started_at,
  current_period_start, current_period_end, trial_ends_at, cancelled_at,
  created_at, updated_at
`;

export class SubscriptionValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SubscriptionValidationError';
  }
}

export class SubscriptionConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SubscriptionConflictError';
  }
}

export class SubscriptionNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SubscriptionNotFoundError';
  }
}

function isValidTimestamp(value) {
  return (typeof value === 'string' || value instanceof Date) &&
    Number.isFinite(new Date(value).getTime());
}

function validateCreateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SubscriptionValidationError('Dados de assinatura inválidos.');
  }

  const {
    clinicId,
    plan = 'complete',
    billingCycle,
    status,
    startedAt,
    currentPeriodStart,
    currentPeriodEnd,
    trialEndsAt = null,
  } = input;

  if (typeof clinicId !== 'string' || !clinicId) {
    throw new SubscriptionValidationError('Clínica não informada.');
  }
  if (!PLAN_IDS.includes(plan)) {
    throw new SubscriptionValidationError('Plano inválido.');
  }
  if (getPlanPriceInCents(plan, billingCycle) === null) {
    throw new SubscriptionValidationError('Periodicidade inválida.');
  }
  if (!INITIAL_STATUSES.has(status)) {
    throw new SubscriptionValidationError('Status inicial inválido.');
  }
  if (
    !isValidTimestamp(startedAt) ||
    !isValidTimestamp(currentPeriodStart) ||
    !isValidTimestamp(currentPeriodEnd) ||
    new Date(startedAt) > new Date(currentPeriodStart) ||
    new Date(currentPeriodStart) >= new Date(currentPeriodEnd)
  ) {
    throw new SubscriptionValidationError('Período da assinatura inválido.');
  }
  if (
    trialEndsAt !== null &&
    (
      !isValidTimestamp(trialEndsAt) ||
      new Date(trialEndsAt) < new Date(startedAt) ||
      new Date(trialEndsAt) > new Date(currentPeriodEnd)
    )
  ) {
    throw new SubscriptionValidationError('Data final do período de teste incompatível com o período da assinatura.');
  }
  if (status === 'trialing' && trialEndsAt === null) {
    throw new SubscriptionValidationError('Uma assinatura em teste exige trialEndsAt.');
  }
  if (status === 'active' && trialEndsAt !== null) {
    throw new SubscriptionValidationError('Uma assinatura ativa não pode iniciar com trialEndsAt.');
  }

  return {
    clinicId,
    userId: input.userId || null,
    plan,
    billingCycle,
    status,
    startedAt,
    currentPeriodStart,
    currentPeriodEnd,
    trialEndsAt,
  };
}

export function canTransitionSubscription(fromStatus, toStatus) {
  return ALLOWED_TRANSITIONS[fromStatus]?.has(toStatus) || false;
}

export function validateSubscriptionTransition(fromStatus, toStatus) {
  if (!SUBSCRIPTION_STATUSES.includes(fromStatus) || !SUBSCRIPTION_STATUSES.includes(toStatus)) {
    throw new SubscriptionValidationError('Status de assinatura inválido.');
  }
  if (!canTransitionSubscription(fromStatus, toStatus)) {
    throw new SubscriptionValidationError(`Transição de assinatura inválida: ${fromStatus} → ${toStatus}.`);
  }
}

export function createSubscriptionService({
  transactionExecutor = withTransaction,
  auditLogger = logAudit,
} = {}) {
  async function createSubscription(input) {
    const draft = validateCreateInput(input);

    try {
      return await transactionExecutor(async (client) => {
        const result = await client.query(
          `INSERT INTO subscriptions
             (clinic_id, plan, billing_cycle, status, started_at, current_period_start,
              current_period_end, trial_ends_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING ${SUBSCRIPTION_COLUMNS}`,
          [
            draft.clinicId,
            draft.plan,
            draft.billingCycle,
            draft.status,
            draft.startedAt,
            draft.currentPeriodStart,
            draft.currentPeriodEnd,
            draft.trialEndsAt,
          ]
        );
        const subscription = result.rows[0];

        await auditLogger({
          clinicId: draft.clinicId,
          userId: draft.userId,
          entityType: 'subscriptions',
          entityId: subscription.id,
          action: 'subscription.created',
          details: {
            plan: subscription.plan,
            billingCycle: subscription.billing_cycle,
            priceInCents: getPlanPriceInCents(subscription.plan, subscription.billing_cycle),
            status: subscription.status,
          },
        }, client);

        if (draft.status === 'trialing') {
          await auditLogger({
            clinicId: draft.clinicId,
            userId: draft.userId,
            entityType: 'subscriptions',
            entityId: subscription.id,
            action: 'subscription.trial_started',
            details: { trialEndsAt: subscription.trial_ends_at },
          }, client);
        }

        return subscription;
      });
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'uq_subscriptions_one_current_per_clinic') {
        throw new SubscriptionConflictError('A clínica já possui uma assinatura atual.');
      }
      if (error.code === '23503' && error.constraint === 'subscriptions_clinic_id_fkey') {
        throw new SubscriptionNotFoundError('Clínica não encontrada.');
      }
      throw error;
    }
  }

  async function transitionSubscription({
    clinicId,
    subscriptionId,
    userId = null,
    status: nextStatus,
  }) {
    if (typeof clinicId !== 'string' || !clinicId || typeof subscriptionId !== 'string' || !subscriptionId) {
      throw new SubscriptionValidationError('Clínica e assinatura são obrigatórias.');
    }

    return transactionExecutor(async (client) => {
      const currentResult = await client.query(
        `SELECT id, clinic_id, status
         FROM subscriptions
         WHERE id = $1 AND clinic_id = $2
         FOR UPDATE`,
        [subscriptionId, clinicId]
      );
      if (currentResult.rowCount === 0) {
        throw new SubscriptionNotFoundError('Assinatura não encontrada.');
      }

      const current = currentResult.rows[0];
      validateSubscriptionTransition(current.status, nextStatus);
      const result = await client.query(
        `UPDATE subscriptions
         SET status = $3::varchar,
             cancelled_at = CASE WHEN $3::varchar = 'cancelled' THEN NOW() ELSE cancelled_at END
         WHERE id = $1 AND clinic_id = $2
         RETURNING ${SUBSCRIPTION_COLUMNS}`,
        [subscriptionId, clinicId, nextStatus]
      );
      const updated = result.rows[0];

      await auditLogger({
        clinicId,
        userId,
        entityType: 'subscriptions',
        entityId: subscriptionId,
        action: nextStatus === 'cancelled' ? 'subscription.cancelled' : 'subscription.updated',
        details: { previousStatus: current.status, status: updated.status },
      }, client);

      if (
        current.status === 'trialing' &&
        ['active', 'expired', 'cancelled'].includes(nextStatus)
      ) {
        await auditLogger({
          clinicId,
          userId,
          entityType: 'subscriptions',
          entityId: subscriptionId,
          action: 'subscription.trial_ended',
          details: { status: updated.status },
        }, client);
      }

      return updated;
    });
  }

  return { createSubscription, transitionSubscription };
}
