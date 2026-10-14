import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';
import { BILLING_CYCLES, PLAN_CATALOG, getPlanPriceInCents } from '../../../shared/planCatalog.js';

export function createSubscriptionRouter({
  queryExecutor = query,
  authenticate = authenticateToken,
} = {}) {
  const router = Router();

  router.use(authenticate);
  router.use(requireClinicAccess);

  router.get('/current', authorizeRoles('admin'), async (req, res, next) => {
    try {
      const result = await queryExecutor(
        `SELECT plan, billing_cycle, status, started_at, current_period_start,
                current_period_end, trial_ends_at, cancelled_at
         FROM subscriptions
         WHERE clinic_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [req.clinicId]
      );
      const subscription = result.rows[0];

      if (!subscription) {
        return res.status(200).json({ ok: true, data: null });
      }

      return res.status(200).json({
        ok: true,
        data: {
          planName: PLAN_CATALOG[subscription.plan]?.name || subscription.plan,
          plan: subscription.plan,
          billingCycle: subscription.billing_cycle,
          priceInCents: getPlanPriceInCents(subscription.plan, subscription.billing_cycle),
          billingCycleLabel: BILLING_CYCLES[subscription.billing_cycle]?.label || subscription.billing_cycle,
          status: subscription.status,
          limits: PLAN_CATALOG[subscription.plan]?.limits || null,
          capabilities: PLAN_CATALOG[subscription.plan]?.capabilities || {},
          roadmapCapabilities: PLAN_CATALOG[subscription.plan]?.roadmapCapabilities || [],
          startedAt: subscription.started_at,
          currentPeriodStart: subscription.current_period_start,
          currentPeriodEnd: subscription.current_period_end,
          trialEndsAt: subscription.trial_ends_at,
          cancelledAt: subscription.cancelled_at,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createSubscriptionRouter();
