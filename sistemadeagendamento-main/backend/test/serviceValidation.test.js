import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasExpectedAppointmentDuration,
  isCreateServiceRequest,
  isProfessionalServiceAssignmentRequest,
  isServiceStatusRequest,
  isUpdateServiceRequest,
  isValidServicePrice,
} from '../src/routes/serviceValidation.js';

const professionalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const validService = {
  name: 'Consulta',
  description: 'Atendimento',
  durationMinutes: 45,
  price: 125.5,
  professionalIds: [professionalId],
};

test('service creation validates fields and optional professional assignments', () => {
  assert.equal(isCreateServiceRequest(validService), true);
  assert.equal(isCreateServiceRequest({ ...validService, professionalIds: ['invalid'] }), false);
  assert.equal(isCreateServiceRequest({ ...validService, serviceId: professionalId }), false);
  assert.equal(isCreateServiceRequest({ ...validService, durationMinutes: 0 }), false);
});

test('service updates accept supported fields only and validate assignments', () => {
  assert.equal(isUpdateServiceRequest({ price: 100 }), true);
  assert.equal(isUpdateServiceRequest({ professionalIds: [professionalId] }), true);
  assert.equal(isUpdateServiceRequest({ professionalIds: [professionalId, professionalId] }), false);
  assert.equal(isUpdateServiceRequest({ clinicId: 'another-clinic' }), false);
});

test('assignment and activation request schemas reject malformed inputs', () => {
  assert.equal(isProfessionalServiceAssignmentRequest({ professionalIds: [professionalId] }), true);
  assert.equal(isProfessionalServiceAssignmentRequest({ professionalIds: ['professional-1'] }), false);
  assert.equal(isServiceStatusRequest({ isActive: false }), true);
  assert.equal(isServiceStatusRequest({ isActive: 'false' }), false);
});

test('service prices remain non-negative, finite, bounded, and limited to cents', () => {
  for (const value of [0, 10, 12.34, 99_999_999.99]) {
    assert.equal(isValidServicePrice(value), true);
  }
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.001, 100_000_000]) {
    assert.equal(isValidServicePrice(value), false);
  }
});

test('appointment duration must exactly match the stored service duration', () => {
  assert.equal(
    hasExpectedAppointmentDuration('2026-10-07T10:00:00.000Z', '2026-10-07T10:45:00.000Z', 45),
    true
  );
  assert.equal(
    hasExpectedAppointmentDuration('2026-10-07T10:00:00.000Z', '2026-10-07T10:30:00.000Z', 45),
    false
  );
});
