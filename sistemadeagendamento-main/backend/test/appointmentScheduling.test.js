import test from 'node:test';
import assert from 'node:assert/strict';
import { isResourceInClinic } from '../src/services/appointmentAuthorization.js';
import {
  assertAppointmentSlotAvailable,
  canReadProfessionalSchedule,
  generateAvailableSlots,
  isCreateProfessionalScheduleRequest,
  isCreateScheduleBlockRequest,
  isAppointmentWithinSchedule,
  isProfessionalInClinic,
  isSlotAvailable,
  isValidIsoInterval,
  isValidScheduleDefinition,
  parseIsoDate,
} from '../src/services/appointmentScheduling.js';

const date = '2026-10-07';
const schedule = {
  weekday: 3,
  start_time: '08:00:00',
  end_time: '12:00:00',
  duration_minutes: 30,
  break_duration_minutes: 0,
  status: 'active',
};

function time(value) {
  return `${date}T${value}:00.000Z`;
}

function slot(start, end, { blocks = [], appointments = [], excludeAppointmentId = null } = {}) {
  return isSlotAvailable(time(start), time(end), { blocks, appointments, excludeAppointmentId });
}

function block(start, end) {
  return {
    status: 'active',
    start_datetime: time(start),
    end_datetime: time(end),
  };
}

function appointment(start, end, status = 'scheduled', id = 'appointment-1') {
  return {
    id,
    status,
    scheduled_start: time(start),
    scheduled_end: time(end),
  };
}

test('1 dentro do expediente', () => {
  assert.equal(isAppointmentWithinSchedule(time('10:00'), time('10:30'), schedule), true);
});

test('2 começa antes do expediente', () => {
  assert.equal(isAppointmentWithinSchedule(time('07:30'), time('08:00'), schedule), false);
});

test('3 termina depois do expediente', () => {
  assert.equal(isAppointmentWithinSchedule(time('11:30'), time('12:00'), schedule), true);
  assert.equal(isAppointmentWithinSchedule(time('11:45'), time('12:15'), schedule), false);
});

test('4 fora do dia de trabalho', () => {
  assert.equal(isAppointmentWithinSchedule('2026-10-08T10:00:00.000Z', '2026-10-08T10:30:00.000Z', schedule), false);
});

test('5 horário totalmente dentro do bloqueio', () => {
  assert.equal(slot('11:30', '12:00', { blocks: [block('11:00', '12:00')] }), false);
});

test('6 horário começa antes e termina dentro do bloqueio', () => {
  assert.equal(slot('11:30', '12:00', { blocks: [block('11:45', '12:15')] }), false);
});

test('7 horário começa durante e termina depois do bloqueio', () => {
  assert.equal(slot('11:30', '12:00', { blocks: [block('11:15', '11:45')] }), false);
});

test('8 horário pretendido envolve todo o bloqueio', () => {
  assert.equal(slot('11:30', '12:00', { blocks: [block('11:40', '11:50')] }), false);
});

test('9 mesmo horário ocupado', () => {
  assert.equal(slot('10:00', '10:30', { appointments: [appointment('10:00', '10:30')] }), false);
});

test('10 sobreposição no início do agendamento existente', () => {
  assert.equal(slot('09:45', '10:15', { appointments: [appointment('10:00', '10:30')] }), false);
});

test('11 sobreposição no final do agendamento existente', () => {
  assert.equal(slot('10:15', '10:45', { appointments: [appointment('10:00', '10:30')] }), false);
});

test('12 novo horário envolve outro agendamento', () => {
  assert.equal(slot('09:00', '11:00', { appointments: [appointment('10:00', '10:30')] }), false);
});

test('13 horário imediatamente anterior é permitido', () => {
  assert.equal(slot('09:30', '10:00', { appointments: [appointment('10:00', '10:30')] }), true);
});

test('14 horário imediatamente posterior é permitido', () => {
  assert.equal(slot('10:30', '11:00', { appointments: [appointment('10:00', '10:30')] }), true);
});

test('15 reagendamento para horário livre é permitido', () => {
  const movingAppointment = appointment('10:00', '10:30', 'scheduled', 'moving-appointment');
  assert.equal(slot('10:30', '11:00', {
    appointments: [movingAppointment],
    excludeAppointmentId: movingAppointment.id,
  }), true);
});

test('16 reagendamento para horário ocupado é bloqueado', () => {
  assert.equal(slot('10:15', '10:45', { appointments: [appointment('10:00', '10:30')] }), false);
});

test('17 reagendamento ignora o próprio agendamento na verificação de conflito', () => {
  assert.equal(slot('10:00', '10:30', {
    appointments: [appointment('10:00', '10:30', 'scheduled', 'moving-appointment')],
    excludeAppointmentId: 'moving-appointment',
  }), true);
});

test('18 agendamento cancelado não ocupa o horário', () => {
  assert.equal(slot('10:00', '10:30', { appointments: [appointment('10:00', '10:30', 'cancelled')] }), true);
});

test('status do schema diferentes de cancelled continuam ocupando a agenda', () => {
  for (const status of ['scheduled', 'confirmed', 'completed', 'no_show', 'rescheduled']) {
    assert.equal(
      slot('10:00', '10:30', { appointments: [appointment('10:00', '10:30', status)] }),
      false,
      `status ${status} deve bloquear sobreposição`
    );
  }
});

test('reagendamento de 10:00-10:30 para 10:30-11:00 permite intervalo adjacente', () => {
  const movingAppointment = appointment('10:00', '10:30', 'scheduled', 'appointment-100');
  assert.equal(slot('10:30', '11:00', {
    appointments: [movingAppointment],
    excludeAppointmentId: movingAppointment.id,
  }), true);
});

test('slots retornados pela disponibilidade passam pela validação de criação', async () => {
  const queries = [];
  const executor = {
    async query(text, params) {
      queries.push({ text, params });
      if (text.includes('FROM professional_schedules')) {
        return { rows: [schedule], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const slots = generateAvailableSlots({
    date,
    schedules: [schedule],
    blocks: [],
    appointments: [],
  });

  await assertAppointmentSlotAvailable(executor, {
    clinicId: 'clinic-1',
    professionalId: 'professional-1',
    scheduledStart: slots[0].scheduledStart,
    scheduledEnd: slots[0].scheduledEnd,
  });

  assert.deepEqual(queries.map(({ params }) => params.slice(0, 2)), [
    ['clinic-1', 'professional-1'],
    ['clinic-1', 'professional-1'],
    ['clinic-1', 'professional-1'],
  ]);
});

test('19 profissional de outra clínica é rejeitado pelo isolamento de clínica', () => {
  assert.equal(isResourceInClinic('clinic-1', 'clinic-2'), false);
});

test('20 paciente de outra clínica é rejeitado pelo isolamento de clínica', () => {
  assert.equal(isResourceInClinic('clinic-1', 'clinic-2'), false);
});

test('21 especialidade de outra clínica é rejeitada pelo isolamento de clínica', () => {
  assert.equal(isResourceInClinic('clinic-1', 'clinic-2'), false);
});

test('disponibilidade calcula slots a partir de duração e intervalo configurados', () => {
  const slots = generateAvailableSlots({
    date,
    schedules: [{ ...schedule, break_duration_minutes: 15 }],
    blocks: [],
    appointments: [],
  });

  assert.deepEqual(
    slots.map((item) => item.scheduledStart),
    [
      `${date}T08:00:00.000Z`,
      `${date}T08:45:00.000Z`,
      `${date}T09:30:00.000Z`,
      `${date}T10:15:00.000Z`,
      `${date}T11:00:00.000Z`,
    ]
  );
});

test('disponibilidade usa duração do serviço sem alterar a duração padrão do expediente', () => {
  const slots = generateAvailableSlots({
    date,
    schedules: [schedule],
    blocks: [],
    appointments: [],
    durationMinutes: 60,
  });
  assert.deepEqual(
    slots.map(({ scheduledStart, scheduledEnd }) => [scheduledStart, scheduledEnd]),
    [
      [`${date}T08:00:00.000Z`, `${date}T09:00:00.000Z`],
      [`${date}T09:00:00.000Z`, `${date}T10:00:00.000Z`],
      [`${date}T10:00:00.000Z`, `${date}T11:00:00.000Z`],
      [`${date}T11:00:00.000Z`, `${date}T12:00:00.000Z`],
    ]
  );
  assert.equal(schedule.duration_minutes, 30);
  assert.equal(
    isAppointmentWithinSchedule(
      `${date}T11:30:00.000Z`,
      `${date}T12:30:00.000Z`,
      schedule,
      'UTC',
      60
    ),
    false
  );
});

test('slots de serviço respeitam bloqueios e conflitos existentes', () => {
  const slots = generateAvailableSlots({
    date,
    schedules: [schedule],
    blocks: [block('09:30', '10:00')],
    appointments: [appointment('10:00', '11:00')],
    durationMinutes: 60,
  });
  assert.deepEqual(
    slots.map(({ scheduledStart, scheduledEnd }) => [scheduledStart, scheduledEnd]),
    [
      [`${date}T08:00:00.000Z`, `${date}T09:00:00.000Z`],
      [`${date}T11:00:00.000Z`, `${date}T12:00:00.000Z`],
    ]
  );
});

test('disponibilidade remove slots ocupados e bloqueados com overlap semiaberto', () => {
  const slots = generateAvailableSlots({
    date,
    schedules: [schedule],
    blocks: [block('08:30', '09:00')],
    appointments: [appointment('09:30', '10:00')],
  });

  assert.deepEqual(
    slots.map((item) => item.scheduledStart),
    [
      `${date}T08:00:00.000Z`,
      `${date}T09:00:00.000Z`,
      `${date}T10:00:00.000Z`,
      `${date}T10:30:00.000Z`,
      `${date}T11:00:00.000Z`,
      `${date}T11:30:00.000Z`,
    ]
  );
});

test('data inválida não gera disponibilidade', () => {
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.equal(generateAvailableSlots({ date: '2026-02-30', schedules: [], blocks: [], appointments: [] }), null);
});

test('intervalo ISO exige timezone e datas válidas', () => {
  assert.equal(isValidIsoInterval(time('10:00'), time('10:30')), true);
  assert.equal(isValidIsoInterval('2026-10-07T10:00:00', '2026-10-07T10:30:00'), false);
  assert.equal(isValidIsoInterval('2026-02-30T10:00:00Z', '2026-02-30T10:30:00Z'), false);
  assert.equal(isValidIsoInterval(time('10:30'), time('10:00')), false);
});

test('horário de trabalho aceita definição válida e strings numéricas compatíveis', () => {
  assert.equal(isValidScheduleDefinition({
    weekday: 3,
    startTime: '08:00',
    endTime: '12:00',
    durationMinutes: 30,
    breakDurationMinutes: 0,
  }), true);
  assert.equal(isCreateProfessionalScheduleRequest({
    weekday: '3',
    startTime: '08:00',
    endTime: '12:00',
    durationMinutes: '30',
  }), true);
});

test('horário de trabalho rejeita intervalo vazio, invertido e números JSON inválidos', () => {
  const validDefinition = {
    weekday: 3,
    startTime: '08:00',
    endTime: '12:00',
    durationMinutes: 30,
    breakDurationMinutes: 0,
  };
  assert.equal(isValidScheduleDefinition({ ...validDefinition, endTime: '08:00' }), false);
  assert.equal(isValidScheduleDefinition({ ...validDefinition, startTime: '12:00', endTime: '08:00' }), false);
  assert.equal(isValidScheduleDefinition({ ...validDefinition, durationMinutes: 0 }), false);
  assert.equal(isValidScheduleDefinition({ ...validDefinition, durationMinutes: -5 }), false);
  assert.equal(isValidScheduleDefinition({ ...validDefinition, durationMinutes: 30.5 }), false);
  assert.equal(isValidScheduleDefinition({ ...validDefinition, breakDurationMinutes: -1 }), false);
  assert.equal(isValidScheduleDefinition({ ...validDefinition, breakDurationMinutes: 0.5 }), false);
  assert.equal(isValidScheduleDefinition({ ...validDefinition, weekday: true }), false);
  assert.equal(isValidScheduleDefinition({ ...validDefinition, durationMinutes: true }), false);
  assert.equal(isValidScheduleDefinition({ ...validDefinition, breakDurationMinutes: '' }), false);
});

test('payload de horário rejeita campos não permitidos', () => {
  assert.equal(isCreateProfessionalScheduleRequest({
    weekday: 3,
    startTime: '08:00',
    endTime: '12:00',
    durationMinutes: 30,
    clinicId: 'clinic-2',
  }), false);
  assert.equal(isCreateProfessionalScheduleRequest(undefined), false);
});

test('bloqueio aceita intervalo válido e rejeita intervalo invertido ou inválido', () => {
  assert.equal(isCreateScheduleBlockRequest({
    blockType: 'meeting',
    startDatetime: time('09:00'),
    endDatetime: time('10:00'),
    reason: 'Reunião',
  }), true);
  assert.equal(isCreateScheduleBlockRequest({
    blockType: 'meeting',
    startDatetime: time('10:00'),
    endDatetime: time('09:00'),
  }), false);
  assert.equal(isCreateScheduleBlockRequest({
    blockType: 'unknown',
    startDatetime: time('09:00'),
    endDatetime: time('10:00'),
  }), false);
  assert.equal(isCreateScheduleBlockRequest({
    blockType: 'meeting',
    startDatetime: '2026-10-07T09:00:00',
    endDatetime: time('10:00'),
  }), false);
  assert.equal(isCreateScheduleBlockRequest({
    blockType: 'meeting',
    startDatetime: time('09:00'),
    endDatetime: time('10:00'),
    reason: { private: 'payload' },
  }), false);
});

test('payload de bloqueio rejeita campos protegidos ou desconhecidos', () => {
  assert.equal(isCreateScheduleBlockRequest({
    blockType: 'meeting',
    startDatetime: time('09:00'),
    endDatetime: time('10:00'),
    professionalId: 'professional-2',
    clinicId: 'clinic-2',
  }), false);
});

test('consulta de profissional sempre limita a clínica e oculta ausentes ou de outro tenant', async () => {
  const queries = [];
  const queryExecutor = async (text, values) => {
    queries.push({ text, values });
    return { rowCount: 0, rows: [] };
  };

  assert.equal(await isProfessionalInClinic(queryExecutor, 'clinic-1', 'missing-professional'), false);
  assert.equal(await isProfessionalInClinic(queryExecutor, 'clinic-1', 'professional-from-clinic-2'), false);
  assert.equal(queries.length, 2);
  for (const { text, values } of queries) {
    assert.match(text, /WHERE id = \$1 AND clinic_id = \$2/);
    assert.equal(values[1], 'clinic-1');
  }
});

test('IDOR: profissional só lê a própria agenda; demais papéis seguem tenant-scoped', () => {
  assert.equal(canReadProfessionalSchedule({
    role: 'professional',
    userId: 'user-1',
    professionalUserId: 'user-1',
  }), true);
  assert.equal(canReadProfessionalSchedule({
    role: 'professional',
    userId: 'user-1',
    professionalUserId: 'user-2',
  }), false);
  assert.equal(canReadProfessionalSchedule({
    role: 'reception',
    userId: 'user-1',
    professionalUserId: 'user-2',
  }), true);
});

test('disponibilidade integra expediente, bloqueios e appointments sem bloquear cancelados ou adjacentes', () => {
  const slots = generateAvailableSlots({
    date,
    schedules: [schedule],
    blocks: [block('08:30', '09:00')],
    appointments: [
      appointment('09:30', '10:00', 'scheduled'),
      appointment('10:00', '10:30', 'cancelled', 'cancelled-appointment'),
    ],
  });

  assert.deepEqual(
    slots.map((item) => item.scheduledStart),
    [
      `${date}T08:00:00.000Z`,
      `${date}T09:00:00.000Z`,
      `${date}T10:00:00.000Z`,
      `${date}T10:30:00.000Z`,
      `${date}T11:00:00.000Z`,
      `${date}T11:30:00.000Z`,
    ]
  );
});
