import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clinicDay,
  clinicLocalDateTimeToTimestamp,
  isValidTimeZone,
  isUniqueClinicInstant,
} from '../src/services/clinicTime.js';
import {
  generateAvailableSlots,
  isAppointmentWithinSchedule,
  parseIsoDate,
} from '../src/services/appointmentScheduling.js';

test('aceita identificadores IANA e rejeita abreviações ambíguas', () => {
  assert.equal(isValidTimeZone('America/Sao_Paulo'), true);
  assert.equal(isValidTimeZone('Europe/Lisbon'), true);
  assert.equal(isValidTimeZone('UTC-3'), false);
  assert.equal(isValidTimeZone('Brasilia'), false);
});

test('converte horário civil da clínica em instante absoluto', () => {
  const instant = clinicLocalDateTimeToTimestamp('2026-10-02T08:00', 'America/Sao_Paulo');
  assert.equal(new Date(instant).toISOString(), '2026-10-02T11:00:00.000Z');
});

test('rejeita horários locais inexistentes e ambíguos em transições DST', () => {
  assert.equal(clinicLocalDateTimeToTimestamp('2026-03-08T02:30', 'America/New_York'), null);
  assert.equal(clinicLocalDateTimeToTimestamp('2026-11-01T01:30', 'America/New_York'), null);
});

test('calcula dias locais de 23 e 25 horas em transições DST', () => {
  const springDay = clinicDay('2026-03-08', 'America/New_York');
  const fallDay = clinicDay('2026-11-01', 'America/New_York');

  assert.equal(springDay.end - springDay.start, 23 * 60 * 60 * 1000);
  assert.equal(fallDay.end - fallDay.start, 25 * 60 * 60 * 1000);
  assert.equal(parseIsoDate('2026-10-02', 'America/Sao_Paulo').weekday, 5);
});

test('disponibilidade usa weekday e hora local da clínica, não UTC', () => {
  const slots = generateAvailableSlots({
    date: '2026-10-02',
    timeZone: 'America/Sao_Paulo',
    schedules: [{
      weekday: 5,
      start_time: '08:00:00',
      end_time: '09:00:00',
      duration_minutes: 30,
      break_duration_minutes: 0,
      status: 'active',
    }],
    blocks: [],
    appointments: [],
  });

  assert.deepEqual(slots.map(({ scheduledStart }) => scheduledStart), [
    '2026-10-02T11:00:00.000Z',
    '2026-10-02T11:30:00.000Z',
  ]);
});

test('disponibilidade não oferece slots durante gap/fold DST', () => {
  const schedule = {
    weekday: 7,
    start_time: '01:00:00',
    end_time: '04:00:00',
    duration_minutes: 30,
    break_duration_minutes: 0,
    status: 'active',
  };
  const springSlots = generateAvailableSlots({
    date: '2026-03-08',
    timeZone: 'America/New_York',
    schedules: [schedule],
    blocks: [],
    appointments: [],
  });
  const fallSlots = generateAvailableSlots({
    date: '2026-11-01',
    timeZone: 'America/New_York',
    schedules: [schedule],
    blocks: [],
    appointments: [],
  });

  assert.deepEqual(springSlots.map(({ scheduledStart }) => scheduledStart), [
    '2026-03-08T06:00:00.000Z',
    '2026-03-08T07:00:00.000Z',
    '2026-03-08T07:30:00.000Z',
  ]);
  assert.deepEqual(fallSlots.map(({ scheduledStart }) => scheduledStart), [
    '2026-11-01T07:00:00.000Z',
    '2026-11-01T07:30:00.000Z',
    '2026-11-01T08:00:00.000Z',
    '2026-11-01T08:30:00.000Z',
  ]);
});

test('validação da agenda rejeita instante ambíguo no fuso da clínica', () => {
  const firstOccurrence = '2026-11-01T05:30:00.000Z';
  assert.equal(isUniqueClinicInstant(firstOccurrence, 'America/New_York'), false);
  assert.equal(isAppointmentWithinSchedule(firstOccurrence, '2026-11-01T06:00:00.000Z', {
    weekday: 7,
    start_time: '01:00:00',
    end_time: '03:00:00',
    duration_minutes: 30,
    break_duration_minutes: 0,
  }, 'America/New_York'), false);
});
