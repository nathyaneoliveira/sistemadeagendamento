import { buildDatabaseSslOptions } from './dbTls.js';

const DEVELOPMENT_DEFAULTS = {
  port: 4000,
  dbHost: 'localhost',
  dbPort: 5432,
  dbName: 'clinic_db',
  dbUser: 'clinic_user',
  dbPassword: 'clinic_password',
  corsOrigin: 'http://localhost:5173',
};

function requiredProductionValue(source, name, { preserveWhitespace = false } = {}) {
  const rawValue = source[name];
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    throw new Error(`${name} must be configured in production.`);
  }
  return preserveWhitespace ? rawValue : rawValue.trim();
}

function parsePort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

function isLocalDatabaseHost(host) {
  const normalizedHost = host.trim().toLowerCase();
  return normalizedHost === 'localhost' ||
    normalizedHost === '::1' ||
    normalizedHost === '0:0:0:0:0:0:0:1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalizedHost);
}

function validateProductionCorsOrigin(origin) {
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new Error('CORS_ORIGIN must be a valid HTTPS origin in production.');
  }

  if (
    parsedOrigin.protocol !== 'https:' ||
    parsedOrigin.origin !== origin ||
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.hostname === 'localhost' ||
    parsedOrigin.hostname === '::1' ||
    parsedOrigin.hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(parsedOrigin.hostname)
  ) {
    throw new Error('CORS_ORIGIN must be a valid HTTPS origin in production.');
  }
}

export function buildRuntimeConfig(source, { readCaFile } = {}) {
  const requestedNodeEnv = source.NODE_ENV?.trim().toLowerCase();
  const resolvedNodeEnv = requestedNodeEnv || 'test';

  if (requestedNodeEnv && !['development', 'test', 'production'].includes(requestedNodeEnv)) {
    throw new Error('NODE_ENV must be explicitly set to development, test, or production.');
  }

  const isProduction = resolvedNodeEnv === 'production';
  const jwtSecret = source.JWT_SECRET || (isProduction ? undefined : 'development-test-default-secret-32-bytes');
  if (!jwtSecret || Buffer.byteLength(jwtSecret, 'utf8') < 32 || jwtSecret.trim() !== jwtSecret) {
    throw new Error('JWT_SECRET must contain at least 32 bytes and have no surrounding whitespace.');
  }

  const port = isProduction
    ? parsePort(requiredProductionValue(source, 'PORT'), 'PORT')
    : parsePort(source.PORT || DEVELOPMENT_DEFAULTS.port, 'PORT');

  const db = isProduction
    ? {
        host: requiredProductionValue(source, 'DB_HOST'),
        port: parsePort(requiredProductionValue(source, 'DB_PORT'), 'DB_PORT'),
        name: requiredProductionValue(source, 'DB_NAME'),
        user: requiredProductionValue(source, 'DB_USER'),
        password: requiredProductionValue(source, 'DB_PASSWORD', { preserveWhitespace: true }),
      }
    : {
        host: source.DB_HOST || DEVELOPMENT_DEFAULTS.dbHost,
        port: parsePort(source.DB_PORT || DEVELOPMENT_DEFAULTS.dbPort, 'DB_PORT'),
        name: source.DB_NAME || DEVELOPMENT_DEFAULTS.dbName,
        user: source.DB_USER || DEVELOPMENT_DEFAULTS.dbUser,
        password: source.DB_PASSWORD || DEVELOPMENT_DEFAULTS.dbPassword,
      };

  if (isProduction) {
    if (isLocalDatabaseHost(db.host)) {
      throw new Error('DB_HOST must not point to a loopback address in production.');
    }
    if (db.name === DEVELOPMENT_DEFAULTS.dbName || db.user === DEVELOPMENT_DEFAULTS.dbUser ||
        db.password === DEVELOPMENT_DEFAULTS.dbPassword) {
      throw new Error('Development database defaults are not allowed in production.');
    }
  }

  const corsOrigin = isProduction
    ? requiredProductionValue(source, 'CORS_ORIGIN')
    : source.CORS_ORIGIN || DEVELOPMENT_DEFAULTS.corsOrigin;

  if (isProduction) {
    validateProductionCorsOrigin(corsOrigin);
  }

  const sslOptions = buildDatabaseSslOptions({
    nodeEnv: resolvedNodeEnv,
    sslValue: source.DB_SSL,
    caPath: source.DB_SSL_CA_PATH || undefined,
    ...(readCaFile ? { readCaFile } : {}),
  });

  return {
    nodeEnv: resolvedNodeEnv,
    port,
    db: { ...db, ssl: sslOptions },
    jwt: {
      secret: jwtSecret,
      expiresIn: source.JWT_EXPIRES_IN || '8h',
      issuer: 'sistema-de-agendamentos-api',
      audience: 'sistema-de-agendamentos-client',
    },
    corsOrigin,
  };
}
