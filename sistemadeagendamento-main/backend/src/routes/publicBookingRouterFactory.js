import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  assertAppointmentSlotAvailable,
  generateAvailableSlots,
  isValidIsoInterval,
  lockProfessionalSchedule,
  parseIsoDate,
} from '../services/appointmentScheduling.js';
import { normalizePublicPhone, isPublicAppointmentRequest, isPublicClinicSlug } from './publicBookingValidation.js';
import { isUuid } from './serviceValidation.js';
import {
  assertPlanResourceLimit,
  loadClinicPlan,
  PlanAccessError,
} from '../services/planAccess.js';

const PUBLIC_CLINIC_SELECT = `
  SELECT c.id AS clinic_id,
         c.name AS clinic_name,
         c.trade_name,
         cc.public_slug,
         cc.name AS configured_name,
         cc.phone AS public_phone,
         cc.whatsapp AS public_whatsapp,
         cc.address_line1 AS public_address,
         cc.email AS public_email,
         cc.timezone
  FROM clinic_configurations cc
  JOIN clinics c ON c.id = cc.clinic_id
  WHERE cc.public_slug = $1 AND c.status = 'active'
`;

function publicClinic(row) {
  if (!row) return null;
  const name = row.configured_name?.trim() || row.trade_name?.trim() || row.clinic_name?.trim();
  if (!name) return null;
  return {
    id: row.clinic_id,
    name,
    phone: row.public_phone,
    whatsapp: row.public_whatsapp,
    address: row.public_address,
    email: row.public_email,
    timezone: row.timezone,
  };
}

function publicAppointment(row) {
  return {
    code: row.code,
    clinic: {
      name: row.public_name,
      phone: row.public_phone,
      whatsapp: row.public_whatsapp,
      address: row.public_address,
    },
    service: {
      name: row.service_name_snapshot,
      durationMinutes: Number(row.service_duration_snapshot),
      price: Number(row.service_price_snapshot),
    },
    professional: { name: row.professional_name },
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    customer: {
      name: row.patient_name,
      phone: row.patient_phone,
      email: row.patient_email,
    },
  };
}

function isSameIdempotentRequest(row, request) {
  return row.service_id === request.serviceId &&
    row.professional_id === request.professionalId &&
    new Date(row.scheduled_start).getTime() === Date.parse(request.scheduledStart) &&
    row.patient_name.trim().toLocaleLowerCase('pt-BR') === request.name.trim().toLocaleLowerCase('pt-BR') &&
    normalizePublicPhone(row.patient_phone) === normalizePublicPhone(request.phone) &&
    (row.patient_email || '').trim().toLowerCase() === (request.email || '').trim().toLowerCase();
}

function isContactConflict(error) {
  return error?.statusCode === 409;
}

export function createPublicBookingRouter({
  queryExecutor,
  transactionExecutor,
  auditLogger,
  bookingRateLimit = (_req, _res, next) => next(),
  clinicPlanLoader = loadClinicPlan,
  checkPlanLimit = assertPlanResourceLimit,
} = {}) {
  if (
    typeof queryExecutor !== 'function' ||
    typeof transactionExecutor !== 'function' ||
    typeof auditLogger !== 'function' ||
    typeof bookingRateLimit !== 'function'
  ) {
    throw new TypeError('Public booking router dependencies must be provided explicitly.');
  }

  const router = Router();

  async function getClinic(slug) {
    if (!isPublicClinicSlug(slug)) return null;
    const result = await queryExecutor(`${PUBLIC_CLINIC_SELECT} LIMIT 1`, [slug]);
    const clinic = publicClinic(result.rows[0]);
    if (!clinic) return null;
    try {
      await clinicPlanLoader({ query: queryExecutor }, clinic.id);
      return clinic;
    } catch (error) {
      if (error instanceof PlanAccessError) return null;
      throw error;
    }
  }

  router.get('/clinics/:clinicSlug', async (req, res, next) => {
    try {
      const clinic = await getClinic(req.params.clinicSlug);
      if (!clinic) return res.status(404).json({ ok: false, message: 'Página de agendamento não encontrada.' });
      return res.status(200).json({
        ok: true,
        data: {
          name: clinic.name,
          phone: clinic.phone,
          whatsapp: clinic.whatsapp,
          address: clinic.address,
          email: clinic.email,
          timezone: clinic.timezone,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/clinics/:clinicSlug/services', async (req, res, next) => {
    try {
      const clinic = await getClinic(req.params.clinicSlug);
      if (!clinic) return res.status(404).json({ ok: false, message: 'Página de agendamento não encontrada.' });
      const result = await queryExecutor(
        `SELECT s.id, s.name, s.duration_minutes, s.price
         FROM services s
         WHERE s.clinic_id = $1
           AND s.is_active = TRUE
           AND EXISTS (
             SELECT 1
             FROM professional_services ps
             JOIN professionals p
               ON p.id = ps.professional_id AND p.clinic_id = ps.clinic_id
             WHERE ps.clinic_id = s.clinic_id
               AND ps.service_id = s.id
               AND p.status = 'active'
           )
         ORDER BY s.name`,
        [clinic.id]
      );
      return res.status(200).json({ ok: true, data: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/clinics/:clinicSlug/services/:serviceId/professionals', async (req, res, next) => {
    if (!isUuid(req.params.serviceId)) {
      return res.status(400).json({ ok: false, message: 'Serviço inválido.' });
    }
    try {
      const clinic = await getClinic(req.params.clinicSlug);
      if (!clinic) return res.status(404).json({ ok: false, message: 'Página de agendamento não encontrada.' });
      const result = await queryExecutor(
        `SELECT p.id, p.name
         FROM services s
         JOIN professional_services ps
           ON ps.service_id = s.id AND ps.clinic_id = s.clinic_id
         JOIN professionals p
           ON p.id = ps.professional_id AND p.clinic_id = ps.clinic_id
         WHERE s.id = $1
           AND s.clinic_id = $2
           AND s.is_active = TRUE
           AND p.status = 'active'
         ORDER BY p.name`,
        [req.params.serviceId, clinic.id]
      );
      return res.status(200).json({ ok: true, data: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get(
    '/clinics/:clinicSlug/services/:serviceId/professionals/:professionalId/availability',
    async (req, res, next) => {
      if (!isUuid(req.params.serviceId) || !isUuid(req.params.professionalId)) {
        return res.status(400).json({ ok: false, message: 'Serviço ou profissional inválido.' });
      }
      try {
        const clinic = await getClinic(req.params.clinicSlug);
        if (!clinic) return res.status(404).json({ ok: false, message: 'Página de agendamento não encontrada.' });
        const day = parseIsoDate(req.query.date, clinic.timezone);
        if (!day) return res.status(400).json({ ok: false, message: 'Data inválida.' });

        const eligible = await queryExecutor(
          `SELECT s.duration_minutes
           FROM services s
           JOIN professional_services ps
             ON ps.service_id = s.id AND ps.clinic_id = s.clinic_id
           JOIN professionals p
             ON p.id = ps.professional_id AND p.clinic_id = ps.clinic_id
           WHERE s.id = $1 AND s.clinic_id = $2
             AND p.id = $3 AND p.status = 'active' AND s.is_active = TRUE`,
          [req.params.serviceId, clinic.id, req.params.professionalId]
        );
        if (!eligible.rowCount) {
          return res.status(404).json({ ok: false, message: 'Serviço ou profissional indisponível.' });
        }

        const [scheduleResult, blockResult, appointmentResult] = await Promise.all([
          queryExecutor(
            `SELECT weekday, start_time, end_time, duration_minutes, break_duration_minutes, status
             FROM professional_schedules
             WHERE clinic_id = $1 AND professional_id = $2 AND status = 'active'
             ORDER BY weekday, start_time`,
            [clinic.id, req.params.professionalId]
          ),
          queryExecutor(
            `SELECT start_datetime, end_datetime, status
             FROM schedule_blocks
             WHERE clinic_id = $1 AND professional_id = $2 AND status = 'active'
               AND start_datetime < $4::timestamptz AND end_datetime > $3::timestamptz`,
            [clinic.id, req.params.professionalId, new Date(day.start).toISOString(), new Date(day.end).toISOString()]
          ),
          queryExecutor(
            `SELECT id, scheduled_start, scheduled_end, status
             FROM appointments
             WHERE clinic_id = $1 AND professional_id = $2 AND status <> 'cancelled'
               AND scheduled_start < $4::timestamptz AND scheduled_end > $3::timestamptz`,
            [clinic.id, req.params.professionalId, new Date(day.start).toISOString(), new Date(day.end).toISOString()]
          ),
        ]);

        const slots = generateAvailableSlots({
          date: req.query.date,
          schedules: scheduleResult.rows,
          blocks: blockResult.rows,
          appointments: appointmentResult.rows,
          timeZone: clinic.timezone,
          durationMinutes: Number(eligible.rows[0].duration_minutes),
        });
        if (slots === null) return res.status(400).json({ ok: false, message: 'Data inválida.' });
        return res.status(200).json({ ok: true, data: slots });
      } catch (error) {
        return next(error);
      }
    }
  );

  router.post('/clinics/:clinicSlug/appointments', bookingRateLimit, async (req, res, next) => {
    if (!isPublicAppointmentRequest(req.body) || !isPublicClinicSlug(req.params.clinicSlug)) {
      return res.status(400).json({ ok: false, message: 'Dados de agendamento inválidos.' });
    }

    try {
      const clinic = await getClinic(req.params.clinicSlug);
      if (!clinic) return res.status(404).json({ ok: false, message: 'Página de agendamento não encontrada.' });
      const startTime = Date.parse(req.body.scheduledStart);

      const result = await transactionExecutor(async (client) => {
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`public-booking:${clinic.id}:${req.body.idempotencyKey}`]
        );
        const clinicResult = await client.query(
          `SELECT c.id, cc.timezone
           FROM clinics c
           JOIN clinic_configurations cc ON cc.clinic_id = c.id
           WHERE c.id = $1 AND c.status = 'active' AND cc.public_slug = $2
           FOR SHARE OF c, cc`,
          [clinic.id, req.params.clinicSlug]
        );
        if (!clinicResult.rowCount) {
          throw Object.assign(new Error('Página de agendamento não encontrada.'), { statusCode: 404 });
        }
        const bookingTimeZone = clinicResult.rows[0].timezone;

        const prior = await client.query(
          `SELECT a.code, a.clinic_id, a.patient_id, a.professional_id, a.service_id,
                  a.service_name_snapshot, a.service_price_snapshot, a.service_duration_snapshot,
                  a.scheduled_start, a.scheduled_end, p.name AS patient_name,
                  p.phone AS patient_phone, p.email AS patient_email
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id AND p.clinic_id = a.clinic_id
           WHERE a.clinic_id = $1 AND a.public_idempotency_key = $2`,
          [clinic.id, req.body.idempotencyKey]
        );
        if (prior.rowCount) {
          const previous = prior.rows[0];
          if (!isSameIdempotentRequest(previous, req.body)) {
            throw Object.assign(new Error('Chave de solicitação já utilizada.'), { statusCode: 409 });
          }
          const confirmation = await loadPublicConfirmation(client, clinic, previous.code);
          return { status: 200, confirmation };
        }

        await lockProfessionalSchedule(client, req.body.professionalId);
        const serviceResult = await client.query(
          `SELECT s.id, s.name, s.price, s.duration_minutes
           FROM services s
           JOIN professional_services ps
             ON ps.service_id = s.id AND ps.clinic_id = s.clinic_id
           JOIN professionals p
             ON p.id = ps.professional_id AND p.clinic_id = ps.clinic_id
           WHERE s.id = $1 AND s.clinic_id = $2
             AND ps.professional_id = $3
             AND s.is_active = TRUE AND p.status = 'active'
           FOR SHARE OF s, ps, p`,
          [req.body.serviceId, clinic.id, req.body.professionalId]
        );
        if (!serviceResult.rowCount) {
          throw Object.assign(new Error('Serviço ou profissional indisponível.'), { statusCode: 404 });
        }
        const service = serviceResult.rows[0];
        const durationMinutes = Number(service.duration_minutes);
        const endTime = new Date(startTime + durationMinutes * 60_000).toISOString();
        if (!isValidIsoInterval(req.body.scheduledStart, endTime)) {
          throw Object.assign(new Error('Horário inválido.'), { statusCode: 400 });
        }
        await assertAppointmentSlotAvailable(client, {
          clinicId: clinic.id,
          professionalId: req.body.professionalId,
          scheduledStart: req.body.scheduledStart,
          scheduledEnd: endTime,
          timeZone: bookingTimeZone,
          durationMinutes,
        });

        const normalizedEmail = (req.body.email || '').trim().toLowerCase();
        const lockKeys = [
          `public-contact:${clinic.id}:phone:${normalizePublicPhone(req.body.phone)}`,
          ...(normalizedEmail ? [`public-contact:${clinic.id}:email:${normalizedEmail}`] : []),
        ].sort();
        for (const key of lockKeys) {
          await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [key]
          );
        }

        const contacts = await client.query(
          `SELECT id, name, phone, email, status
           FROM patients
           WHERE clinic_id = $1
             AND (
               regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2
               OR ($3::text <> '' AND lower(trim(COALESCE(email, ''))) = $3)
             )
           FOR UPDATE`,
          [clinic.id, normalizePublicPhone(req.body.phone), normalizedEmail]
        );
        if (contacts.rowCount > 0) {
          throw Object.assign(
            new Error('Não foi possível confirmar os dados de contato. Verifique-os ou entre em contato com a clínica.'),
            { statusCode: 409 }
          );
        }

        await checkPlanLimit(client, clinic.id, 'patients');
        const insertedPatient = await client.query(
          `INSERT INTO patients (clinic_id, name, phone, email, status)
           VALUES ($1, $2, $3, $4, 'active')
           RETURNING id`,
          [clinic.id, req.body.name.trim(), req.body.phone.trim(), normalizedEmail || null]
        );
        const patientId = insertedPatient.rows[0].id;

        const code = `PUB-${randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`;
        const inserted = await client.query(
          `INSERT INTO appointments (
             clinic_id, patient_id, professional_id, service_id,
             service_name_snapshot, service_price_snapshot, service_duration_snapshot,
             scheduled_start, scheduled_end, status, code, public_idempotency_key
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled', $10, $11)
           RETURNING id, code`,
          [
            clinic.id,
            patientId,
            req.body.professionalId,
            service.id,
            service.name,
            service.price,
            durationMinutes,
            req.body.scheduledStart,
            endTime,
            code,
            req.body.idempotencyKey,
          ]
        );
        await auditLogger({
          clinicId: clinic.id,
          userId: null,
          entityType: 'appointments',
          entityId: inserted.rows[0].id,
          action: 'public_created',
          details: {
            code: inserted.rows[0].code,
            serviceId: service.id,
            professionalId: req.body.professionalId,
            scheduledStart: req.body.scheduledStart,
          },
        }, client);
        const confirmation = await loadPublicConfirmation(client, clinic, inserted.rows[0].code);
        return { status: 201, confirmation };
      });

      return res.status(result.status).json({ ok: true, data: result.confirmation });
    } catch (error) {
      if (isContactConflict(error)) {
        return res.status(error.statusCode).json({ ok: false, message: error.message });
      }
      if (error instanceof PlanAccessError) {
        return res.status(error.statusCode).json(error.response);
      }
      if (error.constraint === 'ex_appointments_no_overlapping_professional') {
        return res.status(409).json({ ok: false, message: 'Esse horário acabou de ser ocupado. Escolha outro horário.' });
      }
      if (error.code === '23505' && error.constraint === 'uq_appointments_clinic_id_idempotency_key') {
        return res.status(409).json({ ok: false, message: 'A solicitação já foi processada.' });
      }
      return next(error);
    }
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const statusCode = [400, 404, 409].includes(error.statusCode) ? error.statusCode : 500;
    if (statusCode === 500) {
      console.error('Public booking request failed', { requestId: req.requestId });
    }
    return res.status(statusCode).json({
      ok: false,
      message: statusCode === 500 ? 'Não foi possível concluir o agendamento.' : error.message,
      requestId: req.requestId,
    });
  });

  return router;
}

async function loadPublicConfirmation(client, clinic, code) {
  const result = await client.query(
    `SELECT a.code, a.service_name_snapshot, a.service_price_snapshot,
            a.service_duration_snapshot, a.scheduled_start, a.scheduled_end,
            p.name AS patient_name, p.phone AS patient_phone, p.email AS patient_email,
            pr.name AS professional_name,
            COALESCE(NULLIF(trim(cc.name), ''), NULLIF(trim(c.trade_name), ''), c.name) AS public_name,
            cc.phone AS public_phone, cc.whatsapp AS public_whatsapp,
            cc.address_line1 AS public_address
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id AND p.clinic_id = a.clinic_id
     JOIN professionals pr ON pr.id = a.professional_id AND pr.clinic_id = a.clinic_id
     JOIN clinics c ON c.id = a.clinic_id
     JOIN clinic_configurations cc ON cc.clinic_id = c.id
     WHERE a.clinic_id = $1 AND a.code = $2`,
    [clinic.id, code]
  );
  if (!result.rowCount) {
    throw Object.assign(new Error('Não foi possível carregar a confirmação.'), { statusCode: 500 });
  }
  return publicAppointment(result.rows[0]);
}
