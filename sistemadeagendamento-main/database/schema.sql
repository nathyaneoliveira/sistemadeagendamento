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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  CONSTRAINT ex_appointments_no_overlapping_professional
    EXCLUDE USING gist (
      clinic_id WITH =,
      professional_id WITH =,
      tstzrange(scheduled_start, scheduled_end, '[)') WITH &&
    )
    WHERE (status <> 'cancelled')
);

CREATE INDEX idx_appointments_clinic_id ON appointments(clinic_id);
CREATE INDEX idx_appointments_professional_id ON appointments(professional_id);
CREATE INDEX idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX idx_appointments_scheduled_start ON appointments(scheduled_start);
CREATE INDEX idx_appointments_clinic_service_id ON appointments(clinic_id, service_id);
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
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_payments_clinic_appointment
    FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments(clinic_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_payments_appointment_id ON payments(appointment_id);
CREATE INDEX idx_payments_status ON payments(status);

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
