import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicAppointmentRequest, isPublicClinicSlug } from '../src/routes/publicBookingValidation.js';

const validRequest = {
  idempotencyKey: '99999999-9999-4999-8999-999999999999',
  serviceId: '44444444-4444-4444-8444-444444444444',
  professionalId: '22222222-2222-4222-8222-222222222222',
  scheduledStart: '2026-10-07T08:00:00.000Z',
  name: 'Cliente Exemplo',
  phone: '+55 (11) 98765-4321',
  email: 'cliente@example.invalid',
};

test('public clinic slug only accepts lower-case URL-safe identifiers', () => {
  assert.equal(isPublicClinicSlug('minha-clinica-2'), true);
  for (const slug of ['ab', 'Clinic', 'clinic/name', 'a--b', '-clinic', 'clinic-', '']) {
    assert.equal(isPublicClinicSlug(slug), false, `rejected slug: ${slug}`);
  }
});

test('public booking accepts the minimum supported contact and booking fields', () => {
  assert.equal(isPublicAppointmentRequest(validRequest), true);
  assert.equal(isPublicAppointmentRequest({ ...validRequest, email: undefined }), true);
});

test('public booking rejects missing, malformed, and mass-assignment fields', () => {
  assert.equal(isPublicAppointmentRequest({ ...validRequest, name: '' }), false);
  assert.equal(isPublicAppointmentRequest({ ...validRequest, phone: '123' }), false);
  assert.equal(isPublicAppointmentRequest({ ...validRequest, scheduledStart: 'tomorrow' }), false);
  assert.equal(isPublicAppointmentRequest({ ...validRequest, serviceId: 'not-a-uuid' }), false);
  assert.equal(isPublicAppointmentRequest({ ...validRequest, clinicId: 'foreign-clinic' }), false);
  assert.equal(isPublicAppointmentRequest({ ...validRequest, price: 1 }), false);
  assert.equal(isPublicAppointmentRequest({ ...validRequest, durationMinutes: 60 }), false);
  assert.equal(isPublicAppointmentRequest({ ...validRequest, notes: 'internal note' }), false);
});

test('public booking limits fields and validates optional email', () => {
  assert.equal(isPublicAppointmentRequest({ ...validRequest, email: 'invalid-email' }), false);
  assert.equal(isPublicAppointmentRequest({ ...validRequest, name: 'A'.repeat(201) }), false);
  assert.equal(isPublicAppointmentRequest({ ...validRequest, phone: '+12345678<script>' }), false);
});
