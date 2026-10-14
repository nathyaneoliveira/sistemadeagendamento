import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'subscription-routes-tests-only-secret-32bytes';
const { createSubscriptionRouter } = await import('../src/routes/subscriptionRoutes.js');

const subscriptions = {
  'clinic-a': {
    plan: 'complete',
    billing_cycle: 'yearly',
    status: 'active',
    started_at: '2026-01-01T00:00:00.000Z',
    current_period_start: '2026-01-01T00:00:00.000Z',
    current_period_end: '2027-01-01T00:00:00.000Z',
    trial_ends_at: null,
    cancelled_at: null,
    gateway_subscription_id: 'must-not-be-exposed',
  },
};

const users = {
  'admin-a': { clinicId: 'clinic-a', role: 'admin', userId: 'admin-user-a' },
  'admin-b': { clinicId: 'clinic-b', role: 'admin', userId: 'admin-user-b' },
  'reception-a': { clinicId: 'clinic-a', role: 'reception', userId: 'reception-user-a' },
};
const queries = [];

const app = express();
app.use(express.json());
app.use('/api/subscriptions', createSubscriptionRouter({
  authenticate: (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!users[token]) {
      return res.status(401).json({ ok: false, message: 'Token ausente ou inválido.' });
    }
    req.user = users[token];
    return next();
  },
  queryExecutor: async (text, values) => {
    queries.push({ text: text.replace(/\s+/g, ' ').trim(), values });
    const row = subscriptions[values[0]];
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  },
}));

const server = createServer(app);
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/subscriptions/current`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function request(token, query = '') {
  const response = await fetch(`${baseUrl}${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

test('admin can read only their clinic current subscription with server-calculated price', async () => {
  const response = await request('admin-a');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, {
    planName: 'Completo (legado)',
    plan: 'complete',
    billingCycle: 'yearly',
    priceInCents: 139999,
    billingCycleLabel: 'Anual',
    status: 'active',
    limits: { professionals: null, patients: null, appointments: null, services: null, users: null },
    capabilities: {
      basicScheduling: true,
      appointments: true,
      serviceManagement: true,
      publicBooking: true,
      basicDashboard: true,
      themes: true,
      userManagement: true,
      basicPermissions: true,
      payments: true,
      audit: true,
    },
    roadmapCapabilities: ['completeDashboard', 'reports'],
    startedAt: '2026-01-01T00:00:00.000Z',
    currentPeriodStart: '2026-01-01T00:00:00.000Z',
    currentPeriodEnd: '2027-01-01T00:00:00.000Z',
    trialEndsAt: null,
    cancelledAt: null,
  });
  assert.equal(JSON.stringify(response.body).includes('must-not-be-exposed'), false);
  assert.deepEqual(queries.at(-1).values, ['clinic-a']);
  assert.match(queries.at(-1).text, /WHERE clinic_id = \$1/);
});

test('another clinic receives only its own subscription result', async () => {
  const response = await request('admin-b');

  assert.equal(response.status, 200);
  assert.equal(response.body.data, null);
  assert.deepEqual(queries.at(-1).values, ['clinic-b']);
});

test('client-supplied clinic identifiers do not override authenticated clinic context', async () => {
  const response = await request('admin-a', '?clinicId=clinic-b');

  assert.equal(response.status, 200);
  assert.deepEqual(queries.at(-1).values, ['clinic-a']);
});

test('clinic admin receives null when no subscription exists', async () => {
  const response = await request('admin-b');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, data: null });
});

test('non-admin and unauthenticated users cannot read commercial subscription details', async () => {
  const receptionResponse = await request('reception-a');
  const anonymousResponse = await request(null);

  assert.equal(receptionResponse.status, 403);
  assert.equal(anonymousResponse.status, 401);
});
