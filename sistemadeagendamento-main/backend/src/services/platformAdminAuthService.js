import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query, withTransaction } from '../db/index.js';
import { comparePassword } from '../utils/password.js';

export const PLATFORM_ADMIN_AUDIENCE = 'noa-connect-platform-admin';
const INVALID_CREDENTIALS = 'Credenciais inválidas.';

function invalidCredentialsError() {
  return Object.assign(new Error(INVALID_CREDENTIALS), { statusCode: 401 });
}

export async function writePlatformAudit(
  { platformAdminId = null, action, entityType = 'platform_admin', entityId = null, details = null, requestId = null },
  executor
) {
  const executeQuery = executor ? executor.query.bind(executor) : query;
  await executeQuery(
    `INSERT INTO platform_audit_logs
       (platform_admin_id, action, entity_type, entity_id, details, request_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      platformAdminId,
      action,
      entityType,
      entityId,
      details ? JSON.stringify(details) : null,
      requestId,
    ]
  );
}

export async function loginPlatformAdmin(
  { email, password, requestId },
  {
    queryExecutor = query,
    transactionExecutor = withTransaction,
    passwordComparator = comparePassword,
    auditLogger = writePlatformAudit,
  } = {}
) {
  const result = await queryExecutor(
    `SELECT id, email, name, password_hash, status, token_version
     FROM platform_admin_accounts
     WHERE email = LOWER($1)`,
    [email.trim()]
  );
  const account = result.rows[0];
  const passwordMatches = account
    ? await passwordComparator(password, account.password_hash)
    : false;

  if (!account || account.status !== 'active' || !passwordMatches) {
    await auditLogger({
      action: 'platform.auth.denied',
      details: { reason: 'invalid_credentials' },
      requestId,
    });
    throw invalidCredentialsError();
  }

  const activeAccount = await transactionExecutor(async (client) => {
    const updated = await client.query(
      `UPDATE platform_admin_accounts
       SET last_login_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'active'
       RETURNING id, email, name, token_version`,
      [account.id]
    );
    if (updated.rowCount === 0) throw invalidCredentialsError();

    await auditLogger({
      platformAdminId: account.id,
      action: 'platform.auth.login',
      requestId,
    }, client);
    return updated.rows[0];
  });

  const token = jwt.sign(
    { scope: 'platform_admin', sessionVersion: activeAccount.token_version },
    env.jwt.secret,
    {
      algorithm: 'HS256',
      audience: PLATFORM_ADMIN_AUDIENCE,
      expiresIn: env.jwt.expiresIn,
      issuer: env.jwt.issuer,
      subject: activeAccount.id,
    }
  );

  return {
    token,
    user: { id: activeAccount.id, email: activeAccount.email, name: activeAccount.name },
  };
}

export async function revokePlatformAdminSession(
  { platformAdminId, requestId },
  { transactionExecutor = withTransaction, auditLogger = writePlatformAudit } = {}
) {
  return transactionExecutor(async (client) => {
    const result = await client.query(
      `UPDATE platform_admin_accounts
       SET token_version = token_version + 1, updated_at = NOW()
       WHERE id = $1 AND status = 'active'
       RETURNING id`,
      [platformAdminId]
    );
    if (result.rowCount === 0) throw invalidCredentialsError();

    await auditLogger({
      platformAdminId,
      action: 'platform.auth.logout',
      requestId,
    }, client);
  });
}
