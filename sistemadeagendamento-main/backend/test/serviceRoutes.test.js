import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createServiceRouter } from '../src/routes/serviceRouterFactory.js';

const clinicA = '11111111-1111-4111-8111-111111111111';
const clinicB = '55555555-5555-4555-8555-555555555555';
const professionalA = '22222222-2222-4222-8222-222222222222';
const professionalB = '33333333-3333-4333-8333-333333333333';
const serviceId = '44444444-4444-4444-8444-444444444444';

async function startTestServer({
  queryHandler = async () => ({ rows: [], rowCount: 0 }),
  clientHandler = async () => ({ rows: [], rowCount: 0 }),
  role = 'admin',
} = {}) {
  const queries = [];
  const auditEntries = [];
  const app = express();
  app.use(express.json());
  app.use('/api/services', createServiceRouter({
    queryExecutor: async (text, params) => {
      queries.push({ text, params, scope: 'query' });
      return queryHandler(text, params);
    },
    transactionExecutor: (work) => work({
      async query(text, params) {
        queries.push({ text, params, scope: 'transaction' });
        return clientHandler(text, params);
      },
    }),
    authenticate(req, res, next) {
      req.user = { userId: clinicA, clinicId: clinicA, role };
      next();
    },
    authorizeRoles(...roles) {
      return (req, res, next) => roles.includes(req.user.role)
        ? next()
        : res.status(403).json({ ok: false, message: 'Forbidden' });
    },
    requireClinicAccess(req, res, next) {
      req.clinicId = req.user.clinicId;
      next();
    },
    requireActiveSubscription(_req, _res, next) {
      next();
    },
    checkPlanLimit: async () => {},
    async logAudit(entry) {
      auditEntries.push(entry);
    },
  }));

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    queries,
    auditEntries,
    fetch: (path, init) => fetch(`http://127.0.0.1:${address.port}${path}`, init),
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('service creation validates tenant professional before insert and records audit', async () => {
  const server = await startTestServer({
    clientHandler: async (text, params) => {
      if (text.includes('SELECT id FROM professionals')) {
        return params[0] === clinicA && params[1][0] === professionalA
          ? { rows: [{ id: professionalA }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO services')) {
        return {
          rows: [{
            id: serviceId,
            clinic_id: params[0],
            name: params[1],
            description: params[2],
            duration_minutes: params[3],
            price: params[4],
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const response = await server.fetch('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Consulta',
        durationMinutes: 45,
        price: 125.5,
        professionalIds: [professionalA],
      }),
    });
    const result = await response.json();
    assert.equal(response.status, 201);
    assert.equal(result.data.clinic_id, clinicA);
    assert.ok(server.queries.some(({ text, params }) =>
      text.includes('INSERT INTO services') && params[0] === clinicA
    ));
    assert.ok(server.queries.some(({ text, params }) =>
      text.includes('INSERT INTO professional_services') &&
      params[0] === clinicA && params[1] === professionalA && params[2] === serviceId
    ));
    assert.deepEqual(server.auditEntries.map(({ action }) => action), ['professional_assigned', 'created']);
  } finally {
    await server.close();
  }
});

test('foreign-clinic service reads, edits, and status changes are tenant-scoped', async () => {
  const server = await startTestServer();
  try {
    const listResponse = await server.fetch('/api/services');
    assert.equal(listResponse.status, 200);
    assert.match(server.queries[0].text, /WHERE s\.clinic_id = \$1/);
    assert.deepEqual(server.queries[0].params, [clinicA, 'admin', clinicA]);
    assert.equal(
      Math.max(...[...server.queries[0].text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]))),
      server.queries[0].params.length
    );

    const readResponse = await server.fetch(`/api/services/${serviceId}`);
    assert.equal(readResponse.status, 404);
    assert.deepEqual(server.queries[1].params, [clinicA, serviceId, 'admin', clinicA]);
    assert.equal(
      Math.max(...[...server.queries[1].text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]))),
      server.queries[1].params.length
    );

    const editResponse = await server.fetch(`/api/services/${serviceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alterado' }),
    });
    assert.equal(editResponse.status, 404);
    const editQuery = server.queries.find(({ text }) => text.includes('UPDATE services'));
    assert.deepEqual(editQuery.params.slice(0, 2), [serviceId, clinicA]);

    for (const isActive of [false, true]) {
      const statusResponse = await server.fetch(`/api/services/${serviceId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      assert.equal(statusResponse.status, 404);
      const statusQuery = server.queries.find(({ text, params }) =>
        text.includes('SET is_active = $3') && params[2] === isActive
      );
      assert.deepEqual(statusQuery.params.slice(0, 2), [serviceId, clinicA]);
    }
  } finally {
    await server.close();
  }
});

test('a professional from another clinic cannot be assigned to a local service', async () => {
  for (const professionalId of [professionalB, '66666666-6666-4666-8666-666666666666']) {
    const server = await startTestServer({
      clientHandler: async (text) => {
        if (text.includes('SELECT id, is_active FROM services')) {
          return { rows: [{ id: serviceId, is_active: true }], rowCount: 1 };
        }
        if (text.includes('SELECT id FROM professionals')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      },
    });

    try {
      const response = await server.fetch(`/api/services/${serviceId}/professionals`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ professionalIds: [professionalId] }),
      });
      assert.equal(response.status, 400);
      const professionalQuery = server.queries.find(({ text }) => text.includes('SELECT id FROM professionals'));
      assert.deepEqual(professionalQuery.params, [clinicA, [professionalId]]);
      assert.equal(server.queries.some(({ text }) => text.startsWith('DELETE FROM professional_services')), false);
    } finally {
      await server.close();
    }
  }
});

test('service from another clinic cannot receive or lose professional assignments', async () => {
  const server = await startTestServer();
  try {
    const assignResponse = await server.fetch(`/api/services/${serviceId}/professionals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ professionalIds: [professionalA] }),
    });
    assert.equal(assignResponse.status, 404);
    assert.deepEqual(server.queries[0].params, [serviceId, clinicA]);
    const removeResponse = await server.fetch(`/api/services/${serviceId}/professionals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ professionalIds: [] }),
    });
    assert.equal(removeResponse.status, 404);
    assert.equal(
      server.queries.some(({ text }) => text.startsWith('DELETE FROM professional_services')),
      false
    );
    assert.equal(
      server.queries.some(({ text }) => text.startsWith('INSERT INTO professional_services')),
      false
    );
  } finally {
    await server.close();
  }
});

test('service mutations reject roles without administration permission', async () => {
  const server = await startTestServer({ role: 'professional' });
  try {
    const response = await server.fetch(`/api/services/${serviceId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(response.status, 403);
    assert.equal(server.queries.length, 0);
  } finally {
    await server.close();
  }
});

test('service request whitelist rejects client-supplied tenant identifiers', async () => {
  const server = await startTestServer();
  try {
    const response = await server.fetch('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Consulta',
        durationMinutes: 45,
        price: 125.5,
        clinicId: clinicB,
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(server.queries.length, 0);
  } finally {
    await server.close();
  }
});
