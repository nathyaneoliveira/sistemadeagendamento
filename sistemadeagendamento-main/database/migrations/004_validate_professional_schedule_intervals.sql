-- Prevent invalid weekly work intervals without changing existing rows.
-- The preflight aborts if any current schedule has an empty or reversed interval.
BEGIN;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM professional_schedules
    WHERE end_time <= start_time
  ) THEN
    RAISE EXCEPTION 'Invalid professional schedule intervals exist; resolve them before applying this migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'professional_schedules'::regclass
      AND conname = 'ck_professional_schedules_valid_interval'
  ) THEN
    ALTER TABLE professional_schedules
      ADD CONSTRAINT ck_professional_schedules_valid_interval
      CHECK (end_time > start_time) NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE professional_schedules
  VALIDATE CONSTRAINT ck_professional_schedules_valid_interval;

COMMIT;

-- Reversal, if required: ALTER TABLE professional_schedules
-- DROP CONSTRAINT ck_professional_schedules_valid_interval;
