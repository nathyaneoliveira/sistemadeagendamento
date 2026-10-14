const MAX_SERVICE_PRICE = 99_999_999.99;
const MAX_SERVICE_DURATION_MINUTES = 1440;
const SERVICE_FIELDS = ['name', 'description', 'durationMinutes', 'price'];
const CREATE_SERVICE_FIELDS = [...SERVICE_FIELDS, 'professionalIds'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyFields(value, fields) {
  return isPlainObject(value) && Object.keys(value).every((field) => fields.includes(field));
}

function hasOwn(value, property) {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function hasValidName(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 200;
}

function hasValidDescription(value) {
  return value === undefined || value === null ||
    (typeof value === 'string' && value.length <= 2000);
}

export function isValidServicePrice(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_SERVICE_PRICE) {
    return false;
  }

  const [coefficient, exponentText] = value.toString().toLowerCase().split('e');
  const fractionalDigits = coefficient.split('.')[1]?.length || 0;
  const exponent = exponentText ? Number(exponentText) : 0;
  return fractionalDigits - exponent <= 2;
}

function hasValidDuration(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_SERVICE_DURATION_MINUTES;
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isCreateServiceRequest(body) {
  return hasOnlyFields(body, CREATE_SERVICE_FIELDS) &&
    hasValidName(body.name) &&
    hasValidDescription(body.description) &&
    hasValidDuration(body.durationMinutes) &&
    isValidServicePrice(body.price) &&
    (body.professionalIds === undefined || isProfessionalServiceAssignmentRequest({ professionalIds: body.professionalIds }));
}

export function isUpdateServiceRequest(body) {
  if (!hasOnlyFields(body, CREATE_SERVICE_FIELDS) || Object.keys(body).length === 0) {
    return false;
  }

  return (!hasOwn(body, 'name') || hasValidName(body.name)) &&
    (!hasOwn(body, 'description') || hasValidDescription(body.description)) &&
    (!hasOwn(body, 'durationMinutes') || hasValidDuration(body.durationMinutes)) &&
    (!hasOwn(body, 'price') || isValidServicePrice(body.price)) &&
    (!hasOwn(body, 'professionalIds') ||
      isProfessionalServiceAssignmentRequest({ professionalIds: body.professionalIds }));
}

export function isServiceStatusRequest(body) {
  return hasOnlyFields(body, ['isActive']) && typeof body.isActive === 'boolean';
}

export function isProfessionalServiceAssignmentRequest(body) {
  return hasOnlyFields(body, ['professionalIds']) &&
    Array.isArray(body.professionalIds) &&
    body.professionalIds.every(isUuid) &&
    new Set(body.professionalIds).size === body.professionalIds.length;
}

export function hasExpectedAppointmentDuration(start, end, durationMinutes) {
  if (
    typeof start !== 'string' ||
    typeof end !== 'string' ||
    !Number.isSafeInteger(durationMinutes) ||
    durationMinutes < 1 ||
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end))
  ) {
    return false;
  }

  return Date.parse(end) - Date.parse(start) === durationMinutes * 60_000;
}
