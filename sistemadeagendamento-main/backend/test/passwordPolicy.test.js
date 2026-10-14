import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertValidNewPassword,
  isValidNewPassword,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
} from '../src/utils/passwordPolicy.js';

test('new passwords must meet the minimum character length', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  assert.equal(isValidNewPassword('x'.repeat(11)), false);
  assert.equal(isValidNewPassword('x'.repeat(12)), true);
});

test('new passwords cannot exceed bcrypt’s 72-byte input limit', () => {
  assert.equal(MAX_PASSWORD_BYTES, 72);
  assert.equal(isValidNewPassword('x'.repeat(72)), true);
  assert.equal(isValidNewPassword('x'.repeat(73)), false);
  assert.equal(isValidNewPassword(`${'a'.repeat(70)}é`), true);
  assert.equal(isValidNewPassword(`${'a'.repeat(71)}é`), false);
});

test('new password minimum counts Unicode code points and maximum counts UTF-8 bytes', () => {
  assert.equal(isValidNewPassword('😀'.repeat(6)), false);
  assert.equal(isValidNewPassword('😀'.repeat(12)), true);
  assert.equal(isValidNewPassword('😀'.repeat(18)), true);
  assert.equal(isValidNewPassword('😀'.repeat(19)), false);
  assert.equal(isValidNewPassword('á'.repeat(12)), true);
});

test('new password policy rejects non-string values and reports invalid input', () => {
  for (const password of [null, undefined, 123, {}, ['synthetic-password']]) {
    assert.equal(isValidNewPassword(password), false);
    assert.throws(() => assertValidNewPassword(password), { statusCode: 400 });
  }
});
