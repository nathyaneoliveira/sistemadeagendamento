import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.js';
import { createUserAccount, loginUser } from '../services/authService.js';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { clinicId, email, password } = req.body;

    if (!clinicId || !email || !password) {
      return res.status(400).json({ ok: false, message: 'clinicId, email e password são obrigatórios.' });
    }

    const result = await loginUser({ clinicId, email, password });
    return res.status(200).json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/register', authenticateToken, authorizeRoles('admin'), async (req, res, next) => {
  try {
    const { name, email, password, role, phone } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ ok: false, message: 'name, email, password e role são obrigatórios.' });
    }

    const allowedRoles = ['admin', 'reception', 'professional', 'patient'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ ok: false, message: 'Role inválida.' });
    }

    const user = await createUserAccount({
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
});

router.get('/me', authenticateToken, async (req, res) => {
  const result = await query(
    `SELECT id, clinic_id, name, email, role, phone, status, last_login_at
     FROM users
     WHERE id = $1 AND clinic_id = $2`,
    [req.user.userId, req.user.clinicId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ ok: false, message: 'Usuário não encontrado.' });
  }

  return res.status(200).json({ ok: true, data: result.rows[0] });
});

router.post('/logout', authenticateToken, (req, res) => {
  return res.status(200).json({ ok: true, message: 'Logout realizado com sucesso.' });
});

export default router;
