import { Router } from 'express';
import { query, withTransaction } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';
import {
  canReadProfessionalSchedule,
  generateAvailableSlots,
  isCreateProfessionalScheduleRequest,
  isCreateScheduleBlockRequest,
  isProfessionalInClinic,
  lockProfessionalSchedule,
  parseIsoDate,
  isUniqueClinicInstant,
} from '../services/appointmentScheduling.js';
import { isUuid } from './serviceValidation.js';
import { requireActivePlanSubscription } from '../services/planAccess.js';

const router = Router();

router.use(authenticateToken);
router.use(requireClinicAccess);
router.use(requireActivePlanSubscription());

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
        'SELECT user_id FROM professionals WHERE id = $1 AND clinic_id = $2',
        [professionalId, req.clinicId]
      );

      if (
        professionalCheck.rowCount === 0 ||
        !canReadProfessionalSchedule({
          role,
          userId: req.user.userId,
          professionalUserId: professionalCheck.rows[0].user_id,
        })
      ) {
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

    if (!isCreateProfessionalScheduleRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'Informe dia, horários válidos e duração positiva; o término deve ser posterior ao início.' });
    }

    const { weekday, startTime, endTime, durationMinutes, breakDurationMinutes } = req.body;
    if (!(await isProfessionalInClinic(query, req.clinicId, professionalId))) {
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
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, message: 'Este horário de trabalho já está cadastrado.' });
    }
    return next(error);
  }
});

router.post('/professionals/:professionalId/blocks', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { professionalId } = req.params;

    if (!isCreateScheduleBlockRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'blockType, startDatetime e endDatetime são obrigatórios.' });
    }

    const { blockType, startDatetime, endDatetime, reason } = req.body;
    if (
      !isUniqueClinicInstant(startDatetime, req.user.clinicTimezone) ||
      !isUniqueClinicInstant(endDatetime, req.user.clinicTimezone)
    ) {
      return res.status(400).json({ ok: false, message: 'O horário local é inexistente ou ambíguo no fuso da clínica.' });
    }
    if (!(await isProfessionalInClinic(query, req.clinicId, professionalId))) {
      return res.status(404).json({ ok: false, message: 'Profissional não encontrado nesta clínica.' });
    }

    const result = await withTransaction(async (client) => {
      await lockProfessionalSchedule(client, professionalId);

      const conflict = await client.query(
        `SELECT id FROM appointments
         WHERE clinic_id = $1
           AND professional_id = $2
           AND status <> 'cancelled'
           AND scheduled_start < $4::timestamptz
           AND scheduled_end > $3::timestamptz
         LIMIT 1`,
        [req.clinicId, professionalId, startDatetime, endDatetime]
      );

      if (conflict.rowCount > 0) {
        throw Object.assign(new Error('O bloqueio conflita com um agendamento existente.'), { statusCode: 409 });
      }

      return client.query(
        `INSERT INTO schedule_blocks (clinic_id, professional_id, block_type, start_datetime, end_datetime, reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [req.clinicId, professionalId, blockType, startDatetime, endDatetime, reason || null]
      );
    });

    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/professionals/:professionalId/availability', async (req, res, next) => {
  try {
    const { professionalId } = req.params;
    const { date, serviceId, appointmentId } = req.query;

    const timeZone = req.user.clinicTimezone;
    const day = parseIsoDate(date, timeZone);
    if (!day) {
      return res.status(400).json({ ok: false, message: 'Data inválida ou fuso horário da clínica inválido.' });
    }
    if (serviceId !== undefined && !isUuid(serviceId)) {
      return res.status(400).json({ ok: false, message: 'Identificador de serviço inválido.' });
    }
    if (appointmentId !== undefined && (!isUuid(appointmentId) || !serviceId)) {
      return res.status(400).json({ ok: false, message: 'Identificador de reagendamento inválido.' });
    }

    const professionalResult = await query(
      `SELECT id, status, user_id
       FROM professionals
       WHERE id = $1 AND clinic_id = $2`,
      [professionalId, req.clinicId]
    );

    if (professionalResult.rowCount === 0 || professionalResult.rows[0].status !== 'active') {
      return res.status(404).json({ ok: false, message: 'Profissional não encontrado nesta clínica.' });
    }

    if (!canReadProfessionalSchedule({
      role: req.user.role,
      userId: req.user.userId,
      professionalUserId: professionalResult.rows[0].user_id,
    })) {
      return res.status(403).json({ ok: false, message: 'Você não pode visualizar a agenda de outro profissional.' });
    }

    let durationMinutes;
    if (serviceId) {
      let appointmentSnapshot = null;
      if (appointmentId) {
        const appointmentResult = await query(
          `SELECT a.service_duration_snapshot
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id AND p.clinic_id = a.clinic_id
           WHERE a.id = $1
             AND a.clinic_id = $2
             AND a.service_id = $3
             AND ($4::text <> 'patient' OR p.user_id = $5)`,
          [appointmentId, req.clinicId, serviceId, req.user.role, req.user.userId]
        );
        appointmentSnapshot = appointmentResult.rows[0]?.service_duration_snapshot ?? null;
      }

      const serviceResult = await query(
        `SELECT s.duration_minutes
         FROM services s
         JOIN professional_services ps
           ON ps.service_id = s.id AND ps.clinic_id = s.clinic_id
         WHERE s.id = $1
           AND s.clinic_id = $2
           AND ps.professional_id = $3
           AND (s.is_active = TRUE OR $4::boolean = TRUE)`,
        [serviceId, req.clinicId, professionalId, appointmentSnapshot !== null]
      );
      if (serviceResult.rowCount === 0) {
        return res.status(404).json({ ok: false, message: 'Serviço não encontrado ou indisponível para este profissional.' });
      }
      durationMinutes = Number(appointmentSnapshot ?? serviceResult.rows[0].duration_minutes);
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
         AND status = 'active'
         AND start_datetime < $4::timestamptz
         AND end_datetime > $3::timestamptz`,
      [professionalId, req.clinicId, new Date(day.start).toISOString(), new Date(day.end).toISOString()]
    );

    const appointmentResult = await query(
      `SELECT scheduled_start, scheduled_end, status
       FROM appointments
       WHERE professional_id = $1 AND clinic_id = $2
         AND status <> 'cancelled'
         AND scheduled_start < $4::timestamptz
         AND scheduled_end > $3::timestamptz`,
      [professionalId, req.clinicId, new Date(day.start).toISOString(), new Date(day.end).toISOString()]
    );

    return res.status(200).json({
      ok: true,
      data: {
        date,
        schedule: scheduleResult.rows,
        blocks: blockResult.rows,
        availableSlots: generateAvailableSlots({
          date,
          schedules: scheduleResult.rows,
          blocks: blockResult.rows,
          appointments: appointmentResult.rows,
          timeZone,
          durationMinutes,
        }),
        timeZone,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
