import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCreateProfessionalRequest,
  isUpdateProfessionalRequest,
} from '../src/routes/professionalValidation.js';

const specialtyId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

test('professional creation validates required identifiers and schema-sized text fields', () => {
  assert.equal(isCreateProfessionalRequest({
    name: 'Profissional sintético',
    specialtyId,
    userId,
    crm: 'A'.repeat(50),
    phone: '1'.repeat(20),
    status: 'active',
  }), true);
  assert.equal(isCreateProfessionalRequest({ name: 'Profissional' }), false);
  assert.equal(isCreateProfessionalRequest({ name: 'Profissional', specialtyId: 'invalid' }), false);
  assert.equal(isCreateProfessionalRequest({
    name: 'P'.repeat(201),
    specialtyId,
  }), false);
  assert.equal(isCreateProfessionalRequest({
    name: 'Profissional',
    specialtyId,
    userId: {},
  }), false);
  assert.equal(isCreateProfessionalRequest({
    name: 'Profissional',
    specialtyId,
    crm: 'A'.repeat(51),
  }), false);
  assert.equal(isCreateProfessionalRequest({
    name: 'Profissional',
    specialtyId,
    phone: '1'.repeat(21),
  }), false);
  assert.equal(isCreateProfessionalRequest({
    name: 'Profissional',
    specialtyId,
    status: 'pending',
  }), false);
  assert.equal(isCreateProfessionalRequest({
    name: 'Profissional\0',
    specialtyId,
  }), false);
});

test('professional updates validate provided values while allowing omitted and nullable optional fields', () => {
  assert.equal(isUpdateProfessionalRequest({ phone: '11999999999', crm: null }), true);
  assert.equal(isUpdateProfessionalRequest({ phone: '11999999999', name: '' }), true);
  assert.equal(isUpdateProfessionalRequest({}), false);
  assert.equal(isUpdateProfessionalRequest({ phone: {} }), false);
  assert.equal(isUpdateProfessionalRequest({ name: 'P'.repeat(201) }), false);
  assert.equal(isUpdateProfessionalRequest({ specialtyId: 'invalid' }), false);
  assert.equal(isUpdateProfessionalRequest({ crm: 'A'.repeat(51) }), false);
  assert.equal(isUpdateProfessionalRequest({ phone: '1'.repeat(21) }), false);
  assert.equal(isUpdateProfessionalRequest({ status: 'pending' }), false);
});
