-- Adds tenant-scoped services and professional assignments.
-- Existing appointments remain valid with service_id and snapshots set to NULL.
BEGIN;

LOCK TABLE professionals, appointments IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL CHECK (length(btrim(name)) > 0),
  description TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, name),
  CONSTRAINT uq_services_clinic_id_id UNIQUE (clinic_id, id)
);

CREATE INDEX idx_services_clinic_active_name ON services(clinic_id, is_active, name);

CREATE TABLE professional_services (
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL,
  service_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clinic_id, professional_id, service_id),
  CONSTRAINT fk_professional_services_clinic_professional
    FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_professional_services_clinic_service
    FOREIGN KEY (clinic_id, service_id) REFERENCES services(clinic_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_professional_services_clinic_service
  ON professional_services(clinic_id, service_id, professional_id);

ALTER TABLE appointments
  ADD COLUMN service_id UUID,
  ADD COLUMN service_name_snapshot VARCHAR(200),
  ADD COLUMN service_price_snapshot NUMERIC(10,2),
  ADD COLUMN service_duration_snapshot INTEGER,
  ADD CONSTRAINT fk_appointments_clinic_service
    FOREIGN KEY (clinic_id, service_id) REFERENCES services(clinic_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_appointments_service_snapshot
    CHECK (
      (service_id IS NULL AND service_name_snapshot IS NULL AND service_price_snapshot IS NULL AND service_duration_snapshot IS NULL)
      OR
      (service_id IS NOT NULL AND service_name_snapshot IS NOT NULL
        AND length(btrim(service_name_snapshot)) > 0 AND service_price_snapshot IS NOT NULL
        AND service_price_snapshot >= 0 AND service_duration_snapshot IS NOT NULL
        AND service_duration_snapshot BETWEEN 1 AND 1440)
    );

CREATE INDEX idx_appointments_clinic_service_id ON appointments(clinic_id, service_id);

CREATE TRIGGER trg_services_updated_at
BEFORE UPDATE ON services
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;

-- Rollback is intentionally not automatic: after services have been assigned or
-- referenced by appointments, dropping these tables/columns would destroy
-- commercial history. If rollback is approved before any such use, first verify
-- that professional_services and appointments contain no service assignments,
-- then drop the trigger, appointment constraint/index/columns, mapping table,
-- service index and services table in a reviewed maintenance migration.
