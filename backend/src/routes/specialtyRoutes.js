import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';

const router = Router();

router.use(authenticateToken);
router.use(requireClinicAccess);

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM specialties WHERE clinic_id = $1 ORDER BY name ASC',
      [req.clinicId]
    );

    return res.status(200).json({ ok: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { name, description, status } = req.body;

    if (!name) {
      return res.status(400).json({ ok: false, message: 'Nome da especialidade é obrigatório.' });
    }

    const result = await query(
      `INSERT INTO specialties (clinic_id, name, description, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.clinicId, name, description || null, status || 'active']
    );

    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM specialties WHERE id = $1 AND clinic_id = $2',
      [req.params.id, req.clinicId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Especialidade não encontrada.' });
    }

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { name, description, status } = req.body;

    const result = await query(
      `UPDATE specialties
       SET name = COALESCE($3, name), description = COALESCE($4, description), status = COALESCE($5, status), updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      [req.params.id, req.clinicId, name || null, description || null, status || null]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Especialidade não encontrada.' });
    }

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
