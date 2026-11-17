BEGIN;

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS suspension_reason VARCHAR(30);

UPDATE clinics
SET suspension_reason = 'administrative'
WHERE status = 'suspended' AND suspension_reason IS NULL;

ALTER TABLE clinics
  ADD CONSTRAINT ck_clinics_suspension_reason
  CHECK (suspension_reason IS NULL OR suspension_reason IN ('onboarding', 'billing', 'administrative'));

CREATE OR REPLACE FUNCTION maintain_clinic_suspension_reason()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status <> 'suspended' THEN
    NEW.suspension_reason := NULL;
  ELSIF TG_OP = 'INSERT' AND NEW.suspension_reason IS NULL THEN
    NEW.suspension_reason := 'administrative';
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> 'suspended'
        AND NEW.suspension_reason IS NOT DISTINCT FROM OLD.suspension_reason THEN
    NEW.suspension_reason := 'administrative';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_maintain_clinic_suspension_reason
BEFORE INSERT OR UPDATE OF status, suspension_reason ON clinics
FOR EACH ROW EXECUTE FUNCTION maintain_clinic_suspension_reason();

ALTER TABLE checkout_sessions
  DROP CONSTRAINT IF EXISTS checkout_sessions_status_check;
ALTER TABLE checkout_sessions
  ADD CONSTRAINT checkout_sessions_status_check
  CHECK (status IN ('pending', 'paid', 'paid_late', 'failed', 'expired'));

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS gateway_payment_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_gateway_payment
  ON payments(provider, gateway_payment_id)
  WHERE provider = 'mercadopago' AND gateway_payment_id IS NOT NULL;

COMMIT;
