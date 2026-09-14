import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';

const router = Router();

router.use(authenticateToken);
router.use(requireClinicAccess);

router.get('/', async (req, res, next) => {
  try {
    const { role } = req.user;
    let queryText = `
      SELECT p.*, s.name AS specialty_name
      FROM professionals p
      LEFT JOIN specialties s ON s.id = p.specialty_id
      WHERE p.clinic_id = $1
    `;
    const values = [req.clinicId];

    if (role === 'professional') {
      queryText += ' AND p.user_id = $2';
      values.push(req.user.userId);
    }

    queryText += ' ORDER BY p.name ASC';

    const result = await query(queryText, values);
    return res.status(200).json({ ok: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { name, specialtyId, userId, crm, phone, status } = req.body;

    if (!name || !specialtyId) {
      return res.status(400).json({ ok: false, message: 'Nome e especialidade são obrigatórios.' });
    }

    const specialtyResult = await query(
      'SELECT id FROM specialties WHERE id = $1 AND clinic_id = $2',
      [specialtyId, req.clinicId]
    );

    if (specialtyResult.rowCount === 0) {
      return res.status(400).json({ ok: false, message: 'Especialidade inválida para esta clínica.' });
    }

    const result = await query(
      `INSERT INTO professionals (clinic_id, user_id, specialty_id, name, crm, phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.clinicId, userId || null, specialtyId, name, crm || null, phone || null, status || 'active']
    );

    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { role } = req.user;
    let queryText = `
      SELECT p.*, s.name AS specialty_name
      FROM professionals p
      LEFT JOIN specialties s ON s.id = p.specialty_id
      WHERE p.id = $1 AND p.clinic_id = $2
    `;
    const values = [req.params.id, req.clinicId];

    if (role === 'professional') {
      queryText += ' AND p.user_id = $3';
      values.push(req.user.userId);
    }

    const result = await query(queryText, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Profissional não encontrado.' });
    }

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { name, specialtyId, crm, phone, status } = req.body;

    if (!name && !specialtyId && !crm && !phone && !status) {
      return res.status(400).json({ ok: false, message: 'Nenhum campo para atualizar.' });
    }

    const existing = await query(
      'SELECT id FROM professionals WHERE id = $1 AND clinic_id = $2',
      [req.params.id, req.clinicId]
    );

    if (existing.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Profissional não encontrado.' });
    }

    if (specialtyId) {
      const specialtyResult = await query(
        'SELECT id FROM specialties WHERE id = $1 AND clinic_id = $2',
        [specialtyId, req.clinicId]
      );

      if (specialtyResult.rowCount === 0) {
        return res.status(400).json({ ok: false, message: 'Especialidade inválida para esta clínica.' });
      }
    }

    const fields = [];
    const values = [req.params.id, req.clinicId];
    let index = 3;

    if (name) {
      fields.push(`name = $${index}`); values.push(name); index += 1;
    }
    if (specialtyId) {
      fields.push(`specialty_id = $${index}`); values.push(specialtyId); index += 1;
    }
    if (crm !== undefined) {
      fields.push(`crm = $${index}`); values.push(crm); index += 1;
    }
    if (phone !== undefined) {
      fields.push(`phone = $${index}`); values.push(phone); index += 1;
    }
    if (status) {
      fields.push(`status = $${index}`); values.push(status); index += 1;
    }

    const result = await query(
      `UPDATE professionals
       SET ${fields.join(', ')}
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      values
    );

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ ok: false, message: 'Status é obrigatório.' });
    }

    const result = await query(
      `UPDATE professionals
       SET status = $3, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      [req.params.id, req.clinicId, status]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Profissional não encontrado.' });
    }

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
