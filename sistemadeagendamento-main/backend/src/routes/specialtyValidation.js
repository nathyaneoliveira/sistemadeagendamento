import { isUuid } from './serviceValidation.js';

const SPECIALTY_FIELDS = ['name', 'description', 'status'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyFields(value) {
  return isPlainObject(value) && Object.keys(value).every((field) => SPECIALTY_FIELDS.includes(field));
}

function hasValidName(value) {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    !value.includes('\0') &&
    Array.from(value).length <= 200;
}

function hasOptionalDescription(value) {
  return value === undefined || value === null ||
    (typeof value === 'string' && !value.includes('\0'));
}

function hasOptionalStatus(value) {
  return value === undefined || value === null ||
    (typeof value === 'string' && !value.includes('\0') && Array.from(value).length <= 20);
}

export function isCreateSpecialtyRequest(body) {
  return hasOnlyFields(body) &&
    hasValidName(body.name) &&
    hasOptionalDescription(body.description) &&
    hasOptionalStatus(body.status);
}

export function isUpdateSpecialtyRequest(body) {
  return hasOnlyFields(body) &&
    Object.keys(body).length > 0 &&
    (!Object.prototype.hasOwnProperty.call(body, 'name') || hasValidName(body.name)) &&
    hasOptionalDescription(body.description) &&
    hasOptionalStatus(body.status);
}

export { isUuid };
