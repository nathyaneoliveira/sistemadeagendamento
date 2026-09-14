import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';

const router = Router();

router.use(authenticateToken);
router.use(requireClinicAccess);

router.get('/', async (req, res, next) => {
  try {
    const { role } = req.user;
    let queryText = 'SELECT * FROM patients WHERE clinic_id = $1';
    const values = [req.clinicId];

    if (role === 'patient') {
      queryText += ' AND user_id = $2';
      values.push(req.user.userId);
    }

    queryText += ' ORDER BY created_at DESC';

    const result = await query(queryText, values);
    return res.status(200).json({ ok: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { name, cpf, birthDate, phone, email, userId, status } = req.body;

    if (!name) {
      return res.status(400).json({ ok: false, message: 'Nome é obrigatório.' });
    }

    const result = await query(
      `INSERT INTO patients (clinic_id, user_id, name, cpf, birth_date, phone, email, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.clinicId, userId || null, name, cpf || null, birthDate || null, phone || null, email || null, status || 'active']
    );

    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { role } = req.user;
    let queryText = 'SELECT * FROM patients WHERE id = $1 AND clinic_id = $2';
    const values = [req.params.id, req.clinicId];

    if (role === 'patient') {
      queryText += ' AND user_id = $3';
      values.push(req.user.userId);
    }

    const result = await query(queryText, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Paciente não encontrado.' });
    }

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { name, cpf, birthDate, phone, email, status } = req.body;

    if (!name && !cpf && !birthDate && !phone && !email && !status) {
      return res.status(400).json({ ok: false, message: 'Nenhum dado informado para atualização.' });
    }

    const result = await query(
      `UPDATE patients
       SET name = COALESCE($3, name), cpf = COALESCE($4, cpf), birth_date = COALESCE($5, birth_date),
           phone = COALESCE($6, phone), email = COALESCE($7, email), status = COALESCE($8, status), updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      [req.params.id, req.clinicId, name || null, cpf || null, birthDate || null, phone || null, email || null, status || null]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Paciente não encontrado.' });
    }

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
