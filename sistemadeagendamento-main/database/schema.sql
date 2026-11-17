CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  trade_name VARCHAR(200),
  cnpj VARCHAR(18) UNIQUE,
  phone VARCHAR(20),
  whatsapp VARCHAR(20),
  email VARCHAR(255),
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  city VARCHAR(120),
  state VARCHAR(2),
  zip_code VARCHAR(10),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  suspension_reason VARCHAR(30) CHECK (suspension_reason IN ('onboarding', 'billing', 'administrative')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(30) NOT NULL CHECK (role IN ('admin', 'reception', 'professional', 'patient')),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  token_version INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, email),
  CONSTRAINT uq_users_clinic_id_id UNIQUE (clinic_id, id)
);

CREATE INDEX idx_users_clinic_id ON users(clinic_id);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL,
  user_id UUID NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_password_reset_tokens_user
    FOREIGN KEY (clinic_id, user_id)
    REFERENCES users(clinic_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_password_reset_tokens_active_user
  ON password_reset_tokens (clinic_id, user_id)
  WHERE used_at IS NULL;

CREATE INDEX idx_password_reset_tokens_expires_at
  ON password_reset_tokens (expires_at);

CREATE TABLE platform_admin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL CHECK (email = LOWER(BTRIM(email))),
  name VARCHAR(200) NOT NULL CHECK (length(btrim(name)) > 0),
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  token_version INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_platform_admin_accounts_email ON platform_admin_accounts(email);

CREATE TABLE specialties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, name),
  CONSTRAINT uq_specialties_clinic_id_id UNIQUE (clinic_id, id)
);

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

CREATE TABLE professionals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  specialty_id UUID REFERENCES specialties(id) ON DELETE RESTRICT,
  name VARCHAR(200) NOT NULL,
  crm VARCHAR(50),
  phone VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_professionals_clinic_id_id UNIQUE (clinic_id, id),
  CONSTRAINT uq_professionals_clinic_id_specialty_id UNIQUE (clinic_id, id, specialty_id),
  CONSTRAINT fk_professionals_clinic_user
    FOREIGN KEY (clinic_id, user_id) REFERENCES users(clinic_id, id) ON DELETE SET NULL (user_id),
  CONSTRAINT fk_professionals_clinic_specialty
    FOREIGN KEY (clinic_id, specialty_id) REFERENCES specialties(clinic_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_professionals_clinic_id ON professionals(clinic_id);
CREATE INDEX idx_professionals_specialty_id ON professionals(specialty_id);

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

CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  cpf VARCHAR(14),
  birth_date DATE,
  phone VARCHAR(20),
  email VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, cpf),
  CONSTRAINT uq_patients_clinic_id_id UNIQUE (clinic_id, id),
  CONSTRAINT fk_patients_clinic_user
    FOREIGN KEY (clinic_id, user_id) REFERENCES users(clinic_id, id) ON DELETE SET NULL (user_id)
);

CREATE INDEX idx_patients_clinic_id ON patients(clinic_id);

CREATE TABLE professional_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  break_duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_duration_minutes >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (professional_id, weekday, start_time, end_time),
  CONSTRAINT fk_professional_schedules_clinic_professional
    FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_professional_schedules_professional_id ON professional_schedules(professional_id);

CREATE TABLE schedule_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  block_type VARCHAR(30) NOT NULL CHECK (block_type IN ('vacation', 'holiday', 'meeting', 'absence', 'custom')),
  start_datetime TIMESTAMPTZ NOT NULL,
  end_datetime TIMESTAMPTZ NOT NULL,
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_datetime > start_datetime),
  CONSTRAINT fk_schedule_blocks_clinic_professional
    FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_schedule_blocks_professional_id ON schedule_blocks(professional_id);
CREATE INDEX idx_schedule_blocks_date_range ON schedule_blocks(start_datetime, end_datetime);

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
  specialty_id UUID REFERENCES specialties(id) ON DELETE RESTRICT,
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  service_id UUID,
  service_name_snapshot VARCHAR(200),
  service_price_snapshot NUMERIC(10,2),
  service_duration_snapshot INTEGER,
  public_idempotency_key UUID,
  rescheduled_from_appointment_id UUID,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled')),
  code VARCHAR(30) NOT NULL UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (scheduled_end > scheduled_start),
  CHECK (
    (service_id IS NULL AND service_name_snapshot IS NULL AND service_price_snapshot IS NULL AND service_duration_snapshot IS NULL)
    OR
    (service_id IS NOT NULL AND service_name_snapshot IS NOT NULL
      AND length(btrim(service_name_snapshot)) > 0 AND service_price_snapshot IS NOT NULL
      AND service_price_snapshot >= 0 AND service_duration_snapshot IS NOT NULL
      AND service_duration_snapshot BETWEEN 1 AND 1440)
  ),
  CONSTRAINT uq_appointments_clinic_id_id UNIQUE (clinic_id, id),
  CONSTRAINT fk_appointments_clinic_patient
    FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_clinic_professional
    FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_clinic_specialty
    FOREIGN KEY (clinic_id, specialty_id) REFERENCES specialties(clinic_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_clinic_service
    FOREIGN KEY (clinic_id, service_id) REFERENCES services(clinic_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_clinic_professional_specialty
    FOREIGN KEY (clinic_id, professional_id, specialty_id)
    REFERENCES professionals(clinic_id, id, specialty_id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_rescheduled_from
    FOREIGN KEY (clinic_id, rescheduled_from_appointment_id)
    REFERENCES appointments(clinic_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_appointments_not_rescheduled_from_self
    CHECK (rescheduled_from_appointment_id IS NULL OR rescheduled_from_appointment_id <> id),
  CONSTRAINT ex_appointments_no_overlapping_professional
    EXCLUDE USING gist (
      clinic_id WITH =,
      professional_id WITH =,
      tstzrange(scheduled_start, scheduled_end, '[)') WITH &&
    )
    WHERE (status NOT IN ('cancelled', 'rescheduled'))
);

CREATE INDEX idx_appointments_clinic_id ON appointments(clinic_id);
CREATE INDEX idx_appointments_professional_id ON appointments(professional_id);
CREATE INDEX idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX idx_appointments_scheduled_start ON appointments(scheduled_start);
CREATE INDEX idx_appointments_clinic_service_id ON appointments(clinic_id, service_id);
CREATE UNIQUE INDEX uq_appointments_rescheduled_from
  ON appointments(clinic_id, rescheduled_from_appointment_id)
  WHERE rescheduled_from_appointment_id IS NOT NULL;
CREATE UNIQUE INDEX uq_appointments_clinic_id_idempotency_key
  ON appointments(clinic_id, public_idempotency_key)
  WHERE public_idempotency_key IS NOT NULL;
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  provider VARCHAR(50) DEFAULT 'internal',
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'BRL',
  payment_mode VARCHAR(30) NOT NULL DEFAULT 'before' CHECK (payment_mode IN ('before', 'after')),
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  external_reference VARCHAR(255),
  gateway_payment_id VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_payments_clinic_appointment
    FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments(clinic_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_payments_appointment_id ON payments(appointment_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE UNIQUE INDEX uq_payments_provider_gateway_payment
  ON payments(provider, gateway_payment_id)
  WHERE provider = 'mercadopago' AND gateway_payment_id IS NOT NULL;

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  plan VARCHAR(30) NOT NULL DEFAULT 'complete'
    CHECK (plan IN ('complete', 'essential', 'professional', 'premium')),
  billing_cycle VARCHAR(20) NOT NULL
    CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly')),
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  started_at TIMESTAMPTZ NOT NULL,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  trial_ends_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  gateway VARCHAR(50),
  gateway_customer_id VARCHAR(255),
  gateway_subscription_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_subscriptions_period_order
    CHECK (started_at <= current_period_start AND current_period_start < current_period_end),
  CONSTRAINT ck_subscriptions_trial_start
    CHECK (trial_ends_at IS NULL OR
      (trial_ends_at >= started_at AND trial_ends_at <= current_period_end)),
  CONSTRAINT ck_subscriptions_trialing_end
    CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL),
  CONSTRAINT ck_subscriptions_cancelled_start
    CHECK (cancelled_at IS NULL OR cancelled_at >= started_at),
  CONSTRAINT ck_subscriptions_cancelled_timestamp
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT ck_subscriptions_gateway_identifiers
    CHECK (
      (gateway IS NULL OR length(btrim(gateway)) > 0)
      AND (
        (gateway_customer_id IS NULL AND gateway_subscription_id IS NULL)
        OR gateway IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX uq_subscriptions_one_current_per_clinic
  ON subscriptions(clinic_id)
  WHERE status IN ('trialing', 'active', 'past_due');

CREATE INDEX idx_subscriptions_clinic_created_at
  ON subscriptions(clinic_id, created_at DESC);

CREATE UNIQUE INDEX uq_subscriptions_gateway_subscription
  ON subscriptions(gateway, gateway_subscription_id)
  WHERE gateway IS NOT NULL AND gateway_subscription_id IS NOT NULL;

CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  key VARCHAR(100) NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, key)
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_audit_logs_clinic_user
    FOREIGN KEY (clinic_id, user_id) REFERENCES users(clinic_id, id) ON DELETE SET NULL (user_id)
);

CREATE INDEX idx_audit_logs_clinic_id ON audit_logs(clinic_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);

CREATE TABLE platform_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID REFERENCES platform_admin_accounts(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  details JSONB CHECK (details IS NULL OR jsonb_typeof(details) = 'object'),
  request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_audit_logs_created_at
  ON platform_audit_logs(created_at DESC);
CREATE INDEX idx_platform_audit_logs_admin_created_at
  ON platform_audit_logs(platform_admin_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_audit_entity_clinic()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_entity_clinic
BEFORE INSERT OR UPDATE OF clinic_id, entity_type, entity_id ON audit_logs
FOR EACH ROW EXECUTE FUNCTION enforce_audit_entity_clinic();

CREATE TABLE clinic_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(200),
  logo_url TEXT,
  phone VARCHAR(20),
  whatsapp VARCHAR(20),
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  email VARCHAR(255),
  opening_hours JSONB,
  service_info TEXT,
  public_slug VARCHAR(63) CHECK (
    public_slug IS NULL OR public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC' CHECK (length(btrim(timezone)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id)
);

CREATE UNIQUE INDEX uq_clinic_configurations_public_slug
  ON clinic_configurations(public_slug)
  WHERE public_slug IS NOT NULL;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clinics_updated_at
BEFORE UPDATE ON clinics
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_specialties_updated_at
BEFORE UPDATE ON specialties
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_services_updated_at
BEFORE UPDATE ON services
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_professionals_updated_at
BEFORE UPDATE ON professionals
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_patients_updated_at
BEFORE UPDATE ON patients
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_professional_schedules_updated_at
BEFORE UPDATE ON professional_schedules
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_schedule_blocks_updated_at
BEFORE UPDATE ON schedule_blocks
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_appointments_updated_at
BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_subscriptions_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_settings_updated_at
BEFORE UPDATE ON settings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_clinic_configurations_updated_at
BEFORE UPDATE ON clinic_configurations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
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
  IF NEW.status IN ('cancelled', 'rescheduled') THEN
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
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'paid_late', 'failed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_checkout_sessions_gateway_payment UNIQUE (gateway, gateway_payment_id)
);
CREATE INDEX idx_checkout_sessions_pending ON checkout_sessions(status, created_at) WHERE status = 'pending';
CREATE TRIGGER trg_checkout_sessions_updated_at BEFORE UPDATE ON checkout_sessions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
COMMIT;
BEGIN;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
UPDATE payments SET paid_at = updated_at WHERE status = 'paid' AND paid_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_clinic_paid_at ON payments(clinic_id, paid_at) WHERE status = 'paid';
COMMIT;
