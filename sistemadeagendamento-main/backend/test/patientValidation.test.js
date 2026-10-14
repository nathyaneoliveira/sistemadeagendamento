import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCreatePatientRequest,
  isUpdatePatientRequest,
} from '../src/routes/patientValidation.js';

const validPatient = {
  name: 'Synthetic Patient',
  cpf: '123.456.789-09',
  birthDate: '1990-04-10',
  phone: '(11) 90000-0000',
  email: 'patient@example.invalid',
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  status: 'active',
};

test('patient creation accepts schema-sized optional fields and a clinic user UUID', () => {
  assert.equal(isCreatePatientRequest(validPatient), true);
  assert.equal(isCreatePatientRequest({ name: 'Synthetic Patient' }), true);
  assert.equal(isCreatePatientRequest({ ...validPatient, name: '😀'.repeat(200) }), true);
});

test('patient creation rejects invalid types, oversized values, and unsupported fields', () => {
  for (const body of [
    null,
    [],
    { ...validPatient, name: 123 },
    { ...validPatient, name: '   ' },
    { ...validPatient, name: 'x'.repeat(201) },
    { ...validPatient, cpf: 'x'.repeat(15) },
    { ...validPatient, birthDate: {} },
    { ...validPatient, birthDate: '2026-02-30' },
    { ...validPatient, birthDate: '10/04/1990' },
    { ...validPatient, phone: 'x'.repeat(21) },
    { ...validPatient, email: 'x'.repeat(256) },
    { ...validPatient, userId: 'not-a-uuid' },
    { ...validPatient, clinicId: 'another-clinic' },
  ]) {
    assert.equal(isCreatePatientRequest(body), false);
  }
});

test('patient updates require supported fields with schema-sized values', () => {
  assert.equal(isUpdatePatientRequest({ phone: '(11) 90000-0000' }), true);
  assert.equal(isUpdatePatientRequest({ status: 'inactive' }), true);
  assert.equal(isUpdatePatientRequest({ phone: 'x'.repeat(21) }), false);
  assert.equal(isUpdatePatientRequest({ name: 'Synthetic Patient', clinic_id: 'other' }), false);
  assert.equal(isUpdatePatientRequest({}), false);
  assert.equal(isUpdatePatientRequest({ phone: '' }), false);
});
