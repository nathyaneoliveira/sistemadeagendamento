import { isUuid } from './serviceValidation.js';

const CREATE_FIELDS = ['name', 'cpf', 'birthDate', 'phone', 'email', 'userId', 'status'];
const UPDATE_FIELDS = ['name', 'cpf', 'birthDate', 'phone', 'email', 'status'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyFields(value, fields) {
  return isPlainObject(value) && Object.keys(value).every((field) => fields.includes(field));
}

function hasOptionalText(value, maxLength) {
  return value === undefined ||
    value === null ||
    (typeof value === 'string' && Array.from(value).length <= maxLength);
}

function hasValidName(value) {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    Array.from(value).length <= 200;
}

function hasOptionalBirthDate(value) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function hasValidPatientFields(body) {
  return hasOptionalText(body.cpf, 14) &&
    hasOptionalBirthDate(body.birthDate) &&
    hasOptionalText(body.phone, 20) &&
    hasOptionalText(body.email, 255) &&
    hasOptionalText(body.status, 20);
}

export function isCreatePatientRequest(body) {
  return hasOnlyFields(body, CREATE_FIELDS) &&
    hasValidName(body.name) &&
    hasValidPatientFields(body) &&
    (body.userId === undefined ||
      body.userId === null ||
      body.userId === '' ||
      isUuid(body.userId));
}

export function isUpdatePatientRequest(body) {
  return hasOnlyFields(body, UPDATE_FIELDS) &&
    Object.keys(body).length > 0 &&
    Object.values(body).some(Boolean) &&
    (!Object.prototype.hasOwnProperty.call(body, 'name') || hasOptionalText(body.name, 200)) &&
    hasValidPatientFields(body);
}
