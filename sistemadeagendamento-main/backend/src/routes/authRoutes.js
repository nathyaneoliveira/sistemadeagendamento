import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.js';
import { createUserAccount, loginUser, selectLoginClinic } from '../services/authService.js';
import { requirePlanCapability } from '../services/planAccess.js';
import { isValidNewPassword, MAX_PASSWORD_INPUT_LENGTH } from '../utils/passwordPolicy.js';

export function createAuthRouter({
  authenticate = authenticateToken,
  login = loginUser,
  selectClinic = selectLoginClinic,
  createAccount = createUserAccount,
  queryExecutor = query,
  requireUserManagement = requirePlanCapability('userManagement'),
} = {}) {
  const router = Router();

  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = req.body || {};

      if (
        typeof email !== 'string' ||
        !email.trim() ||
        email.length > 255 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== 'string' ||
        password.length === 0 ||
        password.length > MAX_PASSWORD_INPUT_LENGTH
      ) {
        return res.status(400).json({ ok: false, message: 'Informe um e-mail e uma senha válidos.' });
      }

      const result = await login({ email, password });
      return res.status(200).json({ ok: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/login/select-clinic', async (req, res, next) => {
    try {
      const { selectionToken, clinicId } = req.body || {};
      if (
        typeof selectionToken !== 'string' ||
        !selectionToken ||
        typeof clinicId !== 'string' ||
        !clinicId
      ) {
        return res.status(400).json({ ok: false, message: 'Seleção de clínica inválida.' });
      }

      const result = await selectClinic({ selectionToken, clinicId });
      return res.status(200).json({ ok: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    '/register',
    authenticate,
    authorizeRoles('admin'),
    requireUserManagement,
    async (req, res, next) => {
      try {
        const { name, email, password, role, phone } = req.body;

        if (
          typeof name !== 'string' ||
          !name.trim() ||
          typeof email !== 'string' ||
          !email.trim() ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
          typeof role !== 'string'
        ) {
          return res.status(400).json({ ok: false, message: 'Dados de cadastro inválidos.' });
        }

        if (!isValidNewPassword(password)) {
          return res.status(400).json({
            ok: false,
            message: 'A senha deve conter ao menos 12 caracteres e no máximo 72 bytes em UTF-8.',
          });
        }

        const allowedRoles = ['admin', 'reception', 'professional', 'patient'];
        if (!allowedRoles.includes(role)) {
          return res.status(400).json({ ok: false, message: 'Role inválida.' });
        }

        const user = await createAccount({
          clinicId: req.user.clinicId,
          name,
          email,
          password,
          role,
          phone,
        });

        return res.status(201).json({ ok: true, data: user });
      } catch (error) {
        return next(error);
      }
    }
  );

  router.get('/me', authenticate, async (req, res, next) => {
    try {
      const result = await queryExecutor(
        `SELECT id, clinic_id, name, email, role, phone, status, last_login_at,
                $3::text AS clinic_timezone
         FROM users
         WHERE id = $1 AND clinic_id = $2`,
        [req.user.userId, req.user.clinicId, req.user.clinicTimezone]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, message: 'Usuário não encontrado.' });
      }

      return res.status(200).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/logout', authenticate, async (req, res, next) => {
    try {
      await queryExecutor(
        `UPDATE users
         SET token_version = token_version + 1, updated_at = NOW()
         WHERE id = $1 AND clinic_id = $2`,
        [req.user.userId, req.user.clinicId]
      );

      return res.status(200).json({ ok: true, message: 'Logout realizado com sucesso.' });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

const router = createAuthRouter();
export default router;
