import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../db/index.js';

export function createAuthenticateToken({ queryExecutor = query } = {}) {
  return async function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
    const token = bearerMatch?.[1].trim();

    if (!token) {
      return res.status(401).json({ ok: false, message: 'Token ausente.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, env.jwt.secret, {
        algorithms: ['HS256'],
        audience: env.jwt.audience,
        issuer: env.jwt.issuer,
      });
    } catch (error) {
      return res.status(401).json({ ok: false, message: 'Token inválido ou expirado.' });
    }

    if (
      !decoded ||
      typeof decoded !== 'object' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.clinicId !== 'string' ||
      !Number.isSafeInteger(decoded.sessionVersion) ||
      decoded.sessionVersion < 0
    ) {
      return res.status(401).json({ ok: false, message: 'Token inválido ou expirado.' });
    }

    try {
      const result = await queryExecutor(
        `SELECT id, clinic_id, name, email, role, status, token_version,
                COALESCE((
                  SELECT timezone FROM clinic_configurations
                  WHERE clinic_id = users.clinic_id
                ), 'UTC') AS clinic_timezone
         FROM users
         WHERE id = $1 AND clinic_id = $2`,
        [decoded.sub, decoded.clinicId]
      );

      if (result.rowCount === 0) {
        return res.status(401).json({ ok: false, message: 'Sessão inválida.' });
      }

      const user = result.rows[0];
      if (user.status !== 'active' || user.token_version !== decoded.sessionVersion) {
        return res.status(401).json({ ok: false, message: 'Sessão inválida ou revogada.' });
      }

      req.user = {
        sub: user.id,
        userId: user.id,
        clinicId: user.clinic_id,
        name: user.name,
        email: user.email,
        role: user.role,
        sessionVersion: user.token_version,
        clinicTimezone: user.clinic_timezone,
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const authenticateToken = createAuthenticateToken();

export function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: 'Não autenticado.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, message: 'Você não tem permissão para esta ação.' });
    }

    return next();
  };
}

export async function requireClinicAccess(req, res, next) {
  const userClinicId = req.user?.clinicId;
  const requestedClinicId = req.params.clinicId || req.body?.clinicId;

  if (!userClinicId) {
    return res.status(401).json({ ok: false, message: 'Clínica não identificada no token.' });
  }

  if (requestedClinicId && requestedClinicId !== userClinicId) {
    return res.status(403).json({ ok: false, message: 'Você não pode acessar registros de outra clínica.' });
  }

  req.clinicId = userClinicId;
  return next();
}

export async function requireUserInClinic(req, res, next) {
  const { clinicId, userId } = req.user || {};

  if (!clinicId || !userId) {
    return res.status(401).json({ ok: false, message: 'Sessão inválida.' });
  }

  try {
    const result = await query(
      `SELECT id, clinic_id, role, status, token_version
       FROM users
       WHERE id = $1 AND clinic_id = $2`,
      [userId, clinicId]
    );

    if (
      result.rowCount === 0 ||
      result.rows[0].status !== 'active' ||
      result.rows[0].token_version !== req.user.sessionVersion
    ) {
      return res.status(403).json({ ok: false, message: 'Sessão inválida ou revogada.' });
    }

    req.user = {
      ...req.user,
      role: result.rows[0].role,
      clinicId: result.rows[0].clinic_id,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}
