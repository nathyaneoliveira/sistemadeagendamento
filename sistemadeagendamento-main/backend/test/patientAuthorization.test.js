import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'patient-route-tests-only-secret-32bytes-min';
const { createPatientRouter } = await import('../src/routes/patientRoutes.js');

const clinicA = 'clinic-a';
const clinicB = 'clinic-b';
const professionalUserA = 'professional-user-a';
const professionalUserB = 'professional-user-b';
const patients = [
  { id: 'patient-a', clinic_id: clinicA, name: 'Patient A' },
  { id: 'patient-b', clinic_id: clinicA, name: 'Patient B' },
  { id: 'patient-c', clinic_id: clinicA, name: 'Patient C' },
  { id: 'patient-d', clinic_id: clinicB, name: 'Patient D' },
];
const professionals = [
  { id: 'professional-a', clinic_id: clinicA, user_id: professionalUserA },
  { id: 'professional-b', clinic_id: clinicA, user_id: professionalUserB },
];
const appointments = [
  { clinic_id: clinicA, professional_id: 'professional-a', patient_id: 'patient-a', status: 'scheduled' },
  { clinic_id: clinicA, professional_id: 'professional-a', patient_id: 'patient-a', status: 'cancelled' },
  { clinic_id: clinicA, professional_id: 'professional-b', patient_id: 'patient-b', status: 'confirmed' },
  { clinic_id: clinicB, professional_id: 'professional-a', patient_id: 'patient-d', status: 'scheduled' },
];
const users = {
  'admin-token': { userId: 'admin-user', clinicId: clinicA, role: 'admin' },
  'reception-token': { userId: 'reception-user', clinicId: clinicA, role: 'reception' },
  'professional-a-token': { userId: professionalUserA, clinicId: clinicA, role: 'professional' },
  'professional-b-token': { userId: professionalUserB, clinicId: clinicA, role: 'professional' },
};

async function fixtureQuery(text, values) {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  assert.match(
    normalizedText,
    /^SELECT p\.\* FROM patients p WHERE (?:p\.clinic_id = \$1|p\.id = \$1 AND p\.clinic_id = \$2)/i
  );
  if (!normalizedText.includes('p.id = $1')) {
    assert.match(normalizedText, /ORDER BY p\.created_at DESC$/i);
  }

  const clinicId = values[normalizedText.includes('p.id = $1') ? 1 : 0];
  const selectedId = normalizedText.includes('p.id = $1') ? values[0] : null;
  let accessiblePatients = patients.filter((patient) => patient.clinic_id === clinicId);

  if (selectedId) {
    accessiblePatients = accessiblePatients.filter((patient) => patient.id === selectedId);
  }

  if (normalizedText.includes('EXISTS (')) {
    assert.match(normalizedText, /a\.clinic_id = p\.clinic_id/i);
    assert.match(normalizedText, /a\.clinic_id = \$[12]/i);
    assert.match(normalizedText, /pr\.clinic_id = a\.clinic_id/i);
    assert.match(normalizedText, /pr\.user_id = \$[23]/i);

    const professionalUserId = values.at(-1);
    const professionalIds = professionals
      .filter((professional) => professional.clinic_id === clinicId && professional.user_id === professionalUserId)
      .map((professional) => professional.id);

    accessiblePatients = accessiblePatients.filter((patient) =>
      appointments.some((appointment) =>
        appointment.patient_id === patient.id &&
        appointment.clinic_id === patient.clinic_id &&
        appointment.clinic_id === clinicId &&
        professionalIds.includes(appointment.professional_id)
      )
    );
  } else if (normalizedText.includes('p.user_id = $')) {
    accessiblePatients = accessiblePatients.filter((patient) => patient.user_id === values.at(-1));
  }

  return { rows: accessiblePatients, rowCount: accessiblePatients.length };
}

const app = express();
app.use(express.json());
app.use('/api/patients', createPatientRouter({
  queryExecutor: fixtureQuery,
  requireActiveSubscription: (_req, _res, next) => next(),
  authenticate: (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const user = users[token];
    if (!user) {
      return res.status(401).json({ ok: false, message: 'Token ausente ou inválido.' });
    }
    req.user = user;
    return next();
  },
}));
const server = createServer(app);
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/patients`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function request(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return { status: response.status, body: await response.json() };
}

test('professional can read a patient with an appointment in their clinic', async () => {
  const response = await request('/patient-a', 'professional-a-token');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.id, 'patient-a');
});

test('professional cannot read a patient linked only to another professional', async () => {
  const response = await request('/patient-b', 'professional-a-token');
  assert.equal(response.status, 404);
});

test('professional cannot read a patient with no appointment', async () => {
  const response = await request('/patient-c', 'professional-a-token');
  assert.equal(response.status, 404);
});

test('professional cannot read a patient from another clinic', async () => {
  const response = await request('/patient-d', 'professional-a-token');
  assert.equal(response.status, 404);
});

test('another professional cannot read a patient linked to the first professional', async () => {
  const response = await request('/patient-a', 'professional-b-token');
  assert.equal(response.status, 404);
});

test('professional list contains only linked patients and does not duplicate appointments', async () => {
  const response = await request('/', 'professional-a-token');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map(({ id }) => id), ['patient-a']);
});

test('admin retains clinic-wide patient access', async () => {
  const response = await request('/', 'admin-token');
  const patientResponse = await request('/patient-b', 'admin-token');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map(({ id }) => id), ['patient-a', 'patient-b', 'patient-c']);
  assert.equal(patientResponse.status, 200);
  assert.equal(patientResponse.body.data.id, 'patient-b');
});

test('reception retains clinic-wide patient access', async () => {
  const response = await request('/', 'reception-token');
  const patientResponse = await request('/patient-b', 'reception-token');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map(({ id }) => id), ['patient-a', 'patient-b', 'patient-c']);
  assert.equal(patientResponse.status, 200);
  assert.equal(patientResponse.body.data.id, 'patient-b');
});

test('unauthenticated requests remain blocked', async () => {
  const response = await request('/', null);
  assert.equal(response.status, 401);
});
