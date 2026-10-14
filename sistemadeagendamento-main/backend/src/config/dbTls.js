import { readFileSync } from 'node:fs';

function parseDbSsl(value) {
  if (value === undefined) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === 'true' || normalizedValue === '1') {
    return true;
  }

  if (normalizedValue === 'false' || normalizedValue === '0') {
    return false;
  }

  throw new Error('DB_SSL must be set to true, 1, false, or 0.');
}

export function buildDatabaseSslOptions({
  nodeEnv,
  sslValue,
  caPath,
  readCaFile = (path) => readFileSync(path, 'utf8'),
}) {
  const sslEnabled = parseDbSsl(sslValue);

  if (nodeEnv === 'production' && !sslEnabled) {
    throw new Error('DB_SSL must be enabled in production.');
  }

  if (!sslEnabled) {
    if (caPath) {
      throw new Error('DB_SSL_CA_PATH requires DB_SSL to be enabled.');
    }
    return undefined;
  }

  const sslOptions = { rejectUnauthorized: true };

  if (caPath) {
    let ca;

    try {
      ca = readCaFile(caPath);
    } catch {
      throw new Error('DB_SSL_CA_PATH must point to a readable CA certificate file.');
    }

    if (typeof ca !== 'string' || !ca.trim()) {
      throw new Error('DB_SSL_CA_PATH must point to a readable CA certificate file.');
    }

    sslOptions.ca = ca;
  }

  return sslOptions;
}
