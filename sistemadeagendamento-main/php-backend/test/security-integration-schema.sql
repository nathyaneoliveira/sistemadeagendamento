CREATE TABLE clinics (
  id UUID PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  trade_name VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_test_clinics_id UNIQUE (id)
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
  token_version INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, email),
  UNIQUE (clinic_id, id)
);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (clinic_id, user_id) REFERENCES users(clinic_id, id) ON DELETE CASCADE
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  plan VARCHAR(30) NOT NULL CHECK (plan IN ('complete', 'essential', 'professional', 'premium')),
  billing_cycle VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  started_at TIMESTAMPTZ NOT NULL,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  trial_ends_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (started_at <= current_period_start AND current_period_start < current_period_end)
);

CREATE TABLE clinic_configurations (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL UNIQUE REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(200),
  phone VARCHAR(20),
  whatsapp VARCHAR(20),
  address_line1 VARCHAR(255),
  email VARCHAR(255),
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  public_slug VARCHAR(63)
);

CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  key VARCHAR(100) NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, key)
);

CREATE TABLE specialties (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  UNIQUE (clinic_id, id)
);

CREATE TABLE services (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (clinic_id, id)
);

CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID,
  name VARCHAR(200) NOT NULL,
  cpf VARCHAR(14),
  birth_date DATE,
  phone VARCHAR(20),
  email VARCHAR(255),
  reminder_consent_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, user_id) REFERENCES users(clinic_id, id)
);

CREATE TABLE professionals (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID,
  specialty_id UUID,
  name VARCHAR(200) NOT NULL,
  crm VARCHAR(50),
  phone VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, user_id) REFERENCES users(clinic_id, id),
  FOREIGN KEY (clinic_id, specialty_id) REFERENCES specialties(clinic_id, id)
);

CREATE TABLE professional_services (
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL,
  service_id UUID NOT NULL,
  PRIMARY KEY (clinic_id, professional_id, service_id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id) ON DELETE CASCADE,
  FOREIGN KEY (clinic_id, service_id) REFERENCES services(clinic_id, id) ON DELETE CASCADE
);

CREATE TABLE professional_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL CHECK (end_time > start_time),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  break_duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_duration_minutes >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id) ON DELETE CASCADE
);

CREATE TABLE schedule_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL,
  block_type VARCHAR(30) NOT NULL CHECK (block_type IN ('vacation', 'holiday', 'meeting', 'absence', 'custom')),
  start_datetime TIMESTAMPTZ NOT NULL,
  end_datetime TIMESTAMPTZ NOT NULL CHECK (end_datetime > start_datetime),
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id) ON DELETE CASCADE
);

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL,
  professional_id UUID NOT NULL,
  specialty_id UUID,
  service_id UUID,
  service_name_snapshot VARCHAR(200),
  service_price_snapshot NUMERIC(10,2),
  service_duration_snapshot INTEGER,
  public_idempotency_key UUID,
  rescheduled_from_appointment_id UUID,
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled')),
  code VARCHAR(30) NOT NULL UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (scheduled_end > scheduled_start),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id),
  FOREIGN KEY (clinic_id, specialty_id) REFERENCES specialties(clinic_id, id),
  FOREIGN KEY (clinic_id, rescheduled_from_appointment_id) REFERENCES appointments(clinic_id, id),
  CHECK (rescheduled_from_appointment_id IS NULL OR rescheduled_from_appointment_id <> id)
);
CREATE UNIQUE INDEX uq_test_appointments_clinic_idempotency_key
  ON appointments(clinic_id, public_idempotency_key)
  WHERE public_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX uq_appointments_rescheduled_from
  ON appointments(clinic_id, rescheduled_from_appointment_id)
  WHERE rescheduled_from_appointment_id IS NOT NULL;

CREATE TABLE appointment_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments(clinic_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_test_appointment_access_tokens
  ON appointment_access_tokens(clinic_id, appointment_id, expires_at DESC);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL,
  provider VARCHAR(50) DEFAULT 'internal',
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'BRL',
  payment_mode VARCHAR(30) NOT NULL DEFAULT 'before' CHECK (payment_mode IN ('before', 'after')),
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  external_reference VARCHAR(255),
  metadata JSONB,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments(clinic_id, id)
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (clinic_id, user_id) REFERENCES users(clinic_id, id)
);

CREATE TABLE platform_admin_accounts (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  token_version INTEGER NOT NULL DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE platform_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID REFERENCES platform_admin_accounts(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  details JSONB,
  request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE php_security_test_marker (
  version INTEGER PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
