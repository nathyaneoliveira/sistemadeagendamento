import { isUuid } from '../routes/serviceValidation.js';

export const APPOINTMENT_STATUSES = Object.freeze([
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
]);

const CREATE_FIELDS = ['patientId', 'professionalId', 'specialtyId', 'serviceId', 'scheduledStart', 'scheduledEnd', 'notes'];
const RESCHEDULE_FIELDS = ['professionalId', 'specialtyId', 'serviceId', 'scheduledStart', 'scheduledEnd'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyFields(value, allowedFields) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowedFields.includes(key));
}

function isOptionalString(value) {
  return value === undefined || value === null || typeof value === 'string';
}

export function isCreateAppointmentRequest(body) {
  return hasOnlyFields(body, CREATE_FIELDS) &&
    isUuid(body.patientId) &&
    isUuid(body.professionalId) &&
    isUuid(body.serviceId) &&
    typeof body.scheduledStart === 'string' &&
    typeof body.scheduledEnd === 'string' &&
    (body.specialtyId === undefined || body.specialtyId === null || isUuid(body.specialtyId)) &&
    isOptionalString(body.notes);
}

export function isRescheduleAppointmentRequest(body) {
  return hasOnlyFields(body, RESCHEDULE_FIELDS) &&
    isUuid(body.professionalId) &&
    (body.serviceId === undefined || isUuid(body.serviceId)) &&
    typeof body.scheduledStart === 'string' &&
    typeof body.scheduledEnd === 'string' &&
    (body.specialtyId === undefined || body.specialtyId === null || isUuid(body.specialtyId));
}

export function isAppointmentNotesUpdate(body) {
  return hasOnlyFields(body, ['notes']) &&
    Object.prototype.hasOwnProperty.call(body, 'notes') &&
    isOptionalString(body.notes);
}

export function isAppointmentStatusUpdate(body) {
  return hasOnlyFields(body, ['status']) &&
    APPOINTMENT_STATUSES.includes(body.status);
}

export function isAppointmentCancellationRequest(body) {
  return body === undefined ||
    (hasOnlyFields(body, ['reason']) && isOptionalString(body.reason));
}

export function appointmentStatusOccupiesSchedule(status) {
  return typeof status === 'string' && status !== 'cancelled';
}
