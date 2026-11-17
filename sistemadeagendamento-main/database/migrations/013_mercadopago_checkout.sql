-- Checkout audit trail for self-service clinic subscriptions.
BEGIN;
CREATE TABLE checkout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  gateway VARCHAR(30) NOT NULL CHECK (gateway = 'mercadopago'),
  gateway_preference_id VARCHAR(255),
  gateway_payment_id VARCHAR(255),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_checkout_sessions_gateway_payment UNIQUE (gateway, gateway_payment_id)
);
CREATE INDEX idx_checkout_sessions_pending ON checkout_sessions(status, created_at) WHERE status = 'pending';
CREATE TRIGGER trg_checkout_sessions_updated_at BEFORE UPDATE ON checkout_sessions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
COMMIT;
