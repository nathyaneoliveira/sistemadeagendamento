import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import test from 'node:test';
import { hashPassword } from '../src/utils/password.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'auth-service-tests-only-secret-at-least-32-bytes';

const { createUserAccount, loginUser, selectLoginClinic } = await import('../src/services/authService.js');

const email = 'shared.account@example.invalid';
const password = 'Synthetic-password-123!';

async function account({
  id = 'user-a',
  clinicId = 'clinic-a',
  role = 'admin',
  status = 'active',
  accountEmail = email,
  accountPassword = password,
  clinicName = 'Synthetic Clinic',
} = {}) {
  return {
    id,
    clinic_id: clinicId,
    name: `Synthetic ${role}`,
    email: accountEmail,
    password_hash: await hashPassword(accountPassword),
    role,
    status,
    clinic_name: clinicName,
    clinic_trade_name: null,
    clinic_timezone: 'UTC',
    token_version: 0,
  };
}

function createQueryExecutor(accounts) {
  const calls = [];
  const execute = async (text, values = []) => {
    calls.push({ text, values });
    if (text.includes('JOIN clinics')) {
      const rows = accounts.filter((item) => item.email.toLowerCase() === values[0].toLowerCase());
      return { rows, rowCount: rows.length };
    }

    if (text.includes('SET last_login_at')) {
      const user = accounts.find((item) =>
        item.id === values[0] &&
        item.clinic_id === values[1] &&
        item.status === 'active'
      );
      if (!user) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          id: user.id,
          clinic_id: user.clinic_id,
          name: user.name,
          email: user.email,
          role: user.role,
          token_version: user.token_version,
        }],
        rowCount: 1,
      };
    }

    if (text.includes('WHERE id = $1 AND clinic_id = $2 AND status =')) {
      const rows = accounts.filter((item) =>
        item.id === values[0] &&
        item.clinic_id === values[1] &&
        item.status === 'active'
      );
      return { rows, rowCount: rows.length };
    }

    throw new Error('Unexpected authentication test query.');
  };
  execute.calls = calls;
  return execute;
}

test('valid email and password create a JWT-backed session for each existing role', async () => {
  for (const role of ['admin', 'reception', 'professional', 'patient']) {
    const user = await account({ role, clinicId: `clinic-${role}`, id: `user-${role}` });
    const queryExecutor = createQueryExecutor([user]);
    const result = await loginUser(
      { email: user.email, password },
      { queryExecutor }
    );

    assert.equal(result.user.role, role);
    assert.equal(result.user.clinicId, user.clinic_id);
    const decoded = jwt.verify(result.token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      audience: 'sistema-de-agendamentos-client',
      issuer: 'sistema-de-agendamentos-api',
    });
    assert.equal(decoded.sub, user.id);
    assert.equal(decoded.clinicId, user.clinic_id);
    assert.equal(decoded.sessionVersion, user.token_version);
  }
});

test('incorrect password and nonexistent email return the same generic authentication error', async () => {
  const user = await account();
  const queryExecutor = createQueryExecutor([user]);
  const failures = [];

  for (const credentials of [
    { email, password: 'incorrect-password' },
    { email: 'missing@example.invalid', password },
  ]) {
    await assert.rejects(
      loginUser(credentials, { queryExecutor }),
      (error) => {
        failures.push({ status: error.statusCode, message: error.message });
        return error.statusCode === 401;
      }
    );
  }

  assert.deepEqual(failures[0], failures[1]);
});

test('existing accounts with short and over-72-byte passwords retain historical login behavior', async () => {
  for (const [index, legacyPassword] of ['legacy-pass', 'x'.repeat(73)].entries()) {
    const user = await account({
      id: `legacy-user-${index}`,
      accountEmail: `legacy-${index}@example.invalid`,
      accountPassword: legacyPassword,
    });
    const result = await loginUser(
      { email: user.email, password: legacyPassword },
      { queryExecutor: createQueryExecutor([user]) }
    );

    assert.equal(result.user.id, user.id);
  }
});

test('one matching account is identified by email and password without a clinic identifier', async () => {
  const selected = await account({ clinicId: 'clinic-matching', id: 'matching-user' });
  const other = await account({
    clinicId: 'clinic-other',
    id: 'other-user',
    accountPassword: 'different-password',
  });
  const queryExecutor = createQueryExecutor([selected, other]);
  const result = await loginUser({ email, password }, { queryExecutor });

  assert.equal(result.user.id, selected.id);
  assert.equal(result.user.clinicId, selected.clinic_id);
  assert.deepEqual(queryExecutor.calls[0].values, [email]);
});

test('same email and password across clinics requires a signed clinic selection', async () => {
  const first = await account({ id: 'user-first', clinicId: 'clinic-first', clinicName: 'First Clinic' });
  const second = await account({ id: 'user-second', clinicId: 'clinic-second', clinicName: 'Second Clinic' });
  const queryExecutor = createQueryExecutor([first, second]);
  const challenge = await loginUser({ email, password }, { queryExecutor });

  assert.equal(challenge.requiresClinicSelection, true);
  assert.equal(challenge.clinics.length, 2);
  assert.equal(challenge.token, undefined);

  const session = await selectLoginClinic(
    { selectionToken: challenge.selectionToken, clinicId: second.clinic_id },
    { queryExecutor }
  );
  assert.equal(session.user.id, second.id);
  assert.equal(session.user.clinicId, second.clinic_id);
  assert.equal(queryExecutor.calls.at(-2).values[0], second.id);
  assert.equal(queryExecutor.calls.at(-2).values[1], second.clinic_id);
});

test('a client cannot select a clinic outside the verified account set', async () => {
  const first = await account({ id: 'user-first', clinicId: 'clinic-first' });
  const second = await account({ id: 'user-second', clinicId: 'clinic-second' });
  const queryExecutor = createQueryExecutor([first, second]);
  const challenge = await loginUser({ email, password }, { queryExecutor });
  const callsBeforeSelection = queryExecutor.calls.length;

  await assert.rejects(
    selectLoginClinic(
      { selectionToken: challenge.selectionToken, clinicId: 'clinic-unrelated' },
      { queryExecutor }
    ),
    { statusCode: 401, message: 'Credenciais inválidas.' }
  );
  assert.equal(queryExecutor.calls.length, callsBeforeSelection);
});

test('duplicate matching users inside one clinic fail closed instead of selecting arbitrarily', async () => {
  const first = await account({ id: 'user-first', clinicId: 'clinic-shared' });
  const second = await account({ id: 'user-second', clinicId: 'clinic-shared' });

  await assert.rejects(
    loginUser({ email, password }, { queryExecutor: createQueryExecutor([first, second]) }),
    { statusCode: 401, message: 'Credenciais inválidas.' }
  );
});

test('inactive accounts and accounts without a valid clinic join do not receive a session', async () => {
  const inactive = await account({ status: 'inactive' });
  await assert.rejects(
    loginUser({ email, password }, { queryExecutor: createQueryExecutor([inactive]) }),
    { statusCode: 401, message: 'Credenciais inválidas.' }
  );
  await assert.rejects(
    loginUser({ email, password }, { queryExecutor: createQueryExecutor([]) }),
    { statusCode: 401, message: 'Credenciais inválidas.' }
  );
});

test('new clinic accounts enforce the password policy before opening a transaction', async () => {
  let transactionCount = 0;
  const transactionExecutor = async (operation) => {
    transactionCount += 1;
    return operation({
      query: async (text) => {
        if (text.startsWith('SELECT id FROM users')) return { rows: [], rowCount: 0 };
        if (text.startsWith('INSERT INTO users')) return { rows: [{ id: 'synthetic-user' }], rowCount: 1 };
        throw new Error('Unexpected account creation test query.');
      },
    });
  };
  const options = { transactionExecutor, checkPlanLimit: async () => {} };
  const accountInput = {
    clinicId: 'synthetic-clinic',
    name: 'Synthetic User',
    email: 'user@example.invalid',
    password: 'Synthetic-password-123!',
    role: 'professional',
    phone: null,
  };

  await assert.rejects(
    createUserAccount({ ...accountInput, password: 'too-short' }, options),
    { statusCode: 400 }
  );
  await assert.rejects(
    createUserAccount({ ...accountInput, password: 'x'.repeat(73) }, options),
    { statusCode: 400 }
  );
  assert.equal(transactionCount, 0);

  const created = await createUserAccount(accountInput, options);
  assert.equal(created.id, 'synthetic-user');
  assert.equal(transactionCount, 1);
});

test('clinic selection challenge expires and cannot be used as a regular access token', async () => {
  const first = await account({ id: 'user-first', clinicId: 'clinic-first' });
  const second = await account({ id: 'user-second', clinicId: 'clinic-second' });
  const queryExecutor = createQueryExecutor([first, second]);
  const challenge = await loginUser({ email, password }, { queryExecutor });
  const decodedChallenge = jwt.decode(challenge.selectionToken);

  assert.throws(() => jwt.verify(challenge.selectionToken, process.env.JWT_SECRET, {
    algorithms: ['HS256'],
    audience: 'sistema-de-agendamentos-client',
    issuer: 'sistema-de-agendamentos-api',
  }));
  assert.throws(() => jwt.verify(challenge.selectionToken, process.env.JWT_SECRET, {
    algorithms: ['HS256'],
    audience: 'sistema-de-agendamentos-clinic-selection',
    issuer: 'sistema-de-agendamentos-api',
    clockTimestamp: decodedChallenge.exp + 1,
  }));
  const expiredSelectionToken = jwt.sign(
    {
      accounts: [
        { userId: first.id, clinicId: first.clinic_id },
        { userId: second.id, clinicId: second.clinic_id },
      ],
      iat: Math.floor(Date.now() / 1000) - 301,
    },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      audience: 'sistema-de-agendamentos-clinic-selection',
      expiresIn: '5m',
      issuer: 'sistema-de-agendamentos-api',
    }
  );
  await assert.rejects(
    selectLoginClinic(
      { selectionToken: expiredSelectionToken, clinicId: first.clinic_id },
      { queryExecutor }
    ),
    { statusCode: 401, message: 'Credenciais inválidas.' }
  );
});

test('expired access JWTs are rejected by standard JWT verification', async () => {
  const user = await account();
  const result = await loginUser({ email, password }, { queryExecutor: createQueryExecutor([user]) });
  const decoded = jwt.decode(result.token);

  assert.throws(() => jwt.verify(result.token, process.env.JWT_SECRET, {
    algorithms: ['HS256'],
    audience: 'sistema-de-agendamentos-client',
    issuer: 'sistema-de-agendamentos-api',
    clockTimestamp: decoded.exp + 1,
  }));
});
