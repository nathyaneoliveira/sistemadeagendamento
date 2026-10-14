const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SETTINGS_FIELDS = [
  'name',
  'logoUrl',
  'phone',
  'whatsapp',
  'addressLine1',
  'addressLine2',
  'email',
  'openingHours',
  'serviceInfo',
  'timezone',
  'publicSlug',
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOptionalText(value, maxLength = Infinity) {
  return value === undefined ||
    value === null ||
    (typeof value === 'string' &&
      Array.from(value).length <= maxLength &&
      !value.includes('\0'));
}

export function isClinicSettingsRequest(body) {
  if (
    !isPlainObject(body) ||
    Object.keys(body).some((field) => !SETTINGS_FIELDS.includes(field))
  ) {
    return false;
  }

  const emailIsValid = body.email === undefined ||
    body.email === null ||
    body.email === '' ||
    (typeof body.email === 'string' &&
      Array.from(body.email).length <= 255 &&
      EMAIL_PATTERN.test(body.email.trim()));

  return hasOptionalText(body.name, 200) &&
    hasOptionalText(body.logoUrl) &&
    hasOptionalText(body.phone, 20) &&
    hasOptionalText(body.whatsapp, 20) &&
    hasOptionalText(body.addressLine1, 255) &&
    hasOptionalText(body.addressLine2, 255) &&
    emailIsValid &&
    (body.openingHours === undefined || body.openingHours === null ||
      typeof body.openingHours === 'object') &&
    hasOptionalText(body.serviceInfo) &&
    (body.timezone === undefined || typeof body.timezone === 'string') &&
    (body.publicSlug === undefined || body.publicSlug === null || typeof body.publicSlug === 'string');
}
