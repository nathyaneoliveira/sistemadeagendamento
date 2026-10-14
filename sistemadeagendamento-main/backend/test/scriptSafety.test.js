import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertLoopbackApiUrl, assertNonProductionScript } from '../src/scripts/scriptSafety.js';

test('seed/test-flow guard permits only development and test', () => {
  assert.doesNotThrow(() => assertNonProductionScript('development', 'Seed script'));
  assert.doesNotThrow(() => assertNonProductionScript('test', 'Test flow'));

  for (const nodeEnv of [undefined, '', 'production', 'staging']) {
    assert.throws(
      () => assertNonProductionScript(nodeEnv, 'Seed script'),
      /may only run in development or test environments/
    );
  }
});

test('test-flow URL guard accepts local HTTP endpoints only', () => {
  assert.equal(assertLoopbackApiUrl('http://localhost:4000/api'), 'http://localhost:4000/api');
  assert.equal(assertLoopbackApiUrl('http://127.0.0.1:4000/api/'), 'http://127.0.0.1:4000/api');

  for (const apiUrl of [
    'https://localhost:4000/api',
    'http://api.example.invalid/api',
    'http://192.168.1.10:4000/api',
    'not a URL',
    'http://user:password@localhost:4000/api',
  ]) {
    assert.throws(() => assertLoopbackApiUrl(apiUrl), /must point to a local development API/);
  }
});

test('seed and test-flow require configured credentials instead of fallback credentials', () => {
  const seedSource = readFileSync(new URL('../src/scripts/seed.js', import.meta.url), 'utf8');
  const flowSource = readFileSync(new URL('../src/scripts/test-flow.js', import.meta.url), 'utf8');

  assert.match(seedSource, /process\.env\.SEED_ADMIN_EMAIL/);
  assert.match(seedSource, /process\.env\.SEED_ADMIN_PASSWORD/);
  assert.match(flowSource, /process\.env\.TEST_EMAIL/);
  assert.match(flowSource, /process\.env\.TEST_PASSWORD/);
  assert.doesNotMatch(seedSource, /SEED_ADMIN_PASSWORD\s*\|\|/);
  assert.doesNotMatch(flowSource, /TEST_PASSWORD\s*\|\|/);
  assert.doesNotMatch(seedSource, /console\.log\(\{/);
  assert.match(seedSource, /isValidNewPassword\(adminPassword\)/);
  assert.ok(seedSource.indexOf('isValidNewPassword(adminPassword)') < seedSource.indexOf('async function seed()'));
  assert.match(seedSource, /assertNonProductionScript/);
  assert.match(flowSource, /assertNonProductionScript/);
});
