ALTER TABLE clinic_configurations
  ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'UTC'
  CHECK (length(btrim(timezone)) > 0);
