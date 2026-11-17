-- Adds consent-based appointment notifications, patient self-service tokens,
-- and a clinic-scoped waitlist. Apply after migration 011.
BEGIN;

ALTER TABLE clinic_configurations
  ADD COLUMN IF NOT EXISTS appointment_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS reminder_consent_at TIMESTAMPTZ;

CREATE TABLE appointment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('confirmation', 'day_before', 'two_hours')),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  due_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error VARCHAR(300),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_appointment_reminders_appointment
    FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments(clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT uq_appointment_reminders_delivery UNIQUE (clinic_id, appointment_id, kind, channel)
);

CREATE INDEX idx_appointment_reminders_due
  ON appointment_reminders(due_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE appointment_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_appointment_access_tokens_appointment
    FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments(clinic_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_appointment_access_tokens_appointment
  ON appointment_access_tokens(clinic_id, appointment_id, expires_at DESC);

CREATE TABLE appointment_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  service_id UUID NOT NULL,
  professional_id UUID,
  patient_name VARCHAR(200) NOT NULL CHECK (length(btrim(patient_name)) > 0),
  patient_phone VARCHAR(20) NOT NULL,
  patient_email VARCHAR(255),
  preferred_from DATE NOT NULL,
  preferred_to DATE NOT NULL,
  preferred_period VARCHAR(20) NOT NULL DEFAULT 'any'
    CHECK (preferred_period IN ('morning', 'afternoon', 'evening', 'any')),
  status VARCHAR(20) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'offered', 'booked', 'cancelled', 'expired')),
  consent_at TIMESTAMPTZ NOT NULL,
  offered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (preferred_to >= preferred_from),
  CONSTRAINT fk_appointment_waitlist_service
    FOREIGN KEY (clinic_id, service_id) REFERENCES services(clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_appointment_waitlist_professional
    FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id) ON DELETE SET NULL (professional_id)
);

CREATE INDEX idx_appointment_waitlist_matching
  ON appointment_waitlist(clinic_id, service_id, preferred_from, preferred_to)
  WHERE status = 'waiting';
CREATE INDEX idx_appointment_waitlist_contact
  ON appointment_waitlist(clinic_id, patient_phone, created_at DESC);

CREATE OR REPLACE FUNCTION sync_appointment_reminders()
RETURNS TRIGGER AS $$
DECLARE
  consented BOOLEAN;
  email_address TEXT;
  phone_number TEXT;
  reminders_enabled BOOLEAN;
  reminder_kind TEXT;
  reminder_channel TEXT;
  reminder_time TIMESTAMPTZ;
BEGIN
  IF NEW.status = 'cancelled' THEN
    UPDATE appointment_reminders
       SET status = 'cancelled', updated_at = NOW()
     WHERE clinic_id = NEW.clinic_id AND appointment_id = NEW.id
       AND status IN ('pending', 'failed');
    RETURN NEW;
  END IF;

  SELECT p.reminder_consent_at IS NOT NULL, NULLIF(trim(p.email), ''), NULLIF(trim(p.phone), ''),
         COALESCE(cc.appointment_reminders_enabled, FALSE)
    INTO consented, email_address, phone_number, reminders_enabled
    FROM patients p
    JOIN clinic_configurations cc ON cc.clinic_id = p.clinic_id
   WHERE p.id = NEW.patient_id AND p.clinic_id = NEW.clinic_id;

  IF NOT COALESCE(consented, FALSE) OR NOT COALESCE(reminders_enabled, FALSE) THEN
    UPDATE appointment_reminders
       SET status = 'cancelled', updated_at = NOW()
     WHERE clinic_id = NEW.clinic_id AND appointment_id = NEW.id
       AND status IN ('pending', 'failed');
    RETURN NEW;
  END IF;

  FOREACH reminder_kind IN ARRAY ARRAY['day_before', 'two_hours'] LOOP
    reminder_time := NEW.scheduled_start - CASE reminder_kind
      WHEN 'day_before' THEN INTERVAL '24 hours'
      ELSE INTERVAL '2 hours'
    END;
    reminder_time := GREATEST(reminder_time, NOW());

    FOREACH reminder_channel IN ARRAY ARRAY['email', 'whatsapp'] LOOP
      IF (reminder_channel = 'email' AND email_address IS NULL)
        OR (reminder_channel = 'whatsapp' AND phone_number IS NULL) THEN
        CONTINUE;
      END IF;
      INSERT INTO appointment_reminders
        (clinic_id, appointment_id, kind, channel, due_at, status, attempts, last_error, sent_at, updated_at)
      VALUES (NEW.clinic_id, NEW.id, reminder_kind, reminder_channel, reminder_time, 'pending', 0, NULL, NULL, NOW())
      ON CONFLICT (clinic_id, appointment_id, kind, channel) DO UPDATE
        SET due_at = EXCLUDED.due_at,
            status = CASE WHEN appointment_reminders.status = 'sent' THEN 'sent' ELSE 'pending' END,
            attempts = CASE WHEN appointment_reminders.status = 'sent' THEN appointment_reminders.attempts ELSE 0 END,
            last_error = NULL,
            updated_at = NOW();
    END LOOP;
  END LOOP;
  FOREACH reminder_channel IN ARRAY ARRAY['email', 'whatsapp'] LOOP
    IF (reminder_channel = 'email' AND email_address IS NULL)
      OR (reminder_channel = 'whatsapp' AND phone_number IS NULL) THEN
      CONTINUE;
    END IF;
    INSERT INTO appointment_reminders
      (clinic_id, appointment_id, kind, channel, due_at, status, attempts, last_error, sent_at, updated_at)
    VALUES (NEW.clinic_id, NEW.id, 'confirmation', reminder_channel, NOW(), 'pending', 0, NULL, NULL, NOW())
    ON CONFLICT (clinic_id, appointment_id, kind, channel) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_appointment_reminders
AFTER INSERT OR UPDATE OF status, scheduled_start, patient_id ON appointments
FOR EACH ROW EXECUTE FUNCTION sync_appointment_reminders();

CREATE OR REPLACE FUNCTION resync_clinic_appointment_reminders()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.appointment_reminders_enabled IS DISTINCT FROM OLD.appointment_reminders_enabled THEN
    UPDATE appointments
       SET scheduled_start = scheduled_start
     WHERE clinic_id = NEW.clinic_id AND scheduled_start > NOW()
       AND status IN ('scheduled', 'confirmed');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_resync_clinic_appointment_reminders
AFTER UPDATE OF appointment_reminders_enabled ON clinic_configurations
FOR EACH ROW EXECUTE FUNCTION resync_clinic_appointment_reminders();

COMMIT;
