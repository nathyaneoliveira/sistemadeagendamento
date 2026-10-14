import { isUuid } from './serviceValidation.js';

const PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PHONE_CHARACTERS_PATTERN = /^[+()\d.\s-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i;
const BOOKING_FIELDS = [
  'idempotencyKey',
  'serviceId',
  'professionalId',
  'scheduledStart',
  'name',
  'phone',
  'email',
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isPublicClinicSlug(value) {
  return typeof value === 'string' &&
    value.length >= 3 &&
    value.length <= 63 &&
    PUBLIC_SLUG_PATTERN.test(value);
}

export function normalizePublicPhone(value) {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

export function isPublicAppointmentRequest(body) {
  if (
    !isPlainObject(body) ||
    Object.keys(body).some((field) => !BOOKING_FIELDS.includes(field)) ||
    !isUuid(body.idempotencyKey) ||
    !isUuid(body.serviceId) ||
    !isUuid(body.professionalId) ||
    typeof body.scheduledStart !== 'string' ||
    !ISO_TIMESTAMP_PATTERN.test(body.scheduledStart) ||
    !Number.isFinite(Date.parse(body.scheduledStart)) ||
    typeof body.name !== 'string' ||
    body.name.trim().length < 2 ||
    body.name.trim().length > 200 ||
    /[\u0000-\u001f\u007f]/.test(body.name) ||
    typeof body.phone !== 'string' ||
    body.phone.length > 20 ||
    !PHONE_CHARACTERS_PATTERN.test(body.phone) ||
    normalizePublicPhone(body.phone).length < 8 ||
    normalizePublicPhone(body.phone).length > 15
  ) {
    return false;
  }

  if (body.email !== undefined && body.email !== null && body.email !== '') {
    return typeof body.email === 'string' &&
      body.email.length <= 254 &&
      EMAIL_PATTERN.test(body.email.trim());
  }

  return body.email === undefined || body.email === null || body.email === '';
}
