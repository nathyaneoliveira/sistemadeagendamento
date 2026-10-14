import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuntimeConfig } from '../src/config/runtimeConfig.js';

const testSecret = 'runtime-config-unit-test-secret-value';

function validProductionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    PORT: '4000',
    DB_HOST: 'postgres.internal',
    DB_PORT: '5432',
    DB_NAME: 'clinic_production',
    DB_USER: 'clinic_api',
    DB_PASSWORD: 'non-example-production-password',
    DB_SSL: 'true',
    CORS_ORIGIN: 'https://agenda.example.invalid',
    JWT_SECRET: testSecret,
    ...overrides,
  };
}

test('production rejects each missing required runtime setting', () => {
  for (const name of [
    'PORT',
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'CORS_ORIGIN',
  ]) {
    const source = validProductionEnv();
    delete source[name];
    assert.throws(() => buildRuntimeConfig(source), new RegExp(`${name} must be configured`));
  }
});

test('production rejects a missing JWT secret and missing TLS enablement', () => {
  const missingSecret = validProductionEnv();
  delete missingSecret.JWT_SECRET;
  assert.throws(() => buildRuntimeConfig(missingSecret), /JWT_SECRET must contain at least 32 bytes/);

  const missingTls = validProductionEnv();
  delete missingTls.DB_SSL;
  assert.throws(() => buildRuntimeConfig(missingTls), /DB_SSL must be enabled in production/);
});

test('production accepts explicit valid settings with TLS verification enabled', () => {
  const config = buildRuntimeConfig(validProductionEnv());
  assert.equal(config.nodeEnv, 'production');
  assert.equal(config.db.ssl.rejectUnauthorized, true);
  assert.equal(config.corsOrigin, 'https://agenda.example.invalid');
});

test('production CORS origin must be a single non-local HTTPS origin', () => {
  for (const origin of [
    'http://agenda.example.invalid',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://agenda.example.invalid/path',
    'https://agenda.example.invalid/',
    '*',
  ]) {
    assert.throws(
      () => buildRuntimeConfig(validProductionEnv({ CORS_ORIGIN: origin })),
      /CORS_ORIGIN must be a valid HTTPS origin/
    );
  }
});

test('production rejects loopback database hosts and development database defaults', () => {
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    assert.throws(
      () => buildRuntimeConfig(validProductionEnv({ DB_HOST: host })),
      /DB_HOST must not point to a loopback address/
    );
  }

  for (const name of ['clinic_db']) {
    assert.throws(
      () => buildRuntimeConfig(validProductionEnv({ DB_NAME: name })),
      /Development database defaults are not allowed/
    );
  }

  assert.throws(
    () => buildRuntimeConfig(validProductionEnv({ DB_USER: 'clinic_user' })),
    /Development database defaults are not allowed/
  );
  assert.throws(
    () => buildRuntimeConfig(validProductionEnv({ DB_PASSWORD: 'clinic_password' })),
    /Development database defaults are not allowed/
  );
});

test('missing NODE_ENV defaults to test while invalid values are rejected', () => {
  const config = buildRuntimeConfig({ JWT_SECRET: testSecret });
  assert.equal(config.nodeEnv, 'test');

  assert.throws(
    () => buildRuntimeConfig({ NODE_ENV: 'staging', JWT_SECRET: testSecret }),
    /NODE_ENV must be explicitly set/
  );
});

test('development defaults remain available when using the documented example values', () => {
  const config = buildRuntimeConfig({
    NODE_ENV: 'development',
    JWT_SECRET: testSecret,
    DB_SSL: 'false',
  });

  assert.equal(config.port, 4000);
  assert.equal(config.db.host, 'localhost');
  assert.equal(config.db.port, 5432);
  assert.equal(config.db.name, 'clinic_db');
  assert.equal(config.db.user, 'clinic_user');
  assert.equal(config.db.ssl, undefined);
  assert.equal(config.corsOrigin, 'http://localhost:5173');
});

test('invalid production ports fail clearly', () => {
  for (const [name, value] of [['PORT', '0'], ['PORT', '70000'], ['DB_PORT', 'not-a-port']]) {
    assert.throws(
      () => buildRuntimeConfig(validProductionEnv({ [name]: value })),
      new RegExp(`${name} must be an integer`)
    );
  }
});
