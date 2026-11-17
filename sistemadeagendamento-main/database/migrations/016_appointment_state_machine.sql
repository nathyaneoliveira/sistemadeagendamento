BEGIN;

ALTER TABLE appointments
  ADD COLUMN rescheduled_from_appointment_id UUID;

ALTER TABLE appointments
  ADD CONSTRAINT fk_appointments_rescheduled_from
    FOREIGN KEY (clinic_id, rescheduled_from_appointment_id)
    REFERENCES appointments(clinic_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_appointments_not_rescheduled_from_self
    CHECK (
      rescheduled_from_appointment_id IS NULL
      OR rescheduled_from_appointment_id <> id
    );

CREATE UNIQUE INDEX uq_appointments_rescheduled_from
  ON appointments(clinic_id, rescheduled_from_appointment_id)
  WHERE rescheduled_from_appointment_id IS NOT NULL;

ALTER TABLE appointments
  DROP CONSTRAINT ex_appointments_no_overlapping_professional;

ALTER TABLE appointments
  ADD CONSTRAINT ex_appointments_no_overlapping_professional
  EXCLUDE USING gist (
    clinic_id WITH =,
    professional_id WITH =,
    tstzrange(scheduled_start, scheduled_end, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'rescheduled'));

CREATE OR REPLACE FUNCTION cancel_rescheduled_appointment_reminders()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE appointment_reminders
     SET status = 'cancelled', updated_at = NOW()
   WHERE clinic_id = NEW.clinic_id
     AND appointment_id = NEW.id
     AND status IN ('pending', 'failed');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_z_cancel_rescheduled_appointment_reminders
AFTER UPDATE OF status ON appointments
FOR EACH ROW
WHEN (NEW.status = 'rescheduled')
EXECUTE FUNCTION cancel_rescheduled_appointment_reminders();

COMMIT;
