import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'security-headers-tests-only-secret-32-bytes';
process.env.CORS_ORIGIN = 'http://localhost:5173';

const { app } = await import('../src/app.js');
const server = createServer(app);
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('API responses use a restrictive style CSP without inline styles', async () => {
  const response = await fetch(`${baseUrl}/api/health/live`);
  const contentSecurityPolicy = response.headers.get('content-security-policy');

  assert.equal(response.status, 200);
  assert.ok(contentSecurityPolicy);
  assert.match(contentSecurityPolicy, /style-src 'self'/);
  assert.doesNotMatch(contentSecurityPolicy, /unsafe-inline/);
});
