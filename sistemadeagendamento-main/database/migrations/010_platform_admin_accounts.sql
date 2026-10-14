BEGIN;

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

COMMIT;
