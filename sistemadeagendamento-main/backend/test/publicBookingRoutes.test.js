import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import test from 'node:test';
import { createPublicBookingRouter } from '../src/routes/publicBookingRouterFactory.js';

const clinicA = '11111111-1111-4111-8111-111111111111';
const clinicB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const serviceA = '44444444-4444-4444-8444-444444444444';
const serviceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const professionalA = '22222222-2222-4222-8222-222222222222';
const professionalB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const patientB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const idempotencyKey = '99999999-9999-4999-8999-999999999999';
const date = '2026-10-07';

const bookingRequest = {
  idempotencyKey,
  serviceId: serviceA,
  professionalId: professionalA,
  scheduledStart: `${date}T08:00:00.000Z`,
  name: 'Cliente Exemplo',
  phone: '+55 (11) 98765-4321',
  email: 'cliente@example.invalid',
};

function createFixture({
  timezone = 'UTC',
  durationMinutes = 60,
  blocks = [],
  appointments = [],
  patients = [{ id: patientB, clinic_id: clinicB, name: 'Cliente Exemplo', phone: bookingRequest.phone, email: bookingRequest.email, status: 'active' }],
  serviceAvailable = true,
  professionalAvailable = true,
  serviceActive = true,
  professionalStatus = 'active',
  bookingLimit = (_req, _res, next) => next(),
} = {}) {
  const queries = [];
  const state = {
    clinics: [{ id: clinicA, slug: 'clinic-a', timezone, name: 'Clínica A', tradeName: null, status: 'active' }],
    services: [
      { id: serviceA, clinic_id: clinicA, name: 'Limpeza', description: 'Atendimento', duration_minutes: durationMinutes, price: '100.00', is_active: serviceActive },
      { id: serviceB, clinic_id: clinicB, name: 'Serviço B', description: null, duration_minutes: 30, price: '50.00', is_active: true },
      { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', clinic_id: clinicA, name: 'Desativado', duration_minutes: 30, price: '25.00', is_active: false },
    ],
    professionals: [
      { id: professionalA, clinic_id: clinicA, name: 'Profissional A', status: professionalStatus, service_id: serviceA },
      { id: professionalB, clinic_id: clinicB, name: 'Profissional B', status: 'active', service_id: serviceB },
    ],
    patients: patients.map((patient) => ({ ...patient })),
    blocks: blocks.map((block) => ({ ...block, status: 'active' })),
    appointments: appointments.map((appointment) => ({ ...appointment })),
  };
  const schedule = {
    weekday: 3,
    start_time: '08:00:00',
    end_time: '12:00:00',
    duration_minutes: 30,
    break_duration_minutes: 0,
    status: 'active',
  };

  async function queryHandler(text, params = []) {
    queries.push({ text, params });
    if (text.includes('SELECT c.id AS clinic_id')) {
      const clinic = state.clinics.find((item) => item.slug === params[0] && item.status === 'active');
      return clinic
        ? { rows: [{ clinic_id: clinic.id, trade_name: clinic.tradeName, configured_name: clinic.name, public_phone: '555-0100', public_whatsapp: null, public_address: 'Rua Pública', public_email: null, timezone: clinic.timezone }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (text.includes('FROM services s') && text.includes('SELECT s.id, s.name, s.duration_minutes')) {
      return {
        rows: state.services
          .filter((service) =>
            service.clinic_id === params[0] &&
            service.is_active &&
            state.professionals.some((professional) =>
              professional.clinic_id === service.clinic_id &&
              professional.service_id === service.id &&
              professional.status === 'active'
            )
          )
          .map(({ id, name, duration_minutes, price }) => ({ id, name, duration_minutes, price })),
        rowCount: 1,
      };
    }
    if (text.includes('FROM services s') && text.includes('SELECT p.id, p.name')) {
      return {
        rows: state.professionals
          .filter((professional) =>
            professional.service_id === params[0] &&
            professional.clinic_id === params[1] &&
            professional.status === 'active' &&
            state.services.some((service) =>
              service.id === params[0] && service.clinic_id === params[1] && service.is_active
            )
          )
          .map(({ id, name }) => ({ id, name })),
        rowCount: 1,
      };
    }
    if (text.includes('SELECT s.duration_minutes')) {
      const service = state.services.find((item) =>
        item.id === params[0] && item.clinic_id === params[1] && item.is_active
      );
      const professional = state.professionals.find((item) =>
        item.id === params[2] && item.clinic_id === params[1] && item.status === 'active' && item.service_id === params[0]
      );
      return serviceAvailable && professionalAvailable && service && professional
        ? { rows: [{ duration_minutes: service.duration_minutes }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (text.includes('FROM professional_schedules')) return { rows: [schedule], rowCount: 1 };
    if (text.includes('FROM schedule_blocks')) {
      return { rows: state.blocks.filter((block) => block.clinic_id === params[0] && block.professional_id === params[1]), rowCount: 0 };
    }
    if (text.includes('SELECT id, scheduled_start, scheduled_end, status')) {
      return { rows: state.appointments.filter((item) => item.clinic_id === params[0] && item.professional_id === params[1]), rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }

  async function transactionHandler(text, params = []) {
    queries.push({ text, params, transaction: true });
    if (text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (text.includes('SELECT c.id, cc.timezone')) {
      const clinic = state.clinics.find((item) =>
        item.id === params[0] && item.slug === params[1] && item.status === 'active'
      );
      return clinic
        ? { rows: [{ id: clinic.id, timezone: clinic.timezone }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (text.includes('SELECT a.code, a.clinic_id')) {
      const prior = state.appointments.find((item) =>
        item.clinic_id === params[0] && item.public_idempotency_key === params[1]
      );
      if (!prior) return { rows: [], rowCount: 0 };
      const patient = state.patients.find((item) => item.id === prior.patient_id);
      return {
        rows: [{
          ...prior,
          patient_name: patient.name,
          patient_phone: patient.phone,
          patient_email: patient.email,
        }],
        rowCount: 1,
      };
    }
    if (text.includes('SELECT s.id, s.name, s.price')) {
      const service = state.services.find((item) =>
        item.id === params[0] && item.clinic_id === params[1] && item.is_active
      );
      const professional = state.professionals.find((item) =>
        item.id === params[2] && item.clinic_id === params[1] && item.status === 'active' && item.service_id === params[0]
      );
      return serviceAvailable && professionalAvailable && service && professional
        ? { rows: [{ id: service.id, name: service.name, price: service.price, duration_minutes: service.duration_minutes }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (text.includes('SELECT weekday, start_time')) return { rows: [schedule], rowCount: 1 };
    if (text.startsWith('SELECT id FROM appointments')) {
      const conflict = state.appointments.some((item) =>
        item.clinic_id === params[0] &&
        item.professional_id === params[1] &&
        item.status !== 'cancelled' &&
        Date.parse(item.scheduled_start) < Date.parse(params[3]) &&
        Date.parse(item.scheduled_end) > Date.parse(params[2])
      );
      return { rows: conflict ? [{ id: 'conflict' }] : [], rowCount: conflict ? 1 : 0 };
    }
    if (text.startsWith('SELECT id FROM schedule_blocks')) {
      const conflict = state.blocks.some((item) =>
        item.clinic_id === params[0] && item.professional_id === params[1] &&
        Date.parse(item.start_datetime) < Date.parse(params[3]) &&
        Date.parse(item.end_datetime) > Date.parse(params[2])
      );
      return { rows: conflict ? [{ id: 'block' }] : [], rowCount: conflict ? 1 : 0 };
    }
    if (text.includes('SELECT id, name, phone, email, status')) {
      const digits = params[1];
      const email = params[2];
      const matches = state.patients.filter((patient) =>
        patient.clinic_id === params[0] &&
        (
          (patient.phone || '').replace(/\D/g, '') === digits ||
          (email && (patient.email || '').trim().toLowerCase() === email)
        )
      );
      return { rows: matches, rowCount: matches.length };
    }
    if (text.includes('INSERT INTO patients')) {
      const patient = {
        id: 'eeeeeeee-0000-4000-8000-000000000001',
        clinic_id: params[0],
        name: params[1],
        phone: params[2],
        email: params[3],
        status: 'active',
      };
      state.patients.push(patient);
      return { rows: [{ id: patient.id }], rowCount: 1 };
    }
    if (text.includes('INSERT INTO appointments')) {
      const appointment = {
        clinic_id: params[0],
        patient_id: params[1],
        professional_id: params[2],
        service_id: params[3],
        service_name_snapshot: params[4],
        service_price_snapshot: params[5],
        service_duration_snapshot: params[6],
        scheduled_start: params[7],
        scheduled_end: params[8],
        status: 'scheduled',
        code: params[9],
        public_idempotency_key: params[10],
      };
      state.appointments.push(appointment);
      return { rows: [{ code: appointment.code }], rowCount: 1 };
    }
    if (text.includes('INSERT INTO audit_logs')) return { rows: [], rowCount: 1 };
    if (text.includes('SELECT a.code, a.service_name_snapshot')) {
      const appointment = state.appointments.find((item) => item.clinic_id === params[0] && item.code === params[1]);
      const patient = state.patients.find((item) => item.id === appointment.patient_id);
      const professional = state.professionals.find((item) => item.id === appointment.professional_id);
      const clinic = state.clinics.find((item) => item.id === appointment.clinic_id);
      return {
        rows: [{
          ...appointment,
          patient_name: patient.name,
          patient_phone: patient.phone,
          patient_email: patient.email,
          professional_name: professional.name,
          public_name: clinic.name,
          public_phone: '555-0100',
          public_whatsapp: null,
          public_address: 'Rua Pública',
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 1 };
  }

  return {
    state,
    queries,
    async start() {
      const app = express();
      app.use(express.json());
      app.use('/api/public', createPublicBookingRouter({
        queryExecutor: queryHandler,
        transactionExecutor: (callback) => callback({ query: transactionHandler }),
        auditLogger: async () => {},
        bookingRateLimit: bookingLimit,
        clinicPlanLoader: async () => ({ plan: { id: 'complete' } }),
        checkPlanLimit: async () => {},
      }));
      const server = createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      return {
        fetch: (path, init) => fetch(`http://127.0.0.1:${address.port}/api/public${path}`, init),
        close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
      };
    },
  };
}

test('public clinic and service listing exposes only active public data for the selected clinic', async () => {
  const fixture = createFixture();
  const server = await fixture.start();
  try {
    const clinicResponse = await server.fetch('/clinics/clinic-a');
    const clinicPayload = await clinicResponse.json();
    assert.equal(clinicResponse.status, 200);
    assert.deepEqual(Object.keys(clinicPayload.data).sort(), ['address', 'email', 'name', 'phone', 'timezone', 'whatsapp']);
    const servicesResponse = await server.fetch('/clinics/clinic-a/services');
    const servicePayload = await servicesResponse.json();
    assert.equal(servicesResponse.status, 200);
    assert.deepEqual(servicePayload.data.map(({ id }) => id), [serviceA]);
    assert.doesNotMatch(JSON.stringify(servicePayload), /clinic_id|password_hash|is_active/);
    assert.match(fixture.queries.find(({ text }) => text.includes('SELECT s.id, s.name, s.duration_minutes')).text, /s\.is_active = TRUE/);
    assert.match(fixture.queries.find(({ text }) => text.includes('SELECT s.id, s.name, s.duration_minutes')).text, /p\.status = 'active'/);
  } finally {
    await server.close();
  }
});

test('public lookup does not return clinics without configured public slug or public name', async () => {
  const fixture = createFixture();
  const server = await fixture.start();
  try {
    const missing = await server.fetch('/clinics/clinic-b');
    assert.equal(missing.status, 404);
    const invalidSlug = await server.fetch('/clinics/clinic%27%20OR%201=1');
    assert.equal(invalidSlug.status, 404);
  } finally {
    await server.close();
  }
});

test('public professionals are restricted to active service assignments in the clinic', async () => {
  const fixture = createFixture();
  const server = await fixture.start();
  try {
    const response = await server.fetch(`/clinics/clinic-a/services/${serviceA}/professionals`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.data, [{ id: professionalA, name: 'Profissional A' }]);
    const query = fixture.queries.find(({ text }) => text.includes('SELECT p.id, p.name'));
    assert.deepEqual(query.params, [serviceA, clinicA]);
    assert.match(query.text, /s\.clinic_id = \$2/);
    assert.match(query.text, /s\.is_active = TRUE/);
    assert.match(query.text, /p\.status = 'active'/);
  } finally {
    await server.close();
  }
});

test('public availability reuses service duration, clinic timezone, blocks, and appointment conflicts', async () => {
  const fixture = createFixture({
    blocks: [{ clinic_id: clinicA, professional_id: professionalA, start_datetime: `${date}T09:30:00.000Z`, end_datetime: `${date}T10:00:00.000Z` }],
    appointments: [{ clinic_id: clinicA, professional_id: professionalA, scheduled_start: `${date}T10:00:00.000Z`, scheduled_end: `${date}T11:00:00.000Z`, status: 'scheduled' }],
  });
  const server = await fixture.start();
  try {
    const response = await server.fetch(`/clinics/clinic-a/services/${serviceA}/professionals/${professionalA}/availability?date=${date}`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.data.map(({ scheduledStart, scheduledEnd }) => [scheduledStart, scheduledEnd]), [
      [`${date}T08:00:00.000Z`, `${date}T09:00:00.000Z`],
      [`${date}T11:00:00.000Z`, `${date}T12:00:00.000Z`],
    ]);
    assert.match(fixture.queries.find(({ text }) => text.includes('SELECT s.duration_minutes')).text, /s\.clinic_id = \$2/);
  } finally {
    await server.close();
  }
});

test('public availability uses clinic timezone rather than server-local time', async () => {
  const fixture = createFixture({ timezone: 'America/Sao_Paulo', durationMinutes: 60 });
  const server = await fixture.start();
  try {
    const response = await server.fetch(`/clinics/clinic-a/services/${serviceA}/professionals/${professionalA}/availability?date=${date}`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.data.map(({ scheduledStart }) => scheduledStart), [
      `${date}T11:00:00.000Z`,
      `${date}T12:00:00.000Z`,
      `${date}T13:00:00.000Z`,
      `${date}T14:00:00.000Z`,
    ]);
  } finally {
    await server.close();
  }
});

test('public appointment derives duration and price from the active tenant service and returns an allowlisted confirmation', async () => {
  const fixture = createFixture();
  const server = await fixture.start();
  try {
    const response = await server.fetch('/clinics/clinic-a/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingRequest),
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.data.service.name, 'Limpeza');
    assert.equal(payload.data.service.price, 100);
    assert.equal(payload.data.service.durationMinutes, 60);
    assert.equal(payload.data.scheduledEnd, `${date}T09:00:00.000Z`);
    assert.deepEqual(Object.keys(payload.data).sort(), ['clinic', 'code', 'customer', 'professional', 'scheduledEnd', 'scheduledStart', 'service']);
    assert.doesNotMatch(JSON.stringify(payload), /clinic_id|patient_id|professional_id|service_id|password_hash|notes/);
    const appointmentInsert = fixture.queries.find(({ text }) => text.includes('INSERT INTO appointments'));
    assert.deepEqual(appointmentInsert.params.slice(3, 9), [
      serviceA, 'Limpeza', '100.00', 60, bookingRequest.scheduledStart, `${date}T09:00:00.000Z`,
    ]);
    const transactionQueries = fixture.queries.filter(({ transaction }) => transaction);
    const idempotencyLock = transactionQueries.findIndex(({ text, params }) =>
      text.includes('pg_advisory_xact_lock') && params[0].startsWith(`public-booking:${clinicA}:`)
    );
    const professionalLock = transactionQueries.findIndex(({ text, params }) =>
      text.includes('pg_advisory_xact_lock') && params[0] === professionalA
    );
    const conflictCheck = transactionQueries.findIndex(({ text }) => text.startsWith('SELECT id FROM appointments'));
    const appointmentWrite = transactionQueries.findIndex(({ text }) => text.includes('INSERT INTO appointments'));
    assert.ok(idempotencyLock >= 0 && idempotencyLock < professionalLock);
    assert.ok(professionalLock < conflictCheck && conflictCheck < appointmentWrite);
    assert.equal(fixture.state.patients.find((patient) => patient.clinic_id === clinicA).name, bookingRequest.name);
  } finally {
    await server.close();
  }
});

test('public booking rejects a foreign or incompatible service/professional combination', async () => {
  for (const body of [
    { ...bookingRequest, professionalId: professionalB },
    { ...bookingRequest, serviceId: serviceB },
    { ...bookingRequest, professionalId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
    { ...bookingRequest, serviceId: '88888888-8888-4888-8888-888888888888' },
  ]) {
    const fixture = createFixture();
    const server = await fixture.start();
    try {
      const response = await server.fetch('/clinics/clinic-a/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 404);
      assert.equal(fixture.state.appointments.length, 0);
    } finally {
      await server.close();
    }
  }
});

test('public booking rejects fabricated, out-of-hours, blocked, and conflicting starts', async () => {
  const cases = [
    { body: { ...bookingRequest, scheduledStart: `${date}T08:30:00.000Z` } },
    { body: { ...bookingRequest, scheduledStart: `${date}T11:30:00.000Z` } },
    { body: bookingRequest, blocks: [{ clinic_id: clinicA, professional_id: professionalA, start_datetime: `${date}T08:30:00.000Z`, end_datetime: `${date}T09:30:00.000Z` }] },
    { body: bookingRequest, appointments: [{ clinic_id: clinicA, professional_id: professionalA, scheduled_start: `${date}T08:00:00.000Z`, scheduled_end: `${date}T09:00:00.000Z`, status: 'scheduled' }] },
  ];
  for (const item of cases) {
    const fixture = createFixture(item);
    const server = await fixture.start();
    try {
      const response = await server.fetch('/clinics/clinic-a/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.body),
      });
      assert.equal(response.status, 409);
      assert.equal(fixture.state.appointments.length, item.appointments?.length || 0);
    } finally {
      await server.close();
    }
  }
});

test('public booking does not reuse a patient belonging to another clinic', async () => {
  const fixture = createFixture();
  const server = await fixture.start();
  try {
    const response = await server.fetch('/clinics/clinic-a/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingRequest),
    });
    assert.equal(response.status, 201);
    assert.equal(fixture.state.appointments[0].clinic_id, clinicA);
    assert.notEqual(fixture.state.appointments[0].patient_id, patientB);
  } finally {
    await server.close();
  }
});

test('public booking scopes matching patients by clinic and uses parameterized contact queries', async () => {
  const fixture = createFixture();
  const server = await fixture.start();
  try {
    const response = await server.fetch('/clinics/clinic-a/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingRequest),
    });
    assert.equal(response.status, 201);
    const contactQuery = fixture.queries.find(({ text }) => text.includes('SELECT id, name, phone, email, status'));
    assert.match(contactQuery.text, /WHERE clinic_id = \$1/);
    assert.deepEqual(contactQuery.params.slice(0, 3), [clinicA, '5511987654321', 'cliente@example.invalid']);
    assert.equal(fixture.state.patients.find((patient) => patient.id === patientB).clinic_id, clinicB);
    assert.notEqual(fixture.state.appointments[0].patient_id, patientB);
  } finally {
    await server.close();
  }
});

test('public booking never links an existing patient without contact verification', async () => {
  const currentClinicPatient = {
    id: 'eeeeeeee-0000-4000-8000-000000000010',
    clinic_id: clinicA,
    name: bookingRequest.name,
    phone: bookingRequest.phone,
    email: bookingRequest.email,
    status: 'active',
  };
  const fixture = createFixture({ patients: [currentClinicPatient] });
  const server = await fixture.start();
  try {
    const response = await server.fetch('/clinics/clinic-a/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingRequest),
    });
    assert.equal(response.status, 409);
    assert.equal(fixture.state.patients.length, 1);
    assert.equal(fixture.state.appointments.length, 0);
  } finally {
    await server.close();
  }
});

test('public booking rejects customer fields that enable mass assignment or price/duration manipulation', async () => {
  for (const extraField of [
    { clinicId: clinicB },
    { price: 1 },
    { durationMinutes: 1 },
    { professional_id: professionalB },
    { service_id: serviceB },
    { patientId: patientB },
    { notes: 'unexpected' },
  ]) {
    const fixture = createFixture();
    const server = await fixture.start();
    try {
      const response = await server.fetch('/clinics/clinic-a/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bookingRequest, ...extraField }),
      });
      assert.equal(response.status, 400);
      assert.equal(fixture.state.appointments.length, 0);
    } finally {
      await server.close();
    }
  }
});

test('public booking rejects missing and malformed required fields', async () => {
  for (const body of [
    { ...bookingRequest, name: '' },
    { ...bookingRequest, phone: '123' },
    { ...bookingRequest, scheduledStart: 'not-a-date' },
    { ...bookingRequest, email: 'not-an-email' },
    { ...bookingRequest, professionalId: 'invalid' },
  ]) {
    const fixture = createFixture();
    const server = await fixture.start();
    try {
      const response = await server.fetch('/clinics/clinic-a/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.equal(fixture.queries.some(({ text }) => text.includes('INSERT INTO appointments')), false);
    } finally {
      await server.close();
    }
  }
});

test('idempotent retries return the original confirmation and mismatched reuse is rejected', async () => {
  const fixture = createFixture({ patients: [] });
  const server = await fixture.start();
  try {
    const first = await server.fetch('/clinics/clinic-a/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingRequest),
    });
    const firstPayload = await first.json();
    const retry = await server.fetch('/clinics/clinic-a/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingRequest),
    });
    const retryPayload = await retry.json();
    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.deepEqual(retryPayload.data, firstPayload.data);
    assert.equal(fixture.state.appointments.length, 1);
    assert.equal(fixture.state.patients.length, 1);

    const changed = await server.fetch('/clinics/clinic-a/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...bookingRequest, name: 'Outra Pessoa' }),
    });
    assert.equal(changed.status, 409);
    assert.equal(fixture.state.appointments.length, 1);
  } finally {
    await server.close();
  }
});

test('public create endpoint applies its dedicated rate-limit middleware before touching data', async () => {
  let consumed = false;
  const fixture = createFixture({
    bookingLimit(_req, res) {
      consumed = true;
      return res.status(429).json({ ok: false, message: 'Muitas tentativas.' });
    },
  });
  const server = await fixture.start();
  try {
    const response = await server.fetch('/clinics/clinic-a/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingRequest),
    });
    assert.equal(consumed, true);
    assert.equal(response.status, 429);
    assert.equal(fixture.queries.length, 0);
  } finally {
    await server.close();
  }
});

test('public booking service refuses inactive and unassigned resources', async () => {
  for (const options of [{ serviceActive: false }, { professionalStatus: 'inactive' }, { serviceAvailable: false }]) {
    const fixture = createFixture(options);
    const server = await fixture.start();
    try {
      const response = await server.fetch('/clinics/clinic-a/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingRequest),
      });
      assert.equal(response.status, 404);
      assert.equal(fixture.state.appointments.length, 0);
    } finally {
      await server.close();
    }
  }
});

test('public booking SQL-injection-like contact values remain bound parameters', async () => {
  const injectionText = "' OR 1=1; --";
  const fixture = createFixture({ patients: [] });
  const server = await fixture.start();
  try {
    const response = await server.fetch('/clinics/clinic-a/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...bookingRequest, name: injectionText }),
    });
    assert.equal(response.status, 201);
    const patientInsert = fixture.queries.find(({ text }) => text.includes('INSERT INTO patients'));
    assert.match(patientInsert.text, /VALUES \(\$1, \$2, \$3, \$4/);
    assert.equal(patientInsert.params[1], injectionText);
  } finally {
    await server.close();
  }
});

test('public API does not expose unauthenticated cancellation by appointment identifier', async () => {
  const fixture = createFixture();
  const server = await fixture.start();
  try {
    const response = await server.fetch('/clinics/clinic-a/appointments/some-id/cancel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
});
