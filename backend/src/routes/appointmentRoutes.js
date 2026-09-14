import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';
import { logAudit } from '../services/auditService.js';

const router = Router();

router.use(authenticateToken);
router.use(requireClinicAccess);

router.get('/', async (req, res, next) => {
  try {
    const { role } = req.user;
    let queryText = `
      SELECT a.*, p.name AS patient_name, pr.name AS professional_name
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.patient_id
      LEFT JOIN professionals pr ON pr.id = a.professional_id
      WHERE a.clinic_id = $1
    `;
    const values = [req.clinicId];

    if (role === 'patient') {
      queryText += ' AND a.patient_id IN (SELECT id FROM patients WHERE user_id = $2)';
      values.push(req.user.userId);
    }

    if (role === 'professional') {
      queryText += ' AND a.professional_id IN (SELECT id FROM professionals WHERE user_id = $2)';
      values.push(req.user.userId);
    }

    queryText += ' ORDER BY a.scheduled_start ASC';

    const result = await query(queryText, values);
    return res.status(200).json({ ok: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', authorizeRoles('admin', 'reception', 'patient'), async (req, res, next) => {
  try {
    const { patientId, professionalId, specialtyId, scheduledStart, scheduledEnd, notes } = req.body;

    if (!patientId || !professionalId || !scheduledStart || !scheduledEnd) {
      return res.status(400).json({ ok: false, message: 'patientId, professionalId, scheduledStart e scheduledEnd são obrigatórios.' });
    }

    const patientCheck = await query(
      'SELECT id FROM patients WHERE id = $1 AND clinic_id = $2',
      [patientId, req.clinicId]
    );

    if (patientCheck.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Paciente não encontrado nesta clínica.' });
    }

    const professionalCheck = await query(
      'SELECT id, status FROM professionals WHERE id = $1 AND clinic_id = $2',
      [professionalId, req.clinicId]
    );

    if (professionalCheck.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Profissional não encontrado nesta clínica.' });
    }

    if (professionalCheck.rows[0].status !== 'active') {
      return res.status(400).json({ ok: false, message: 'Profissional está inativo.' });
    }

    const conflict = await query(
      `SELECT id FROM appointments
       WHERE professional_id = $1
         AND clinic_id = $2
         AND status NOT IN ('cancelled')
         AND scheduled_start < $3::timestamptz
         AND scheduled_end > $4::timestamptz`,
      [professionalId, req.clinicId, scheduledEnd, scheduledStart]
    );

    if (conflict.rowCount > 0) {
      return res.status(409).json({ ok: false, message: 'Esse horário já está ocupado.' });
    }

    const blocked = await query(
      `SELECT id FROM schedule_blocks
       WHERE professional_id = $1
         AND clinic_id = $2
         AND start_datetime <= $3::timestamptz
         AND end_datetime >= $4::timestamptz`,
      [professionalId, req.clinicId, scheduledStart, scheduledEnd]
    );

    if (blocked.rowCount > 0) {
      return res.status(409).json({ ok: false, message: 'Este horário está bloqueado para o profissional.' });
    }

    const code = `CONS-${Date.now()}`;
    const result = await query(
      `INSERT INTO appointments (clinic_id, patient_id, professional_id, specialty_id, scheduled_start, scheduled_end, status, code, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', $7, $8)
       RETURNING *`,
      [req.clinicId, patientId, professionalId, specialtyId || null, scheduledStart, scheduledEnd, code, notes || null]
    );

    await logAudit({
      clinicId: req.clinicId,
      userId: req.user.userId,
      entityType: 'appointments',
      entityId: result.rows[0].id,
      action: 'created',
      details: { code, patientId, professionalId, scheduledStart, scheduledEnd },
    });

    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, message: 'Status inválido.' });
    }

    const result = await query(
      `UPDATE appointments
       SET status = $3, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      [req.params.id, req.clinicId, status]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Agendamento não encontrado.' });
    }

    await logAudit({
      clinicId: req.clinicId,
      userId: req.user.userId,
      entityType: 'appointments',
      entityId: result.rows[0].id,
      action: 'status_updated',
      details: { status },
    });

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/cancel', authorizeRoles('admin', 'reception', 'patient'), async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE appointments
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      [req.params.id, req.clinicId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Agendamento não encontrado.' });
    }

    await logAudit({
      clinicId: req.clinicId,
      userId: req.user.userId,
      entityType: 'appointments',
      entityId: result.rows[0].id,
      action: 'cancelled',
      details: { reason: req.body.reason || 'cancelled_by_user' },
    });

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/reschedule', authorizeRoles('admin', 'reception', 'patient'), async (req, res, next) => {
  try {
    const { professionalId, scheduledStart, scheduledEnd } = req.body;

    if (!professionalId || !scheduledStart || !scheduledEnd) {
      return res.status(400).json({ ok: false, message: 'professionalId, scheduledStart e scheduledEnd são obrigatórios.' });
    }

    const appResult = await query(
      'SELECT patient_id, professional_id FROM appointments WHERE id = $1 AND clinic_id = $2',
      [req.params.id, req.clinicId]
    );

    if (appResult.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Agendamento não encontrado.' });
    }

    const conflict = await query(
      `SELECT id FROM appointments
       WHERE professional_id = $1
         AND clinic_id = $2
         AND id != $3
         AND status NOT IN ('cancelled')
         AND scheduled_start < $4::timestamptz
         AND scheduled_end > $5::timestamptz`,
      [professionalId, req.clinicId, req.params.id, scheduledEnd, scheduledStart]
    );

    if (conflict.rowCount > 0) {
      return res.status(409).json({ ok: false, message: 'Novo horário está conflitante.' });
    }

    const updated = await query(
      `UPDATE appointments
       SET professional_id = $3, scheduled_start = $4, scheduled_end = $5, status = 'rescheduled', updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      [req.params.id, req.clinicId, professionalId, scheduledStart, scheduledEnd]
    );

    await logAudit({
      clinicId: req.clinicId,
      userId: req.user.userId,
      entityType: 'appointments',
      entityId: updated.rows[0].id,
      action: 'rescheduled',
      details: { professionalId, scheduledStart, scheduledEnd },
    });

    return res.status(200).json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
