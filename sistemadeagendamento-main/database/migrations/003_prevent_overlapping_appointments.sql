-- Replaces the exact-start unique index with tenant-scoped interval exclusion.
-- This rejects overlap among all non-cancelled appointments and permits reuse
-- of a cancelled appointment's slot. Existing overlaps abort without data changes.
BEGIN;

LOCK TABLE appointments IN SHARE ROW EXCLUSIVE MODE;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM appointments earlier
    JOIN appointments later
      ON later.clinic_id = earlier.clinic_id
     AND later.professional_id = earlier.professional_id
     AND later.id > earlier.id
     AND later.status <> 'cancelled'
     AND tstzrange(later.scheduled_start, later.scheduled_end, '[)')
         && tstzrange(earlier.scheduled_start, earlier.scheduled_end, '[)')
    WHERE earlier.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Overlapping non-cancelled appointments exist; resolve them before applying this migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'appointments'::regclass
      AND conname = 'ex_appointments_no_overlapping_professional'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT ex_appointments_no_overlapping_professional
      EXCLUDE USING gist (
        clinic_id WITH =,
        professional_id WITH =,
        tstzrange(scheduled_start, scheduled_end, '[)') WITH &&
      )
      WHERE (status <> 'cancelled');
  END IF;
END
$migration$;

DROP INDEX IF EXISTS ux_appointments_unique_slot;

COMMIT;

-- Reversal, if required: drop only ex_appointments_no_overlapping_professional.
-- The old exact-start index is intentionally not restored because it blocks
-- reuse of cancelled appointment slots and does not prevent interval overlap.
