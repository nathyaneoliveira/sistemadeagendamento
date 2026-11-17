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
