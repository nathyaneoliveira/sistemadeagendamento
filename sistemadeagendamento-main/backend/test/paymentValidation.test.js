import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCreatePaymentRequest,
  isPaymentStatusUpdate,
  isValidPaymentAmount,
} from '../src/routes/paymentValidation.js';

const validPayment = {
  appointmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  amount: 125.5,
};

test('accepts valid non-negative monetary amounts', () => {
  for (const amount of [0, 0.01, 1, 1.2, 1.23, 99_999_999.99]) {
    assert.equal(isValidPaymentAmount(amount), true, `expected ${amount} to be valid`);
  }
});

test('rejects missing, non-number, non-finite, negative, and excessively large amounts', () => {
  for (const amount of [undefined, null, '1.25', '', -0.01, Number.NaN, Infinity, -Infinity, 100_000_000]) {
    assert.equal(isValidPaymentAmount(amount), false, `expected ${String(amount)} to be invalid`);
  }
});

test('rejects amounts with more than two decimal places', () => {
  for (const amount of [1.005, 1.234, 0.001]) {
    assert.equal(isValidPaymentAmount(amount), false, `expected ${amount} to be invalid`);
  }
});

test('accepts payment optionals supported by the schema and existing defaults', () => {
  assert.equal(isCreatePaymentRequest(validPayment), true);
  assert.equal(isCreatePaymentRequest({
    ...validPayment,
    currency: 'BRL',
    provider: 'p'.repeat(50),
    paymentMode: 'after',
    status: 'paid',
  }), true);
  assert.equal(isCreatePaymentRequest({
    ...validPayment,
    currency: null,
    provider: '',
    paymentMode: null,
    status: '',
  }), true);
});

test('rejects malformed payment identifiers, optional values, and unexpected fields', () => {
  for (const invalid of [
    { ...validPayment, appointmentId: 'appointment-1' },
    { ...validPayment, appointmentId: null },
    { ...validPayment, amount: '125.50' },
    { ...validPayment, currency: 123 },
    { ...validPayment, currency: 'USDD' },
    { ...validPayment, currency: 'B\0L' },
    { ...validPayment, provider: 'p'.repeat(51) },
    { ...validPayment, provider: 'internal\0' },
    { ...validPayment, paymentMode: 'later' },
    { ...validPayment, status: 'processing' },
    { ...validPayment, clinicId: 'clinic-b' },
  ]) {
    assert.equal(isCreatePaymentRequest(invalid), false);
  }
  assert.equal(isCreatePaymentRequest(null), false);
  assert.equal(isCreatePaymentRequest([]), false);
});

test('payment status updates accept only schema values and known fields', () => {
  for (const status of ['pending', 'paid', 'cancelled', 'refunded']) {
    assert.equal(isPaymentStatusUpdate({ status }), true);
  }
  assert.equal(isPaymentStatusUpdate({ status: 'processing' }), false);
  assert.equal(isPaymentStatusUpdate({ status: null }), false);
  assert.equal(isPaymentStatusUpdate({ status: 'paid', clinicId: 'clinic-b' }), false);
});
