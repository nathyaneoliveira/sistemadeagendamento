import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'platform-admin-auth-tests-only-secret-32bytes';
const { revokePlatformAdminSession } = await import('../src/services/platformAdminAuthService.js');

test('global logout revokes only the active administrator and records the event transactionally', async () => {
  const queries = [];
  const auditEvents = [];
  let transactionCalls = 0;

  await revokePlatformAdminSession(
    { platformAdminId: 'synthetic-platform-admin', requestId: 'synthetic-request' },
    {
      transactionExecutor: async (callback) => {
        transactionCalls += 1;
        return callback({
          query: async (sql, values) => {
            queries.push({ sql, values });
            return { rows: [{ id: values[0] }], rowCount: 1 };
          },
        });
      },
      auditLogger: async (event) => auditEvents.push(event),
    }
  );

  assert.equal(transactionCalls, 1);
  assert.match(queries[0].sql, /token_version = token_version \+ 1/);
  assert.match(queries[0].sql, /WHERE id = \$1 AND status = 'active'/);
  assert.deepEqual(queries[0].values, ['synthetic-platform-admin']);
  assert.deepEqual(auditEvents, [{
    platformAdminId: 'synthetic-platform-admin',
    action: 'platform.auth.logout',
    requestId: 'synthetic-request',
  }]);
});

test('global logout fails closed when the authenticated administrator is no longer active', async () => {
  let auditCalls = 0;

  await assert.rejects(
    revokePlatformAdminSession(
      { platformAdminId: 'synthetic-platform-admin', requestId: 'synthetic-request' },
      {
        transactionExecutor: async (callback) => callback({
          query: async () => ({ rows: [], rowCount: 0 }),
        }),
        auditLogger: async () => {
          auditCalls += 1;
        },
      }
    ),
    (error) => error.statusCode === 401 && error.message === 'Credenciais inválidas.'
  );
  assert.equal(auditCalls, 0);
});
