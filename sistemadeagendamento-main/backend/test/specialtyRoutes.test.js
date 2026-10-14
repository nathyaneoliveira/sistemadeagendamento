import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { createSpecialtyRouter } from '../src/routes/specialtyRoutes.js';

const clinicA = '11111111-1111-4111-8111-111111111111';
const clinicB = '55555555-5555-4555-8555-555555555555';
const specialtyId = '22222222-2222-4222-8222-222222222222';

async function startServer({
  queryHandler = async () => ({ rows: [], rowCount: 0 }),
  role = 'admin',
} = {}) {
  const queries = [];
  const app = express();
  app.use(express.json());
  app.use('/api/specialties', createSpecialtyRouter({
    queryExecutor: async (text, params) => {
      queries.push({ text, params });
      return queryHandler(text, params);
    },
    authenticate(req, _res, next) {
      req.user = { userId: 'synthetic-user', clinicId: clinicA, role };
      next();
    },
    authorizeRolesMiddleware(...roles) {
      return (req, res, next) => roles.includes(req.user.role)
        ? next()
        : res.status(403).json({ ok: false, message: 'Forbidden' });
    },
    requireClinicAccessMiddleware(req, _res, next) {
      req.clinicId = req.user.clinicId;
      next();
    },
    requireActiveSubscriptionMiddleware(_req, _res, next) {
      next();
    },
  }));

  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/specialties`;

  return {
    queries,
    fetch: (path, init) => fetch(`${baseUrl}${path}`, init),
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

async function send(server, path, method, body) {
  const response = await server.fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('creates specialty with valid fields and the authenticated clinic', async () => {
  const server = await startServer({
    queryHandler: async (_text, params) => ({
      rows: [{
        id: specialtyId,
        clinic_id: params[0],
        name: params[1],
        description: params[2],
        status: params[3],
      }],
      rowCount: 1,
    }),
  });

  try {
    const response = await send(server, '/', 'POST', {
      name: 'Cardiologia',
      description: 'Atendimento cardiológico',
      status: 'active',
    });
    assert.equal(response.status, 201);
    assert.deepEqual(response.body.data, {
      id: specialtyId,
      clinic_id: clinicA,
      name: 'Cardiologia',
      description: 'Atendimento cardiológico',
      status: 'active',
    });
    assert.match(server.queries[0].text, /INSERT INTO specialties/);
    assert.deepEqual(server.queries[0].params, [
      clinicA, 'Cardiologia', 'Atendimento cardiológico', 'active',
    ]);
    assert.doesNotMatch(server.queries[0].text, /Cardiologia|Atendimento/);
  } finally {
    await server.close();
  }
});

test('updates a specialty with valid partial fields and scopes it to the clinic', async () => {
  const server = await startServer({
    queryHandler: async (_text, params) => ({
      rows: [{ id: specialtyId, clinic_id: params[1], name: params[2], description: null, status: 'inactive' }],
      rowCount: 1,
    }),
  });

  try {
    const response = await send(server, `/${specialtyId}`, 'PUT', { name: 'Neurologia', status: 'inactive' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.name, 'Neurologia');
    assert.deepEqual(server.queries[0].params, [specialtyId, clinicA, 'Neurologia', null, 'inactive']);
    assert.match(server.queries[0].text, /WHERE id = \$1 AND clinic_id = \$2/);
  } finally {
    await server.close();
  }
});

test('rejects missing or blank required names before persistence', async () => {
  const server = await startServer();
  try {
    for (const body of [{}, { name: '' }, { name: '   ' }]) {
      const response = await send(server, '/', 'POST', body);
      assert.equal(response.status, 400);
      assert.deepEqual(response.body, {
        ok: false,
        message: 'Dados de especialidade inválidos ou campos não permitidos.',
      });
    }
    assert.equal(server.queries.length, 0);
  } finally {
    await server.close();
  }
});

test('rejects incorrect field types and schema-length violations before persistence', async () => {
  const server = await startServer();
  try {
    const invalidPayloads = [
      { name: 7 },
      { name: 'Cardiologia', description: { text: 'invalid' } },
      { name: 'Cardiologia', status: 1 },
      { name: 'n'.repeat(201) },
      { name: 'Cardiologia', status: 's'.repeat(21) },
      { name: 'Cardiologia\0' },
      { name: 'Cardiologia', description: 'texto\0inválido' },
      { name: 'Cardiologia', status: 'active\0' },
    ];

    for (const body of invalidPayloads) {
      assert.equal((await send(server, '/', 'POST', body)).status, 400);
    }
    const invalidUpdates = [
      {},
      { name: null },
      { name: 'n'.repeat(201) },
      { description: false },
      { status: 's'.repeat(21) },
    ];
    for (const body of invalidUpdates) {
      assert.equal((await send(server, `/${specialtyId}`, 'PUT', body)).status, 400);
    }
    assert.equal(server.queries.length, 0);
  } finally {
    await server.close();
  }
});

test('does not invent status values or a description limit absent from the schema', async () => {
  const server = await startServer({
    queryHandler: async (_text, params) => ({ rows: [{ clinic_id: params[0] }], rowCount: 1 }),
  });
  try {
    const body = { name: 'Especialidade', description: 'd'.repeat(2500), status: 'custom' };
    assert.equal((await send(server, '/', 'POST', body)).status, 201);
    assert.deepEqual(server.queries[0].params, [clinicA, body.name, body.description, body.status]);
  } finally {
    await server.close();
  }
});

test('rejects unexpected fields and invalid identifiers without querying storage', async () => {
  const server = await startServer();
  try {
    assert.equal((await send(server, '/', 'POST', { name: 'Cardiologia', clinicId: clinicB })).status, 400);
    assert.equal((await send(server, `/${specialtyId}`, 'PUT', { unexpected: true })).status, 400);
    assert.equal((await server.fetch('/not-a-uuid')).status, 400);
    assert.equal((await send(server, '/not-a-uuid', 'PUT', { name: 'Cardiologia' })).status, 400);
    assert.equal(server.queries.length, 0);
  } finally {
    await server.close();
  }
});

test('foreign-clinic specialty is not found and all lookups remain tenant-scoped', async () => {
  const foreignSpecialty = { id: specialtyId, clinic_id: clinicB, name: 'Neurologia' };
  const server = await startServer({
    queryHandler: async (text, params) => {
      assert.match(text, /WHERE id = \$1 AND clinic_id = \$2/);
      const rows = foreignSpecialty.id === params[0] && foreignSpecialty.clinic_id === params[1]
        ? [foreignSpecialty]
        : [];
      return { rows, rowCount: rows.length };
    },
  });
  try {
    const response = await send(server, `/${specialtyId}`, 'PUT', { name: 'Neurologia' });
    assert.equal(response.status, 404);
    assert.deepEqual(server.queries[0].params, [specialtyId, clinicA, 'Neurologia', null, null]);
    assert.equal(server.queries[0].params.includes(clinicB), false);
    assert.match(server.queries[0].text, /WHERE id = \$1 AND clinic_id = \$2/);
  } finally {
    await server.close();
  }
});

test('rejects unauthorized roles before persistence', async () => {
  const server = await startServer({ role: 'professional' });
  try {
    const response = await send(server, '/', 'POST', { name: 'Cardiologia' });
    assert.equal(response.status, 403);
    assert.equal(server.queries.length, 0);
  } finally {
    await server.close();
  }
});

test('database failures are passed to centralized error handling without exposing details', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/specialties', createSpecialtyRouter({
    queryExecutor: async () => { throw new Error('private database detail'); },
    authenticate(req, _res, next) {
      req.user = { userId: 'synthetic-user', clinicId: clinicA, role: 'admin' };
      next();
    },
    authorizeRolesMiddleware: () => (_req, _res, next) => next(),
    requireClinicAccessMiddleware(req, _res, next) {
      req.clinicId = clinicA;
      next();
    },
    requireActiveSubscriptionMiddleware: (_req, _res, next) => next(),
  }));
  app.use((error, _req, res, _next) => res.status(500).json({ ok: false, message: 'Erro interno.' }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/specialties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cardiologia' }),
    });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.deepEqual(body, { ok: false, message: 'Erro interno.' });
    assert.doesNotMatch(JSON.stringify(body), /private database detail/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
