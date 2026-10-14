import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPOINTMENT_STATUSES,
  appointmentStatusOccupiesSchedule,
  isAppointmentCancellationRequest,
  isAppointmentNotesUpdate,
  isAppointmentStatusUpdate,
  isCreateAppointmentRequest,
  isRescheduleAppointmentRequest,
} from '../src/services/appointmentRequest.js';

const validCreateRequest = {
  patientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  professionalId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  serviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  specialtyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  scheduledStart: '2026-10-01T10:00:00.000Z',
  scheduledEnd: '2026-10-01T10:30:00.000Z',
  notes: 'Initial consultation',
};

test('creation accepts only explicitly supported fields', () => {
  assert.equal(isCreateAppointmentRequest(validCreateRequest), true);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, clinic_id: 'clinic-2' }), false);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, id: 'appointment-2' }), false);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, created_at: '2026-10-01' }), false);
});

test('creation rejects missing identifiers and non-string client values', () => {
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, patientId: '' }), false);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, patientId: undefined }), false);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, patientId: 42 }), false);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, professionalId: 'professional-1' }), false);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, specialtyId: 'specialty-1' }), false);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, serviceId: undefined }), false);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, serviceId: 'service-1' }), false);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, service_id: validCreateRequest.serviceId }), false);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, price: 12.5 }), false);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, durationMinutes: 30 }), false);
  assert.equal(isCreateAppointmentRequest({ ...validCreateRequest, notes: { internal: true } }), false);
  assert.equal(isCreateAppointmentRequest(null), false);
  assert.equal(isCreateAppointmentRequest([]), false);
});

test('reschedule accepts only scheduling fields and rejects protected attributes', () => {
  const request = {
    professionalId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    specialtyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    scheduledStart: '2026-10-01T10:30:00.000Z',
    scheduledEnd: '2026-10-01T11:00:00.000Z',
  };
  assert.equal(isRescheduleAppointmentRequest(request), true);
  assert.equal(isRescheduleAppointmentRequest({ ...request, clinicId: 'clinic-2' }), false);
  assert.equal(isRescheduleAppointmentRequest({ ...request, status: 'cancelled' }), false);
  assert.equal(isRescheduleAppointmentRequest({ ...request, professionalId: 'bad-id' }), false);
});

test('generic update permits notes only', () => {
  assert.equal(isAppointmentNotesUpdate({ notes: 'Updated note' }), true);
  assert.equal(isAppointmentNotesUpdate({ notes: null }), true);
  assert.equal(isAppointmentNotesUpdate({}), false);
  assert.equal(isAppointmentNotesUpdate({ notes: 'x', clinic_id: 'clinic-2' }), false);
  assert.equal(isAppointmentNotesUpdate({ id: 'appointment-2' }), false);
  assert.equal(isAppointmentNotesUpdate({ notes: ['invalid'] }), false);
});

test('status update accepts exactly schema statuses and no other fields', () => {
  assert.deepEqual(APPOINTMENT_STATUSES, [
    'scheduled',
    'confirmed',
    'completed',
    'cancelled',
    'no_show',
    'rescheduled',
  ]);
  for (const status of APPOINTMENT_STATUSES) {
    assert.equal(isAppointmentStatusUpdate({ status }), true);
  }
  assert.equal(isAppointmentStatusUpdate({ status: 'pending' }), false);
  assert.equal(isAppointmentStatusUpdate({ status: 'scheduled', clinicId: 'clinic-2' }), false);
});

test('cancellation accepts an optional reason but rejects other fields', () => {
  assert.equal(isAppointmentCancellationRequest({}), true);
  assert.equal(isAppointmentCancellationRequest({ reason: 'Patient request' }), true);
  assert.equal(isAppointmentCancellationRequest({ reason: {}, status: 'scheduled' }), false);
});

test('only cancelled status releases an appointment slot', () => {
  for (const status of APPOINTMENT_STATUSES) {
    assert.equal(appointmentStatusOccupiesSchedule(status), status !== 'cancelled');
  }
});
