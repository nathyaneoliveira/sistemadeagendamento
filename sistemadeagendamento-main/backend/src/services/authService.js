import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query, withTransaction } from '../db/index.js';
import { assertPlanResourceLimit } from './planAccess.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { assertValidNewPassword } from '../utils/passwordPolicy.js';

const CLINIC_SELECTION_AUDIENCE = 'sistema-de-agendamentos-clinic-selection';
const INVALID_CREDENTIALS = 'Credenciais inválidas.';

function invalidCredentialsError() {
  return Object.assign(new Error(INVALID_CREDENTIALS), { statusCode: 401 });
}

function createSessionSelectionToken(accounts) {
  return jwt.sign(
    { accounts: accounts.map(({ id, clinic_id: clinicId }) => ({ userId: id, clinicId })) },
    env.jwt.secret,
    {
      algorithm: 'HS256',
      audience: CLINIC_SELECTION_AUDIENCE,
      expiresIn: '5m',
      issuer: env.jwt.issuer,
    }
  );
}

function verifySessionSelectionToken(token) {
  try {
    const decoded = jwt.verify(token, env.jwt.secret, {
      algorithms: ['HS256'],
      audience: CLINIC_SELECTION_AUDIENCE,
      issuer: env.jwt.issuer,
    });
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      !Array.isArray(decoded.accounts) ||
      decoded.accounts.length < 2 ||
      decoded.accounts.some((account) =>
        !account ||
        typeof account.userId !== 'string' ||
        typeof account.clinicId !== 'string'
      )
    ) {
      throw invalidCredentialsError();
    }
    return decoded.accounts;
  } catch {
    throw invalidCredentialsError();
  }
}

async function createUserSession(user, queryExecutor) {
  const loginUpdate = await queryExecutor(
    `UPDATE users
     SET last_login_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND clinic_id = $2 AND status = 'active'
     RETURNING id, clinic_id, name, email, role, token_version`,
    [user.id, user.clinic_id]
  );

  if (loginUpdate.rowCount === 0) {
    throw invalidCredentialsError();
  }

  const activeUser = loginUpdate.rows[0];
  const token = jwt.sign(
    {
      clinicId: activeUser.clinic_id,
      sessionVersion: activeUser.token_version,
    },
    env.jwt.secret,
    {
      algorithm: 'HS256',
      audience: env.jwt.audience,
      expiresIn: env.jwt.expiresIn,
      issuer: env.jwt.issuer,
      subject: activeUser.id,
    }
  );

  return {
    token,
    user: {
      id: activeUser.id,
      clinicId: activeUser.clinic_id,
      name: activeUser.name,
      email: activeUser.email,
      role: activeUser.role,
      clinic_timezone: user.clinic_timezone,
    },
  };
}

export async function loginUser(
  { email, password },
  { queryExecutor = query, passwordComparator = comparePassword } = {}
) {
  const result = await queryExecutor(
    `SELECT users.id, users.clinic_id, users.name, users.email, users.password_hash, users.role, users.status,
            clinics.name AS clinic_name, clinics.trade_name AS clinic_trade_name,
            COALESCE((
              SELECT timezone FROM clinic_configurations
              WHERE clinic_id = users.clinic_id
            ), 'UTC') AS clinic_timezone
     FROM users
     JOIN clinics ON clinics.id = users.clinic_id
     WHERE LOWER(users.email) = LOWER($1)
     ORDER BY users.clinic_id, users.id`,
    [email.trim()]
  );

  const matchingAccounts = [];
  for (const account of result.rows) {
    if (await passwordComparator(password, account.password_hash)) {
      if (account.status === 'active') matchingAccounts.push(account);
    }
  }

  if (matchingAccounts.length === 0) {
    throw invalidCredentialsError();
  }

  const accountsByClinic = new Map();
  for (const account of matchingAccounts) {
    const accounts = accountsByClinic.get(account.clinic_id) || [];
    accounts.push(account);
    accountsByClinic.set(account.clinic_id, accounts);
  }

  if ([...accountsByClinic.values()].some((accounts) => accounts.length > 1)) {
    throw invalidCredentialsError();
  }

  if (matchingAccounts.length > 1) {
    return {
      requiresClinicSelection: true,
      selectionToken: createSessionSelectionToken(matchingAccounts),
      clinics: matchingAccounts.map((account) => ({
        clinicId: account.clinic_id,
        name: account.clinic_trade_name || account.clinic_name,
      })),
    };
  }

  return createUserSession(matchingAccounts[0], queryExecutor);
}

export async function selectLoginClinic(
  { selectionToken, clinicId },
  { queryExecutor = query } = {}
) {
  const accounts = verifySessionSelectionToken(selectionToken);
  const selectedAccount = accounts.find((account) => account.clinicId === clinicId);

  if (!selectedAccount) throw invalidCredentialsError();

  const result = await queryExecutor(
    `SELECT id, clinic_id, name, email, role, status, token_version,
            COALESCE((
              SELECT timezone FROM clinic_configurations
              WHERE clinic_id = users.clinic_id
            ), 'UTC') AS clinic_timezone
     FROM users
     WHERE id = $1 AND clinic_id = $2 AND status = 'active'`,
    [selectedAccount.userId, selectedAccount.clinicId]
  );

  if (result.rowCount === 0) throw invalidCredentialsError();
  return createUserSession(result.rows[0], queryExecutor);
}

export async function createUserAccount({
  clinicId,
  name,
  email,
  password,
  role,
  phone,
}, { transactionExecutor = withTransaction, checkPlanLimit = assertPlanResourceLimit } = {}) {
  assertValidNewPassword(password);
  const passwordHash = await hashPassword(password);

  return transactionExecutor(async (client) => {
    if (['admin', 'reception'].includes(role)) {
      await checkPlanLimit(client, clinicId, 'users');
    }

    const existingUser = await client.query(
      'SELECT id FROM users WHERE clinic_id = $1 AND LOWER(email) = LOWER($2)',
      [clinicId, email]
    );

    if (existingUser.rowCount > 0) {
      throw Object.assign(new Error('Usuário já cadastrado nesta clínica.'), { statusCode: 409 });
    }

    const inserted = await client.query(
      `INSERT INTO users (clinic_id, name, email, password_hash, phone, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING id, clinic_id, name, email, phone, role`,
      [clinicId, name, email, passwordHash, phone, role]
    );

    return inserted.rows[0];
  });
}
