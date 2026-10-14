import { isUuid } from './serviceValidation.js';

const PROFESSIONAL_STATUSES = new Set(['active', 'inactive']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasValidName(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    Array.from(value).length <= 200 &&
    !value.includes('\0');
}

function hasOptionalText(value, maxLength) {
  return value === undefined ||
    value === null ||
    (typeof value === 'string' &&
      Array.from(value).length <= maxLength &&
      !value.includes('\0'));
}

function hasOptionalProfessionalId(value) {
  return value === undefined ||
    value === null ||
    value === '' ||
    isUuid(value);
}

function hasOptionalStatus(value) {
  return value === undefined || PROFESSIONAL_STATUSES.has(value);
}

export function isCreateProfessionalRequest(body) {
  return isPlainObject(body) &&
    hasValidName(body.name) &&
    isUuid(body.specialtyId) &&
    hasOptionalProfessionalId(body.userId) &&
    hasOptionalText(body.crm, 50) &&
    hasOptionalText(body.phone, 20) &&
    hasOptionalStatus(body.status);
}

export function isUpdateProfessionalRequest(body) {
  if (
    !isPlainObject(body) ||
    !Object.values(body).some(Boolean)
  ) {
    return false;
  }

  return (body.name === undefined || body.name === null || typeof body.name === 'string') &&
    (body.name === undefined || body.name === null || Array.from(body.name).length <= 200) &&
    (body.name === undefined || body.name === null || !body.name.includes('\0')) &&
    hasOptionalProfessionalId(body.specialtyId) &&
    hasOptionalText(body.crm, 50) &&
    hasOptionalText(body.phone, 20) &&
    hasOptionalStatus(body.status);
}
