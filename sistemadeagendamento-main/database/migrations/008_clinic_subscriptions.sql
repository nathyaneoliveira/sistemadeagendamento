-- Adds one subscription record per clinic, with a partial unique index for
-- the single current subscription and no automatically created clinic data.
BEGIN;

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  plan VARCHAR(30) NOT NULL DEFAULT 'complete'
    CHECK (plan = 'complete'),
  billing_cycle VARCHAR(20) NOT NULL
    CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly')),
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  started_at TIMESTAMPTZ NOT NULL,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  trial_ends_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  gateway VARCHAR(50),
  gateway_customer_id VARCHAR(255),
  gateway_subscription_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_subscriptions_period_order
    CHECK (started_at <= current_period_start AND current_period_start < current_period_end),
  CONSTRAINT ck_subscriptions_trial_start
    CHECK (trial_ends_at IS NULL OR
      (trial_ends_at >= started_at AND trial_ends_at <= current_period_end)),
  CONSTRAINT ck_subscriptions_trialing_end
    CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL),
  CONSTRAINT ck_subscriptions_cancelled_start
    CHECK (cancelled_at IS NULL OR cancelled_at >= started_at),
  CONSTRAINT ck_subscriptions_cancelled_timestamp
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT ck_subscriptions_gateway_identifiers
    CHECK (
      (gateway IS NULL OR length(btrim(gateway)) > 0)
      AND (
        (gateway_customer_id IS NULL AND gateway_subscription_id IS NULL)
        OR gateway IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX uq_subscriptions_one_current_per_clinic
  ON subscriptions(clinic_id)
  WHERE status IN ('trialing', 'active', 'past_due');

CREATE INDEX idx_subscriptions_clinic_created_at
  ON subscriptions(clinic_id, created_at DESC);

CREATE UNIQUE INDEX uq_subscriptions_gateway_subscription
  ON subscriptions(gateway, gateway_subscription_id)
  WHERE gateway IS NOT NULL AND gateway_subscription_id IS NOT NULL;

CREATE TRIGGER trg_subscriptions_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
