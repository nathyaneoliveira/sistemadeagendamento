-- Allow the three commercial tiers while preserving existing complete subscriptions.
BEGIN;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('complete', 'essential', 'professional', 'premium'));

COMMIT;
