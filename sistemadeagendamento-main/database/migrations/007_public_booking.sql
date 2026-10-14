-- Adds explicit public clinic identifiers and scoped idempotency for public bookings.
-- This migration is additive and must be reviewed and run separately.
BEGIN;

ALTER TABLE clinic_configurations
  ADD COLUMN public_slug VARCHAR(63),
  ADD CONSTRAINT ck_clinic_configurations_public_slug
    CHECK (public_slug IS NULL OR public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

CREATE UNIQUE INDEX uq_clinic_configurations_public_slug
  ON clinic_configurations(public_slug)
  WHERE public_slug IS NOT NULL;

ALTER TABLE appointments
  ADD COLUMN public_idempotency_key UUID;

CREATE UNIQUE INDEX uq_appointments_clinic_id_idempotency_key
  ON appointments(clinic_id, public_idempotency_key)
  WHERE public_idempotency_key IS NOT NULL;

COMMIT;
