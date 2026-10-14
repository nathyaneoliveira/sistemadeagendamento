import { isUuid } from './serviceValidation.js';

const MAX_PAYMENT_AMOUNT = 99_999_999.99;
const PAYMENT_MODES = ['before', 'after'];
const PAYMENT_STATUSES = ['pending', 'paid', 'cancelled', 'refunded'];
const PAYMENT_FIELDS = ['appointmentId', 'amount', 'currency', 'paymentMode', 'provider', 'status'];

function hasOnlyFields(body, fields) {
  return body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Object.keys(body).every((field) => fields.includes(field));
}

export function isValidPaymentAmount(amount) {
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > MAX_PAYMENT_AMOUNT
  ) {
    return false;
  }

  const [coefficient, exponentText] = amount.toString().toLowerCase().split('e');
  const fractionalDigits = coefficient.split('.')[1]?.length || 0;
  const exponent = exponentText ? Number(exponentText) : 0;
  return fractionalDigits - exponent <= 2;
}

function isOptionalValue(value, maxLength, allowedValues) {
  return value === undefined ||
    value === null ||
    value === '' ||
    (typeof value === 'string' &&
      Array.from(value).length <= maxLength &&
      !value.includes('\0') &&
      (allowedValues === undefined || allowedValues.includes(value)));
}

export function isCreatePaymentRequest(body) {
  return hasOnlyFields(body, PAYMENT_FIELDS) &&
    isUuid(body.appointmentId) &&
    isValidPaymentAmount(body.amount) &&
    isOptionalValue(body.currency, 3) &&
    isOptionalValue(body.provider, 50) &&
    isOptionalValue(body.paymentMode, 30, PAYMENT_MODES) &&
    isOptionalValue(body.status, 30, PAYMENT_STATUSES);
}

export function isPaymentStatusUpdate(body) {
  return hasOnlyFields(body, ['status']) &&
    body.status !== undefined &&
    body.status !== null &&
    PAYMENT_STATUSES.includes(body.status);
}
