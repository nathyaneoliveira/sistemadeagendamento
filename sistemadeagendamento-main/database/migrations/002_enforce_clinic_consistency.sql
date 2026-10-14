-- Adds tenant-aware foreign keys without changing or repairing existing rows.
-- The preflight aborts the transaction if any existing cross-clinic reference is found.
BEGIN;

LOCK TABLE users, specialties, professionals, patients, professional_schedules,
  schedule_blocks, appointments, payments, audit_logs
  IN SHARE ROW EXCLUSIVE MODE;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM professionals c
    LEFT JOIN users p ON p.id = c.user_id AND p.clinic_id = c.clinic_id
    WHERE c.user_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-clinic or missing user reference found in professionals.user_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM professionals c
    LEFT JOIN specialties p ON p.id = c.specialty_id AND p.clinic_id = c.clinic_id
    WHERE c.specialty_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-clinic or missing specialty reference found in professionals.specialty_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM patients c
    LEFT JOIN users p ON p.id = c.user_id AND p.clinic_id = c.clinic_id
    WHERE c.user_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-clinic or missing user reference found in patients.user_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM professional_schedules c
    LEFT JOIN professionals p ON p.id = c.professional_id AND p.clinic_id = c.clinic_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-clinic or missing professional reference found in professional_schedules';
  END IF;

  IF EXISTS (
    SELECT 1 FROM schedule_blocks c
    LEFT JOIN professionals p ON p.id = c.professional_id AND p.clinic_id = c.clinic_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-clinic or missing professional reference found in schedule_blocks';
  END IF;

  IF EXISTS (
    SELECT 1 FROM appointments c
    LEFT JOIN patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-clinic or missing patient reference found in appointments.patient_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM appointments c
    LEFT JOIN professionals p ON p.id = c.professional_id AND p.clinic_id = c.clinic_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-clinic or missing professional reference found in appointments.professional_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM appointments c
    LEFT JOIN specialties p ON p.id = c.specialty_id AND p.clinic_id = c.clinic_id
    WHERE c.specialty_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-clinic or missing specialty reference found in appointments.specialty_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM appointments c
    JOIN professionals p ON p.id = c.professional_id AND p.clinic_id = c.clinic_id
    WHERE c.specialty_id IS NOT NULL AND c.specialty_id IS DISTINCT FROM p.specialty_id
  ) THEN
    RAISE EXCEPTION 'Appointment specialty does not match its professional';
  END IF;

  IF EXISTS (
    SELECT 1 FROM payments c
    LEFT JOIN appointments p ON p.id = c.appointment_id AND p.clinic_id = c.clinic_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-clinic or missing appointment reference found in payments';
  END IF;

  IF EXISTS (
    SELECT 1 FROM audit_logs c
    LEFT JOIN users p ON p.id = c.user_id AND p.clinic_id = c.clinic_id
    WHERE c.user_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-clinic or missing user reference found in audit_logs.user_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM audit_logs c
    LEFT JOIN appointments p ON p.id = c.entity_id AND p.clinic_id = c.clinic_id
    WHERE c.entity_type = 'appointments' AND c.entity_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-clinic or missing appointment reference found in audit_logs.entity_id';
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_clinic_id_id
  ON users (clinic_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_specialties_clinic_id_id
  ON specialties (clinic_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_professionals_clinic_id_id
  ON professionals (clinic_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_professionals_clinic_id_specialty_id
  ON professionals (clinic_id, id, specialty_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_clinic_id_id
  ON patients (clinic_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_clinic_id_id
  ON appointments (clinic_id, id);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'professionals'::regclass AND conname = 'fk_professionals_clinic_user') THEN
    ALTER TABLE professionals ADD CONSTRAINT fk_professionals_clinic_user
      FOREIGN KEY (clinic_id, user_id) REFERENCES users(clinic_id, id)
      ON DELETE SET NULL (user_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'professionals'::regclass AND conname = 'fk_professionals_clinic_specialty') THEN
    ALTER TABLE professionals ADD CONSTRAINT fk_professionals_clinic_specialty
      FOREIGN KEY (clinic_id, specialty_id) REFERENCES specialties(clinic_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'patients'::regclass AND conname = 'fk_patients_clinic_user') THEN
    ALTER TABLE patients ADD CONSTRAINT fk_patients_clinic_user
      FOREIGN KEY (clinic_id, user_id) REFERENCES users(clinic_id, id)
      ON DELETE SET NULL (user_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'professional_schedules'::regclass AND conname = 'fk_professional_schedules_clinic_professional') THEN
    ALTER TABLE professional_schedules ADD CONSTRAINT fk_professional_schedules_clinic_professional
      FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'schedule_blocks'::regclass AND conname = 'fk_schedule_blocks_clinic_professional') THEN
    ALTER TABLE schedule_blocks ADD CONSTRAINT fk_schedule_blocks_clinic_professional
      FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'appointments'::regclass AND conname = 'fk_appointments_clinic_patient') THEN
    ALTER TABLE appointments ADD CONSTRAINT fk_appointments_clinic_patient
      FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'appointments'::regclass AND conname = 'fk_appointments_clinic_professional') THEN
    ALTER TABLE appointments ADD CONSTRAINT fk_appointments_clinic_professional
      FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'appointments'::regclass AND conname = 'fk_appointments_clinic_specialty') THEN
    ALTER TABLE appointments ADD CONSTRAINT fk_appointments_clinic_specialty
      FOREIGN KEY (clinic_id, specialty_id) REFERENCES specialties(clinic_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'appointments'::regclass AND conname = 'fk_appointments_clinic_professional_specialty') THEN
    ALTER TABLE appointments ADD CONSTRAINT fk_appointments_clinic_professional_specialty
      FOREIGN KEY (clinic_id, professional_id, specialty_id)
      REFERENCES professionals(clinic_id, id, specialty_id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'payments'::regclass AND conname = 'fk_payments_clinic_appointment') THEN
    ALTER TABLE payments ADD CONSTRAINT fk_payments_clinic_appointment
      FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments(clinic_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'audit_logs'::regclass AND conname = 'fk_audit_logs_clinic_user') THEN
    ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_clinic_user
      FOREIGN KEY (clinic_id, user_id) REFERENCES users(clinic_id, id)
      ON DELETE SET NULL (user_id) NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE professionals VALIDATE CONSTRAINT fk_professionals_clinic_user;
ALTER TABLE professionals VALIDATE CONSTRAINT fk_professionals_clinic_specialty;
ALTER TABLE patients VALIDATE CONSTRAINT fk_patients_clinic_user;
ALTER TABLE professional_schedules VALIDATE CONSTRAINT fk_professional_schedules_clinic_professional;
ALTER TABLE schedule_blocks VALIDATE CONSTRAINT fk_schedule_blocks_clinic_professional;
ALTER TABLE appointments VALIDATE CONSTRAINT fk_appointments_clinic_patient;
ALTER TABLE appointments VALIDATE CONSTRAINT fk_appointments_clinic_professional;
ALTER TABLE appointments VALIDATE CONSTRAINT fk_appointments_clinic_specialty;
ALTER TABLE appointments VALIDATE CONSTRAINT fk_appointments_clinic_professional_specialty;
ALTER TABLE payments VALIDATE CONSTRAINT fk_payments_clinic_appointment;
ALTER TABLE audit_logs VALIDATE CONSTRAINT fk_audit_logs_clinic_user;

CREATE OR REPLACE FUNCTION enforce_audit_entity_clinic()
RETURNS TRIGGER AS $function$
BEGIN
  IF NEW.entity_type = 'appointments'
     AND NEW.entity_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM appointments a
       WHERE a.id = NEW.entity_id AND a.clinic_id = NEW.clinic_id
     ) THEN
    RAISE EXCEPTION 'Audit appointment entity must belong to the same clinic'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'audit_logs'::regclass
      AND tgname = 'trg_audit_logs_entity_clinic'
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_audit_logs_entity_clinic
      BEFORE INSERT OR UPDATE OF clinic_id, entity_type, entity_id ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION enforce_audit_entity_clinic()';
  END IF;
END
$migration$;

COMMIT;

-- Reversal, if ever needed: drop the eleven fk_*_clinic_* constraints, the six
-- uq_*_clinic* indexes, trg_audit_logs_entity_clinic, and
-- enforce_audit_entity_clinic(). The original single-column foreign keys remain.
