import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { buildDatabaseSslOptions } from '../src/config/dbTls.js';

const { Pool } = pg;

test('development permits PostgreSQL without TLS by default', () => {
  assert.equal(buildDatabaseSslOptions({ nodeEnv: 'development' }), undefined);
  assert.equal(buildDatabaseSslOptions({ nodeEnv: 'development', sslValue: 'false' }), undefined);
});

test('test permits PostgreSQL without TLS', () => {
  assert.equal(buildDatabaseSslOptions({ nodeEnv: 'test', sslValue: '0' }), undefined);
});

test('production rejects missing or disabled TLS', () => {
  assert.throws(
    () => buildDatabaseSslOptions({ nodeEnv: 'production' }),
    /DB_SSL must be enabled in production/
  );
  assert.throws(
    () => buildDatabaseSslOptions({ nodeEnv: 'production', sslValue: 'false' }),
    /DB_SSL must be enabled in production/
  );
});

test('production enables TLS and validates the server certificate', () => {
  const ssl = buildDatabaseSslOptions({ nodeEnv: 'production', sslValue: 'true' });
  assert.deepEqual(ssl, { rejectUnauthorized: true });

  const pool = new Pool({ ssl });
  assert.equal(pool.options.ssl.rejectUnauthorized, true);
  void pool.end();
});

test('DB_SSL accepts only explicit true and false values', () => {
  for (const value of ['true', '1']) {
    assert.deepEqual(
      buildDatabaseSslOptions({ nodeEnv: 'development', sslValue: value }),
      { rejectUnauthorized: true }
    );
  }

  for (const value of ['false', '0']) {
    assert.equal(buildDatabaseSslOptions({ nodeEnv: 'development', sslValue: value }), undefined);
  }

  for (const value of ['yes', 'no', 'on', 'off', 'abc', '']) {
    assert.throws(
      () => buildDatabaseSslOptions({ nodeEnv: 'development', sslValue: value }),
      /DB_SSL must be set to true, 1, false, or 0/
    );
  }
});

test('missing CA file fails without exposing its path', () => {
  const sensitivePath = 'C:\\private\\provider-ca.pem';
  assert.throws(
    () => buildDatabaseSslOptions({
      nodeEnv: 'production',
      sslValue: 'true',
      caPath: sensitivePath,
      readCaFile: () => {
        throw new Error('file not found');
      },
    }),
    (error) => {
      assert.match(error.message, /DB_SSL_CA_PATH must point to a readable CA certificate file/);
      assert.equal(error.message.includes(sensitivePath), false);
      return true;
    }
  );
});

test('custom CA is loaded while certificate validation remains enabled', () => {
  const ssl = buildDatabaseSslOptions({
    nodeEnv: 'production',
    sslValue: 'true',
    caPath: '/mounted/ca.pem',
    readCaFile: (path) => {
      assert.equal(path, '/mounted/ca.pem');
      return 'test-ca-pem';
    },
  });

  assert.deepEqual(ssl, { rejectUnauthorized: true, ca: 'test-ca-pem' });
});

test('CA path cannot be supplied while TLS is disabled', () => {
  assert.throws(
    () => buildDatabaseSslOptions({
      nodeEnv: 'development',
      sslValue: 'false',
      caPath: '/mounted/ca.pem',
    }),
    /DB_SSL_CA_PATH requires DB_SSL to be enabled/
  );
});
