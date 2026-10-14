import { Router } from 'express';
import { query, withTransaction } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';
import { logAudit } from '../services/auditService.js';
import { requireActivePlanSubscription } from '../services/planAccess.js';
import {
  isAppointmentPatientAllowed,
  isAppointmentPatientOwner,
  isAppointmentProfessionalAllowed,
  isAppointmentSpecialtyAllowed,
} from '../services/appointmentAuthorization.js';
import {
  assertAppointmentSlotAvailable,
  isValidIsoInterval,
  lockProfessionalSchedule,
} from '../services/appointmentScheduling.js';
import { hasExpectedAppointmentDuration } from './serviceValidation.js';
import {
  isAppointmentCancellationRequest,
  isAppointmentNotesUpdate,
  isAppointmentStatusUpdate,
  isCreateAppointmentRequest,
  isRescheduleAppointmentRequest,
} from '../services/appointmentRequest.js';
import { applyAppointmentServiceSnapshot } from '../services/appointmentServiceSnapshot.js';

async function loadBookableService(executor, { clinicId, professionalId, serviceId, allowInactive = false }) {
  const result = await executor.query(
    `SELECT s.id, s.name, s.price, s.duration_minutes, s.is_active
     FROM services s
     JOIN professional_services ps
       ON ps.service_id = s.id AND ps.clinic_id = s.clinic_id
     JOIN professionals pr
       ON pr.id = ps.professional_id AND pr.clinic_id = ps.clinic_id
     WHERE s.id = $1
       AND s.clinic_id = $2
       AND ps.professional_id = $3
       AND pr.status = 'active'
       AND (s.is_active = TRUE OR $4::boolean = TRUE)
     FOR SHARE OF s, ps, pr`,
    [serviceId, clinicId, professionalId, allowInactive]
  );
  return result.rows[0] || null;
}

const router = Router();

router.use(authenticateToken);
router.use(requireClinicAccess);
router.use(requireActivePlanSubscription());

router.get('/', async (req, res, next) => {
  try {
    const { role } = req.user;
    let queryText = `
      SELECT a.*, p.name AS patient_name, pr.name AS professional_name, s.name AS specialty_name
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.patient_id AND p.clinic_id = a.clinic_id
      LEFT JOIN professionals pr ON pr.id = a.professional_id AND pr.clinic_id = a.clinic_id
      LEFT JOIN specialties s ON s.id = a.specialty_id AND s.clinic_id = a.clinic_id
      WHERE a.clinic_id = $1
    `;
    const values = [req.clinicId];

    if (role === 'patient') {
      queryText += ' AND a.patient_id IN (SELECT id FROM patients WHERE user_id = $2 AND clinic_id = $1)';
      values.push(req.user.userId);
    }

    if (role === 'professional') {
      queryText += ' AND a.professional_id IN (SELECT id FROM professionals WHERE user_id = $2 AND clinic_id = $1)';
      values.push(req.user.userId);
    }

    queryText += ' ORDER BY a.scheduled_start ASC';

    const result = await query(queryText, values);
    return res.status(200).json({ ok: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const values = [req.params.id, req.clinicId];
    let queryText = `
      SELECT a.*, p.name AS patient_name, pr.name AS professional_name, s.name AS specialty_name
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.patient_id AND p.clinic_id = a.clinic_id
      LEFT JOIN professionals pr ON pr.id = a.professional_id AND pr.clinic_id = a.clinic_id
      LEFT JOIN specialties s ON s.id = a.specialty_id AND s.clinic_id = a.clinic_id
      WHERE a.id = $1 AND a.clinic_id = $2
    `;

    if (req.user.role === 'patient') {
      queryText += ` AND EXISTS (
        SELECT 1 FROM patients owner
        WHERE owner.id = a.patient_id
          AND owner.clinic_id = a.clinic_id
          AND owner.user_id = $3
      )`;
      values.push(req.user.userId);
    }

    if (req.user.role === 'professional') {
      queryText += ` AND EXISTS (
        SELECT 1 FROM professionals owner
        WHERE owner.id = a.professional_id
          AND owner.clinic_id = a.clinic_id
          AND owner.user_id = $3
      )`;
      values.push(req.user.userId);
    }

    const result = await query(queryText, values);
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Agendamento não encontrado.' });
    }

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/', authorizeRoles('admin', 'reception', 'patient'), async (req, res, next) => {
  try {
    if (!isCreateAppointmentRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'Dados de agendamento inválidos ou campos não permitidos.' });
    }

    const { patientId, professionalId, specialtyId, serviceId, scheduledStart, scheduledEnd, notes } = req.body;
    if (!isValidIsoInterval(scheduledStart, scheduledEnd)) {
      return res.status(400).json({ ok: false, message: 'Intervalo de agendamento inválido.' });
    }

    const patientCheck = await query(
      `SELECT id, clinic_id, user_id, status
       FROM patients
       WHERE id = $1 AND clinic_id = $2`,
      [patientId, req.clinicId]
    );

    if (!isAppointmentPatientAllowed({
      role: req.user.role,
      userId: req.user.userId,
      patientId,
      patient: patientCheck.rows[0],
      clinicId: req.clinicId,
    })) {
      if (req.user.role === 'patient' && patientCheck.rowCount > 0) {
        return res.status(404).json({ ok: false, message: 'Paciente não encontrado.' });
      }
      if (patientCheck.rowCount > 0 && patientCheck.rows[0].status !== 'active') {
        return res.status(400).json({ ok: false, message: 'Paciente inativo.' });
      }
      return res.status(404).json({ ok: false, message: 'Paciente não encontrado nesta clínica.' });
    }

    const professionalCheck = await query(
      `SELECT id, clinic_id, specialty_id, status
       FROM professionals
       WHERE id = $1 AND clinic_id = $2`,
      [professionalId, req.clinicId]
    );

    const professional = professionalCheck.rows[0];
    if (!isAppointmentProfessionalAllowed({ clinicId: req.clinicId, professional })) {
      return res.status(404).json({ ok: false, message: 'Profissional não encontrado nesta clínica.' });
    }

    const selectedSpecialtyId = specialtyId || professional.specialty_id || null;
    if (specialtyId && specialtyId !== professional.specialty_id) {
      return res.status(400).json({ ok: false, message: 'Especialidade incompatível com o profissional.' });
    }

    if (selectedSpecialtyId) {
      const specialtyCheck = await query(
        `SELECT id, clinic_id, status
         FROM specialties
         WHERE id = $1 AND clinic_id = $2`,
        [selectedSpecialtyId, req.clinicId]
      );

      if (!isAppointmentSpecialtyAllowed({
        clinicId: req.clinicId,
        professionalSpecialtyId: professional.specialty_id,
        specialty: specialtyCheck.rows[0],
      })) {
        return res.status(400).json({ ok: false, message: 'Especialidade inválida ou incompatível com o profissional.' });
      }
    }

    const code = `CONS-${Date.now()}`;
    const result = await withTransaction(async (client) => {
      await lockProfessionalSchedule(client, professionalId);
      const service = await loadBookableService(client, {
        clinicId: req.clinicId,
        professionalId,
        serviceId,
      });
      if (!service) {
        throw Object.assign(new Error('Serviço não encontrado ou indisponível para este profissional nesta clínica.'), { statusCode: 404 });
      }
      if (!hasExpectedAppointmentDuration(
        scheduledStart,
        scheduledEnd,
        Number(service.duration_minutes)
      )) {
        throw Object.assign(new Error('A duração do horário não corresponde à duração cadastrada do serviço.'), { statusCode: 400 });
      }

      await assertAppointmentSlotAvailable(client, {
        clinicId: req.clinicId,
        professionalId,
        scheduledStart,
        scheduledEnd,
        timeZone: req.user.clinicTimezone,
        durationMinutes: Number(service.duration_minutes),
      });

      const inserted = await client.query(
        `INSERT INTO appointments (
           clinic_id, patient_id, professional_id, specialty_id, service_id,
           service_name_snapshot, service_price_snapshot, service_duration_snapshot,
           scheduled_start, scheduled_end, status, code, notes
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled', $11, $12)
         RETURNING *`,
        [
          req.clinicId,
          patientId,
          professionalId,
          selectedSpecialtyId,
          service.id,
          service.name,
          service.price,
          service.duration_minutes,
          scheduledStart,
          scheduledEnd,
          code,
          notes || null,
        ]
      );

      await logAudit({
        clinicId: req.clinicId,
        userId: req.user.userId,
        entityType: 'appointments',
        entityId: inserted.rows[0].id,
        action: 'created',
        details: { code, patientId, professionalId, serviceId: service.id, scheduledStart, scheduledEnd },
      }, client);

      return inserted;
    });

    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    if (
      ['ex_appointments_no_overlapping_professional', 'ux_appointments_unique_slot'].includes(error.constraint)
    ) {
      return res.status(409).json({ ok: false, message: 'Esse horário já está ocupado.' });
    }
    return next(error);
  }
});

router.patch('/:id', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    if (!isAppointmentNotesUpdate(req.body)) {
      return res.status(400).json({ ok: false, message: 'Somente o campo notes pode ser atualizado.' });
    }

    const result = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE appointments
         SET notes = $3, updated_at = NOW()
         WHERE id = $1 AND clinic_id = $2
         RETURNING *`,
        [req.params.id, req.clinicId, req.body.notes]
      );

      if (updated.rowCount === 0) {
        return updated;
      }

      await logAudit({
        clinicId: req.clinicId,
        userId: req.user.userId,
        entityType: 'appointments',
        entityId: updated.rows[0].id,
        action: 'updated',
        details: { fields: ['notes'] },
      }, client);

      return updated;
    });

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Agendamento não encontrado.' });
    }

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    if (!isAppointmentStatusUpdate(req.body)) {
      return res.status(400).json({ ok: false, message: 'Status inválido.' });
    }
    const { status } = req.body;

    const result = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE appointments
         SET status = $3, updated_at = NOW()
         WHERE id = $1 AND clinic_id = $2
         RETURNING *`,
        [req.params.id, req.clinicId, status]
      );

      if (updated.rowCount > 0) {
        await logAudit({
          clinicId: req.clinicId,
          userId: req.user.userId,
          entityType: 'appointments',
          entityId: updated.rows[0].id,
          action: 'status_updated',
          details: { status },
        }, client);
      }

      return updated;
    });

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Agendamento não encontrado.' });
    }

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/cancel', authorizeRoles('admin', 'reception', 'patient'), async (req, res, next) => {
  try {
    if (!isAppointmentCancellationRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'Dados de cancelamento inválidos ou campos não permitidos.' });
    }

    const result = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE appointments
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1
           AND clinic_id = $2
           AND (
             $3 <> 'patient'
             OR EXISTS (
               SELECT 1
               FROM patients p
               WHERE p.id = appointments.patient_id
                 AND p.clinic_id = appointments.clinic_id
                 AND p.user_id = $4
             )
           )
         RETURNING *`,
        [req.params.id, req.clinicId, req.user.role, req.user.userId]
      );

      if (updated.rowCount > 0) {
        await logAudit({
          clinicId: req.clinicId,
          userId: req.user.userId,
          entityType: 'appointments',
          entityId: updated.rows[0].id,
          action: 'cancelled',
          details: { reason: req.body?.reason || 'cancelled_by_user' },
        }, client);
      }

      return updated;
    });

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Agendamento não encontrado.' });
    }

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/reschedule', authorizeRoles('admin', 'reception', 'patient'), async (req, res, next) => {
  try {
    if (!isRescheduleAppointmentRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'Dados de reagendamento inválidos ou campos não permitidos.' });
    }

    const { professionalId, specialtyId, serviceId, scheduledStart, scheduledEnd } = req.body;
    if (!isValidIsoInterval(scheduledStart, scheduledEnd)) {
      return res.status(400).json({ ok: false, message: 'Intervalo de agendamento inválido.' });
    }

    const updated = await withTransaction(async (client) => {
      const appResult = await client.query(
        `SELECT a.patient_id, p.user_id AS patient_user_id, a.service_id,
                a.service_name_snapshot, a.service_price_snapshot,
                a.service_duration_snapshot
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id AND p.clinic_id = a.clinic_id
         WHERE a.id = $1 AND a.clinic_id = $2
         FOR UPDATE OF a`,
        [req.params.id, req.clinicId]
      );

      if (
        appResult.rowCount === 0 ||
        (req.user.role === 'patient' &&
          !isAppointmentPatientOwner(req.user.userId, appResult.rows[0]?.patient_user_id))
      ) {
        throw Object.assign(new Error('Agendamento não encontrado.'), { statusCode: 404 });
      }
      const appointment = appResult.rows[0];
      if ((appointment.service_id && appointment.service_id !== serviceId) || (!appointment.service_id && serviceId)) {
        throw Object.assign(new Error('O serviço deste agendamento não pode ser alterado durante o reagendamento.'), { statusCode: 400 });
      }
      if (appointment.service_id && !serviceId) {
        throw Object.assign(new Error('Informe o serviço deste agendamento para reagendá-lo.'), { statusCode: 400 });
      }

      await lockProfessionalSchedule(client, professionalId);

      const professionalCheck = await client.query(
        `SELECT id, clinic_id, specialty_id, status
         FROM professionals
         WHERE id = $1 AND clinic_id = $2`,
        [professionalId, req.clinicId]
      );
      const professional = professionalCheck.rows[0];

      if (!isAppointmentProfessionalAllowed({ clinicId: req.clinicId, professional })) {
        throw Object.assign(new Error('Profissional não encontrado nesta clínica.'), { statusCode: 404 });
      }

      const selectedSpecialtyId = specialtyId || professional.specialty_id || null;
      if (specialtyId && specialtyId !== professional.specialty_id) {
        throw Object.assign(new Error('Especialidade incompatível com o profissional.'), { statusCode: 400 });
      }

      if (selectedSpecialtyId) {
        const specialtyCheck = await client.query(
          `SELECT id, clinic_id, status
           FROM specialties
           WHERE id = $1 AND clinic_id = $2`,
          [selectedSpecialtyId, req.clinicId]
        );

        if (!isAppointmentSpecialtyAllowed({
          clinicId: req.clinicId,
          professionalSpecialtyId: professional.specialty_id,
          specialty: specialtyCheck.rows[0],
        })) {
          throw Object.assign(new Error('Especialidade inválida ou incompatível com o profissional.'), { statusCode: 400 });
        }
      }

      let service;
      if (serviceId) {
        service = await loadBookableService(client, {
          clinicId: req.clinicId,
          professionalId,
          serviceId,
          allowInactive: true,
        });
        if (!service) {
          throw Object.assign(new Error('Serviço não encontrado ou não associado a este profissional nesta clínica.'), { statusCode: 404 });
        }
        service = applyAppointmentServiceSnapshot(service, appointment);
        if (!hasExpectedAppointmentDuration(
          scheduledStart,
          scheduledEnd,
          Number(service.duration_minutes)
        )) {
          throw Object.assign(new Error('A duração do horário não corresponde ao histórico deste serviço.'), { statusCode: 400 });
        }
      }

      await assertAppointmentSlotAvailable(client, {
        clinicId: req.clinicId,
        professionalId,
        scheduledStart,
        scheduledEnd,
        excludeAppointmentId: req.params.id,
        timeZone: req.user.clinicTimezone,
        durationMinutes: service ? Number(service.duration_minutes) : undefined,
      });

      const updated = await client.query(
        `UPDATE appointments
         SET professional_id = $3, specialty_id = $4, scheduled_start = $5, scheduled_end = $6,
             status = 'rescheduled', updated_at = NOW()
         WHERE id = $1 AND clinic_id = $2
         RETURNING *`,
        [req.params.id, req.clinicId, professionalId, selectedSpecialtyId, scheduledStart, scheduledEnd]
      );

      if (updated.rowCount === 0) {
        throw Object.assign(new Error('Agendamento não encontrado.'), { statusCode: 404 });
      }

      await logAudit({
        clinicId: req.clinicId,
        userId: req.user.userId,
        entityType: 'appointments',
        entityId: updated.rows[0].id,
        action: 'rescheduled',
        details: {
          professionalId,
          specialtyId: updated.rows[0].specialty_id,
          scheduledStart,
          scheduledEnd,
        },
      }, client);

      return updated;
    });

    return res.status(200).json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    if (
      ['ex_appointments_no_overlapping_professional', 'ux_appointments_unique_slot'].includes(error.constraint)
    ) {
      return res.status(409).json({ ok: false, message: 'Esse horário já está ocupado.' });
    }
    return next(error);
  }
});

export default router;
