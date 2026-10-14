import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../db/index.js';
import { PLATFORM_ADMIN_AUDIENCE, writePlatformAudit } from '../services/platformAdminAuthService.js';

export function createAuthenticatePlatformAdmin({
  queryExecutor = query,
  auditLogger = writePlatformAudit,
} = {}) {
  return async function authenticatePlatformAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
    const token = bearerMatch?.[1].trim();
    let decoded;

    try {
      decoded = token
        ? jwt.verify(token, env.jwt.secret, {
          algorithms: ['HS256'],
          audience: PLATFORM_ADMIN_AUDIENCE,
          issuer: env.jwt.issuer,
        })
        : null;
    } catch {
      decoded = null;
    }

    if (
      !decoded ||
      typeof decoded !== 'object' ||
      typeof decoded.sub !== 'string' ||
      decoded.scope !== 'platform_admin' ||
      !Number.isSafeInteger(decoded.sessionVersion) ||
      decoded.sessionVersion < 0
    ) {
      try {
        await auditLogger({
          action: 'platform.auth.denied',
          details: { reason: 'invalid_or_missing_token' },
          requestId: req.requestId,
        });
      } catch (error) {
        return next(error);
      }
      return res.status(401).json({ ok: false, message: 'Autenticação administrativa necessária.' });
    }

    try {
      const result = await queryExecutor(
        `SELECT id, email, name, status, token_version
         FROM platform_admin_accounts
         WHERE id = $1`,
        [decoded.sub]
      );
      const account = result.rows[0];
      if (
        !account ||
        account.status !== 'active' ||
        account.token_version !== decoded.sessionVersion
      ) {
        await auditLogger({
          action: 'platform.auth.denied',
          details: { reason: 'inactive_or_revoked_account' },
          requestId: req.requestId,
        });
        return res.status(401).json({ ok: false, message: 'Sessão administrativa inválida ou expirada.' });
      }

      req.platformAdmin = {
        id: account.id,
        email: account.email,
        name: account.name,
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const authenticatePlatformAdmin = createAuthenticatePlatformAdmin();
