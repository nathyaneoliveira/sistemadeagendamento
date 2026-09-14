import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';

const router = Router();

router.use(authenticateToken);
router.use(requireClinicAccess);

router.get('/professionals/:professionalId', async (req, res, next) => {
  try {
    const { professionalId } = req.params;
    const { role } = req.user;

    let queryText = `
      SELECT * FROM professional_schedules
      WHERE professional_id = $1 AND clinic_id = $2
    `;
    const values = [professionalId, req.clinicId];

    if (role === 'professional') {
      const professionalCheck = await query(
        'SELECT id FROM professionals WHERE id = $1 AND clinic_id = $2 AND user_id = $3',
        [professionalId, req.clinicId, req.user.userId]
      );

      if (professionalCheck.rowCount === 0) {
        return res.status(403).json({ ok: false, message: 'Você não pode visualizar a agenda de outro profissional.' });
      }
    }

    const result = await query(queryText + ' ORDER BY weekday, start_time', values);
    return res.status(200).json({ ok: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/professionals/:professionalId', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { professionalId } = req.params;
    const { weekday, startTime, endTime, durationMinutes, breakDurationMinutes } = req.body;

    if (!weekday || !startTime || !endTime || !durationMinutes) {
      return res.status(400).json({ ok: false, message: 'weekday, startTime, endTime e durationMinutes são obrigatórios.' });
    }

    if (weekday < 1 || weekday > 7) {
      return res.status(400).json({ ok: false, message: 'weekday deve estar entre 1 e 7.' });
    }

    const professionalCheck = await query(
      'SELECT id FROM professionals WHERE id = $1 AND clinic_id = $2',
      [professionalId, req.clinicId]
    );

    if (professionalCheck.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Profissional não encontrado nesta clínica.' });
    }

    const result = await query(
      `INSERT INTO professional_schedules (clinic_id, professional_id, weekday, start_time, end_time, duration_minutes, break_duration_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.clinicId, professionalId, weekday, startTime, endTime, durationMinutes, breakDurationMinutes || 0]
    );

    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/professionals/:professionalId/blocks', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { professionalId } = req.params;
    const { blockType, startDatetime, endDatetime, reason } = req.body;

    if (!blockType || !startDatetime || !endDatetime) {
      return res.status(400).json({ ok: false, message: 'blockType, startDatetime e endDatetime são obrigatórios.' });
    }

    const validTypes = ['vacation', 'holiday', 'meeting', 'absence', 'custom'];
    if (!validTypes.includes(blockType)) {
      return res.status(400).json({ ok: false, message: 'Tipo de bloqueio inválido.' });
    }

    const professionalCheck = await query(
      'SELECT id FROM professionals WHERE id = $1 AND clinic_id = $2',
      [professionalId, req.clinicId]
    );

    if (professionalCheck.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Profissional não encontrado nesta clínica.' });
    }

    const result = await query(
      `INSERT INTO schedule_blocks (clinic_id, professional_id, block_type, start_datetime, end_datetime, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.clinicId, professionalId, blockType, startDatetime, endDatetime, reason || null]
    );

    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/professionals/:professionalId/availability', async (req, res, next) => {
  try {
    const { professionalId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ ok: false, message: 'Parâmetro date é obrigatório.' });
    }

    const scheduleResult = await query(
      `SELECT * FROM professional_schedules
       WHERE professional_id = $1 AND clinic_id = $2
       ORDER BY weekday, start_time`,
      [professionalId, req.clinicId]
    );

    const blockResult = await query(
      `SELECT * FROM schedule_blocks
       WHERE professional_id = $1 AND clinic_id = $2
         AND start_datetime::date = $3::date`,
      [professionalId, req.clinicId, date]
    );

    return res.status(200).json({
      ok: true,
      data: {
        date,
        schedule: scheduleResult.rows,
        blocks: blockResult.rows,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
