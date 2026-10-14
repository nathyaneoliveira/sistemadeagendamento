import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readProjectFile = (relativePath) => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
const schema = readProjectFile('database/schema.sql');
const migration = readProjectFile('database/migrations/007_public_booking.sql');
const router = readProjectFile('backend/src/routes/publicBookingRouterFactory.js');
const app = readProjectFile('backend/src/app.js');

test('fresh schema and additive migration define unique public slugs and clinic-scoped idempotency', () => {
  for (const sql of [schema, migration]) {
    assert.match(sql, /public_slug VARCHAR\(63\)/);
    assert.match(sql, /uq_clinic_configurations_public_slug/);
    assert.match(sql, /public_idempotency_key UUID/);
    assert.match(sql, /uq_appointments_clinic_id_idempotency_key/);
    assert.match(sql, /ON appointments\(clinic_id, public_idempotency_key\)/);
    assert.match(sql, /WHERE public_idempotency_key IS NOT NULL/);
  }
  assert.match(schema, /ex_appointments_no_overlapping_professional/);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
});

test('public router is a separate allowlisted surface and reuses the existing availability and locking functions', () => {
  assert.match(router, /generateAvailableSlots/);
  assert.match(router, /assertAppointmentSlotAvailable/);
  assert.match(router, /lockProfessionalSchedule/);
  assert.match(router, /s\.clinic_id = \$2/);
  assert.match(router, /ps\.clinic_id = s\.clinic_id/);
  assert.match(router, /p\.status = 'active'/);
  assert.match(router, /s\.is_active = TRUE/);
  assert.match(router, /public_idempotency_key/);
  assert.doesNotMatch(router, /authenticateToken|requireClinicAccess/);
  assert.match(app, /rateLimitMiddleware\(publicApiLimiter\)/);
  assert.match(app, /rateLimitMiddleware\(publicAppointmentLimiter\)/);
});

test('public booking uses tenant-scoped locks before insertion and returns no appointment identifiers', () => {
  assert.match(router, /public-booking:\$\{clinic\.id\}:\$\{req\.body\.idempotencyKey\}/);
  assert.match(router, /clinicId: clinic\.id,[\s\S]*?professionalId: req\.body\.professionalId/);
  assert.match(router, /entityId: inserted\.rows\[0\]\.id/);
  assert.match(router, /function publicAppointment\(row\)/);
  const publicProjection = router.match(/function publicAppointment\(row\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(publicProjection);
  assert.doesNotMatch(publicProjection, /row\.id|clinic_id|patient_id|professional_id|service_id|password_hash/);
  assert.doesNotMatch(router, /router\.(?:delete|patch)\([^)]*cancel/i);
});
