export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_BYTES = 72;
export const MAX_PASSWORD_INPUT_LENGTH = 1024;

export function isValidNewPassword(password) {
  return typeof password === 'string' &&
    Array.from(password).length >= MIN_PASSWORD_LENGTH &&
    Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES;
}

export function assertValidNewPassword(password) {
  if (!isValidNewPassword(password)) {
    throw Object.assign(
      new Error('A senha deve conter ao menos 12 caracteres e no máximo 72 bytes em UTF-8.'),
      { statusCode: 400 }
    );
  }
}
