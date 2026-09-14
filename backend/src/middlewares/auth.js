import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../db/index.js';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ ok: false, message: 'Token ausente.' });
  }

  try {
    const decoded = jwt.verify(token, env.jwt.secret);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ ok: false, message: 'Token inválido ou expirado.' });
  }
}

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
  const requestedClinicId = req.params.clinicId || req.body.clinicId;

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

  const result = await query(
    'SELECT id, clinic_id, role FROM users WHERE id = $1 AND clinic_id = $2',
    [userId, clinicId]
  );

  if (result.rowCount === 0) {
    return res.status(403).json({ ok: false, message: 'Usuário não pertence à clínica da sessão.' });
  }

  req.user = {
    ...req.user,
    role: result.rows[0].role,
    clinicId: result.rows[0].clinic_id,
  };

  return next();
}
