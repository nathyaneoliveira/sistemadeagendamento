import { appointmentStatusOccupiesSchedule } from './appointmentRequest.js';
import {
  clinicDay,
  clinicDateAt,
  clinicLocalDateTimeToTimestamp,
  clinicTimeOfDay,
  isUniqueClinicInstant as isUniqueClinicTimestamp,
} from './clinicTime.js';

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?$/;
const INTEGER_INPUT_PATTERN = /^\d+$/;
const SCHEDULE_FIELDS = ['weekday', 'startTime', 'endTime', 'durationMinutes', 'breakDurationMinutes'];
const SCHEDULE_BLOCK_TYPES = ['vacation', 'holiday', 'meeting', 'absence', 'custom'];
const SCHEDULE_BLOCK_FIELDS = ['blockType', 'startDatetime', 'endDatetime', 'reason'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyFields(value, allowedFields) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowedFields.includes(key));
}

function isIntegerInput(value) {
  return (typeof value === 'number' && Number.isSafeInteger(value)) ||
    (typeof value === 'string' &&
      INTEGER_INPUT_PATTERN.test(value) &&
      Number.isSafeInteger(Number(value)));
}

export class AppointmentSchedulingError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.name = 'AppointmentSchedulingError';
    this.statusCode = statusCode;
  }
}

export function parseIsoDate(date, timeZone = 'UTC') {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) return null;
  return clinicDay(date, timeZone);
}

function parseIsoTimestamp(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) {
    return null;
  }

  const date = value.slice(0, 10);
  const dateTimestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (
    !Number.isFinite(dateTimestamp) ||
    new Date(dateTimestamp).toISOString().slice(0, 10) !== date
  ) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseTimeMilliseconds(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = TIME_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  const fraction = match[4] ? Number(`0.${match[4]}`) : 0;

  return ((hours * 60 + minutes) * 60 + seconds + fraction) * 1000;
}

export function isValidScheduleDefinition({ weekday, startTime, endTime, durationMinutes, breakDurationMinutes }) {
  const start = parseTimeMilliseconds(startTime);
  const end = parseTimeMilliseconds(endTime);

  return isIntegerInput(weekday) &&
    Number(weekday) >= 1 &&
    Number(weekday) <= 7 &&
    start !== null &&
    end !== null &&
    end > start &&
    isIntegerInput(durationMinutes) &&
    Number(durationMinutes) > 0 &&
    isIntegerInput(breakDurationMinutes) &&
    Number(breakDurationMinutes) >= 0;
}

export function isCreateProfessionalScheduleRequest(body) {
  if (
    !hasOnlyFields(body, SCHEDULE_FIELDS) ||
    !Object.prototype.hasOwnProperty.call(body, 'weekday') ||
    !Object.prototype.hasOwnProperty.call(body, 'startTime') ||
    !Object.prototype.hasOwnProperty.call(body, 'endTime') ||
    !Object.prototype.hasOwnProperty.call(body, 'durationMinutes')
  ) {
    return false;
  }

  return isValidScheduleDefinition({
    weekday: body.weekday,
    startTime: body.startTime,
    endTime: body.endTime,
    durationMinutes: body.durationMinutes,
    breakDurationMinutes: body.breakDurationMinutes ?? 0,
  });
}

export function isCreateScheduleBlockRequest(body) {
  return hasOnlyFields(body, SCHEDULE_BLOCK_FIELDS) &&
    SCHEDULE_BLOCK_TYPES.includes(body.blockType) &&
    isValidIsoInterval(body.startDatetime, body.endDatetime) &&
    (body.reason === undefined || body.reason === null || typeof body.reason === 'string');
}

export async function isProfessionalInClinic(queryExecutor, clinicId, professionalId) {
  const result = await queryExecutor(
    'SELECT id FROM professionals WHERE id = $1 AND clinic_id = $2',
    [professionalId, clinicId]
  );
  return result.rowCount > 0;
}

export function canReadProfessionalSchedule({ role, userId, professionalUserId }) {
  return role !== 'professional' || userId === professionalUserId;
}

export function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

export function isValidIsoInterval(start, end) {
  const startTimestamp = parseIsoTimestamp(start);
  const endTimestamp = parseIsoTimestamp(end);
  return startTimestamp !== null && endTimestamp !== null && endTimestamp > startTimestamp;
}

export function isUniqueClinicInstant(value, timeZone) {
  const timestamp = parseIsoTimestamp(value);
  return timestamp !== null && isUniqueClinicTimestamp(timestamp, timeZone);
}

export function isSlotAvailable(start, end, { blocks, appointments, excludeAppointmentId = null }) {
  const startTimestamp = typeof start === 'number' ? start : parseIsoTimestamp(start);
  const endTimestamp = typeof end === 'number' ? end : parseIsoTimestamp(end);

  if (startTimestamp === null || endTimestamp === null || endTimestamp <= startTimestamp) {
    return false;
  }

  const overlaps = (intervalStart, intervalEnd) => {
    const parsedStart = typeof intervalStart === 'number' ? intervalStart : Date.parse(intervalStart);
    const parsedEnd = typeof intervalEnd === 'number' ? intervalEnd : Date.parse(intervalEnd);
    return Number.isFinite(parsedStart) &&
      Number.isFinite(parsedEnd) &&
      intervalsOverlap(startTimestamp, endTimestamp, parsedStart, parsedEnd);
  };

  const blocked = blocks.some((block) =>
    block.status === 'active' && overlaps(block.start_datetime, block.end_datetime)
  );
  if (blocked) {
    return false;
  }

  return !appointments.some((appointment) =>
    appointmentStatusOccupiesSchedule(appointment.status) &&
    appointment.id !== excludeAppointmentId &&
    overlaps(appointment.scheduled_start, appointment.scheduled_end)
  );
}

export function isAppointmentWithinSchedule(
  start,
  end,
  schedule,
  timeZone = 'UTC',
  durationMinutesOverride
) {
  const startTimestamp = parseIsoTimestamp(start);
  const endTimestamp = parseIsoTimestamp(end);
  const scheduleStart = parseTimeMilliseconds(schedule.start_time);
  const scheduleEnd = parseTimeMilliseconds(schedule.end_time);
  const durationMinutes = durationMinutesOverride === undefined
    ? Number(schedule.duration_minutes)
    : Number(durationMinutesOverride);
  const breakMinutes = Number(schedule.break_duration_minutes || 0);

  if (
    startTimestamp === null ||
    endTimestamp === null ||
    scheduleStart === null ||
    scheduleEnd === null ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    !Number.isInteger(breakMinutes) ||
    breakMinutes < 0
  ) {
    return false;
  }

  if (
    !isUniqueClinicTimestamp(startTimestamp, timeZone) ||
    !isUniqueClinicTimestamp(endTimestamp, timeZone)
  ) {
    return false;
  }

  const startDate = clinicDay(clinicDateAt(startTimestamp, timeZone), timeZone);
  const endDate = clinicDay(clinicDateAt(endTimestamp, timeZone), timeZone);
  if (
    !startDate ||
    !endDate ||
    startDate.date !== endDate.date ||
    Number(schedule.weekday) !== startDate.weekday
  ) {
    return false;
  }

  const startOfDay = clinicTimeOfDay(startTimestamp, timeZone);
  const endOfDay = clinicTimeOfDay(endTimestamp, timeZone);
  const durationMilliseconds = durationMinutes * 60 * 1000;
  const stepMilliseconds = (durationMinutes + breakMinutes) * 60 * 1000;

  return startOfDay >= scheduleStart &&
    endOfDay <= scheduleEnd &&
    endOfDay - startOfDay === durationMilliseconds &&
    endTimestamp - startTimestamp === durationMilliseconds &&
    (startOfDay - scheduleStart) % stepMilliseconds === 0;
}

export function generateAvailableSlots({
  date,
  schedules,
  blocks,
  appointments,
  timeZone = 'UTC',
  durationMinutes: requestedDurationMinutes,
}) {
  const day = parseIsoDate(date, timeZone);
  if (!day) {
    return null;
  }

  const slotsByStart = new Map();
  for (const schedule of schedules) {
    if (schedule.status !== 'active' || Number(schedule.weekday) !== day.weekday) {
      continue;
    }

    const scheduleStart = parseTimeMilliseconds(schedule.start_time);
    const scheduleEnd = parseTimeMilliseconds(schedule.end_time);
    const durationMinutes = requestedDurationMinutes === undefined
      ? Number(schedule.duration_minutes)
      : Number(requestedDurationMinutes);
    const breakMinutes = Number(schedule.break_duration_minutes || 0);

    if (
      scheduleStart === null ||
      scheduleEnd === null ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes <= 0 ||
      !Number.isInteger(breakMinutes) ||
      breakMinutes < 0
    ) {
      continue;
    }

    const slotLength = durationMinutes * 60 * 1000;
    const slotStep = (durationMinutes + breakMinutes) * 60 * 1000;
    let localSlotStart = Date.parse(`${date}T00:00:00.000Z`) + scheduleStart;

    while (localSlotStart + slotLength <= Date.parse(`${date}T00:00:00.000Z`) + scheduleEnd) {
      const localStart = new Date(localSlotStart).toISOString().slice(0, 23);
      const slotStart = clinicLocalDateTimeToTimestamp(localStart, timeZone);
      const slotEnd = slotStart === null ? null : slotStart + slotLength;
      const scheduledStart = slotStart === null ? null : new Date(slotStart).toISOString();
      const scheduledEnd = slotEnd === null ? null : new Date(slotEnd).toISOString();

      if (
        slotStart !== null &&
        isAppointmentWithinSchedule(
          scheduledStart,
          scheduledEnd,
          schedule,
          timeZone,
          requestedDurationMinutes
        ) &&
        isSlotAvailable(slotStart, slotEnd, { blocks, appointments })
      ) {
        slotsByStart.set(scheduledStart, {
          scheduledStart,
          scheduledEnd,
          durationMinutes,
        });
      }

      localSlotStart += slotStep;
    }
  }

  return [...slotsByStart.values()].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
}

export async function assertAppointmentSlotAvailable(executor, {
  clinicId,
  professionalId,
  scheduledStart,
  scheduledEnd,
  excludeAppointmentId = null,
  timeZone = 'UTC',
  durationMinutes,
}) {
  if (!isValidIsoInterval(scheduledStart, scheduledEnd)) {
    throw new AppointmentSchedulingError('Intervalo de agendamento inválido.', 400);
  }

  const startTimestamp = parseIsoTimestamp(scheduledStart);
  if (
    !isUniqueClinicTimestamp(startTimestamp, timeZone) ||
    !isUniqueClinicTimestamp(parseIsoTimestamp(scheduledEnd), timeZone)
  ) {
    throw new AppointmentSchedulingError('Horário local inexistente ou ambíguo no fuso da clínica.', 400);
  }

  const clinicDate = clinicDateAt(startTimestamp, timeZone);
  const day = parseIsoDate(clinicDate, timeZone);
  if (!day) {
    throw new AppointmentSchedulingError('Fuso horário inválido ou data local indisponível.', 500);
  }
  const { weekday } = day;
  const schedules = await executor.query(
    `SELECT weekday, start_time, end_time, duration_minutes, break_duration_minutes
     FROM professional_schedules
     WHERE clinic_id = $1 AND professional_id = $2 AND weekday = $3 AND status = 'active'
     ORDER BY start_time`,
    [clinicId, professionalId, weekday]
  );

  if (!schedules.rows.some((schedule) =>
    isAppointmentWithinSchedule(scheduledStart, scheduledEnd, schedule, timeZone, durationMinutes)
  )) {
    throw new AppointmentSchedulingError('Horário fora da agenda de trabalho ou incompatível com a duração configurada.');
  }


  const conflict = await executor.query(
    `SELECT id FROM appointments
     WHERE clinic_id = $1
       AND professional_id = $2
       AND status <> 'cancelled'
       AND scheduled_start < $4::timestamptz
       AND scheduled_end > $3::timestamptz
       AND ($5::uuid IS NULL OR id <> $5::uuid)
     LIMIT 1`,
    [clinicId, professionalId, scheduledStart, scheduledEnd, excludeAppointmentId]
  );

  if (conflict.rowCount > 0) {
    throw new AppointmentSchedulingError('Esse horário já está ocupado.');
  }

  const block = await executor.query(
    `SELECT id FROM schedule_blocks
     WHERE clinic_id = $1
       AND professional_id = $2
       AND status = 'active'
       AND start_datetime < $4::timestamptz
       AND end_datetime > $3::timestamptz
     LIMIT 1`,
    [clinicId, professionalId, scheduledStart, scheduledEnd]
  );

  if (block.rowCount > 0) {
    throw new AppointmentSchedulingError('Este horário está bloqueado para o profissional.');
  }

  return { weekday };
}

export async function lockProfessionalSchedule(client, professionalId) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [professionalId]
  );
}
