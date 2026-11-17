import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApiUrl } from '../src/apiConfig.js';

test('development retains local API default', () => {
  assert.equal(
    resolveApiUrl({ isProduction: false }),
    'http://localhost:4000/api'
  );
});

test('production requires an explicit HTTPS API URL or the same-origin API path', () => {
  assert.throws(
    () => resolveApiUrl({ isProduction: true }),
    /VITE_API_URL must be configured for production builds/
  );
  assert.equal(
    resolveApiUrl({ isProduction: true, apiUrl: '/api' }),
    '/api'
  );
  assert.equal(
    resolveApiUrl({ isProduction: true, apiUrl: 'https://agenda.example.invalid/api' }),
    'https://agenda.example.invalid/api'
  );
});

test('production rejects insecure or loopback API URLs', () => {
  for (const apiUrl of [
    'http://api.example.invalid',
    'https://localhost:4000/api',
    'https://127.0.0.1/api',
  ]) {
    assert.throws(
      () => resolveApiUrl({ isProduction: true, apiUrl }),
      /must use HTTPS/
    );
  }
});

test('production only accepts the exact same-origin API path when using a relative URL', () => {
  for (const apiUrl of ['/api/', '/api?mode=test', '//api.example.invalid/api']) {
    assert.throws(
      () => resolveApiUrl({ isProduction: true, apiUrl }),
      /absolute HTTP\(S\) URL/
    );
  }
});

test('API URL rejects credentials, query strings, fragments, and invalid URL values', () => {
  for (const apiUrl of [
    'https://user:password@api.example.invalid',
    'https://api.example.invalid/api?token=x',
    'https://api.example.invalid/api#section',
    'not a url',
  ]) {
    assert.throws(() => resolveApiUrl({ isProduction: false, apiUrl }));
  }
});
