import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schema = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../database/migrations/008_clinic_subscriptions.sql', import.meta.url), 'utf8');
const planMigration = await readFile(new URL('../../database/migrations/009_commercial_plan_tiers.sql', import.meta.url), 'utf8');

test('schema snapshot and original subscription migration retain shared constraints and indexes', () => {
  for (const ddl of [schema, migration]) {
    assert.match(ddl, /CREATE TABLE subscriptions\s*\(/i);
    assert.match(ddl, /billing_cycle IN \('monthly', 'quarterly', 'yearly'\)/i);
    assert.match(ddl, /status IN \('trialing', 'active', 'past_due', 'cancelled', 'expired'\)/i);
    assert.match(ddl, /current_period_start < current_period_end/i);
    assert.match(ddl, /trial_ends_at >= started_at AND trial_ends_at <= current_period_end/i);
    assert.match(ddl, /status <> 'cancelled' OR cancelled_at IS NOT NULL/i);
    assert.match(ddl, /uq_subscriptions_one_current_per_clinic/i);
    assert.match(ddl, /uq_subscriptions_gateway_subscription/i);
    assert.match(ddl, /trg_subscriptions_updated_at/i);
  }
  assert.match(schema, /CHECK \(plan IN \('complete', 'essential', 'professional', 'premium'\)\)/i);
  assert.match(migration, /CHECK \(plan = 'complete'\)/i);
});

test('migration is transactional and additive without provisioning subscription rows', () => {
  assert.match(migration.trimStart(), /^--[\s\S]*?BEGIN;/);
  assert.match(migration.trimEnd(), /COMMIT;$/);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE)\s+INTO?\s+subscriptions\b/i);
  assert.doesNotMatch(migration, /ALTER TABLE (?!subscriptions)/i);
});

test('commercial plan migration expands only the plan constraint without changing existing rows', () => {
  assert.match(planMigration.trimStart(), /^--[\s\S]*?BEGIN;/);
  assert.match(planMigration.trimEnd(), /COMMIT;$/);
  assert.match(planMigration, /ALTER TABLE subscriptions\s+DROP CONSTRAINT IF EXISTS subscriptions_plan_check/i);
  assert.match(planMigration, /CHECK \(plan IN \('complete', 'essential', 'professional', 'premium'\)\)/i);
  assert.doesNotMatch(planMigration, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(planMigration, /ALTER TABLE (?!subscriptions)/i);
});
