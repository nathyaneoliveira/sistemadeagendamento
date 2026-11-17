BEGIN;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
UPDATE payments SET paid_at = updated_at WHERE status = 'paid' AND paid_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_clinic_paid_at ON payments(clinic_id, paid_at) WHERE status = 'paid';
COMMIT;
