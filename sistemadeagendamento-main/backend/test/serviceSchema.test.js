import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readProjectFile = (relativePath) => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
const migration = readProjectFile('database/migrations/006_add_services.sql');
const schema = readProjectFile('database/schema.sql');
const serviceRoutes = readProjectFile('backend/src/routes/serviceRouterFactory.js');
const appointmentRoutes = readProjectFile('backend/src/routes/appointmentRoutes.js');
const scheduleRoutes = readProjectFile('backend/src/routes/scheduleRoutes.js');
const appointmentServiceSnapshot = readProjectFile('backend/src/services/appointmentServiceSnapshot.js');

test('migration and fresh schema define tenant-scoped service entities', () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /CREATE TABLE services\s*\([\s\S]*?clinic_id UUID NOT NULL REFERENCES clinics\(id\)/);
    assert.match(sql, /name VARCHAR\(200\) NOT NULL CHECK \(length\(btrim\(name\)\) > 0\)/);
    assert.match(sql, /duration_minutes INTEGER NOT NULL CHECK \(duration_minutes BETWEEN 1 AND 1440\)/);
    assert.match(sql, /price NUMERIC\(10,2\) NOT NULL CHECK \(price >= 0\)/);
    assert.match(sql, /CREATE TABLE professional_services\s*\([\s\S]*?PRIMARY KEY \(clinic_id, professional_id, service_id\)/);
    assert.match(sql, /FOREIGN KEY \(clinic_id, professional_id\) REFERENCES professionals\(clinic_id, id\)/);
    assert.match(sql, /FOREIGN KEY \(clinic_id, service_id\) REFERENCES services\(clinic_id, id\)/);
  }
});

test('appointment service and snapshot fields stay nullable for legacy rows and are tenant-scoped', () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /service_id UUID(?:,|\s)/);
    assert.match(sql, /service_name_snapshot VARCHAR\(200\)/);
    assert.match(sql, /service_price_snapshot NUMERIC\(10,2\)/);
    assert.match(sql, /service_duration_snapshot INTEGER/);
    assert.match(sql, /service_id IS NULL AND service_name_snapshot IS NULL AND service_price_snapshot IS NULL AND service_duration_snapshot IS NULL/);
    assert.match(sql, /FOREIGN KEY \(clinic_id, service_id\) REFERENCES services\(clinic_id, id\) ON DELETE RESTRICT/);
  }
});

test('service CRUD and appointment booking SQL always scopes records to the authenticated clinic', () => {
  assert.match(serviceRoutes, /WHERE s\.clinic_id = \$1/);
  assert.match(serviceRoutes, /WHERE id = \$1 AND clinic_id = \$2/);
  assert.match(serviceRoutes, /WHERE clinic_id = \$1 AND service_id = \$2/);
  assert.match(appointmentRoutes, /s\.clinic_id = \$2/);
  assert.match(appointmentRoutes, /ps\.professional_id = \$3/);
  assert.match(appointmentRoutes, /s\.is_active = TRUE OR \$4::boolean = TRUE/);
  assert.match(scheduleRoutes, /s\.clinic_id = \$2/);
  assert.match(scheduleRoutes, /ps\.professional_id = \$3/);
});

test('new appointments require an active same-clinic service assigned to the professional', () => {
  assert.match(appointmentRoutes, /JOIN professional_services ps[\s\S]*?ps\.clinic_id = s\.clinic_id/);
  assert.match(appointmentRoutes, /JOIN professionals pr[\s\S]*?pr\.clinic_id = ps\.clinic_id/);
  assert.match(appointmentRoutes, /WHERE s\.id = \$1[\s\S]*?s\.clinic_id = \$2[\s\S]*?ps\.professional_id = \$3/);
  assert.match(appointmentRoutes, /AND \(s\.is_active = TRUE OR \$4::boolean = TRUE\)/);
  assert.match(
    appointmentRoutes,
    /loadBookableService\(client, \{\s*clinicId: req\.clinicId,\s*professionalId,\s*serviceId,\s*\}\)/
  );
  assert.match(
    appointmentRoutes,
    /loadBookableService\(client, \{\s*clinicId: req\.clinicId,\s*professionalId,\s*serviceId,\s*allowInactive: true/
  );
  assert.match(appointmentRoutes, /service = applyAppointmentServiceSnapshot\(service, appointment\)/);
});

test('booking persists service snapshots and rescheduling does not replace historical values', () => {
  assert.match(
    appointmentRoutes,
    /INSERT INTO appointments \([\s\S]*?service_name_snapshot, service_price_snapshot, service_duration_snapshot/
  );
  assert.match(appointmentRoutes, /applyAppointmentServiceSnapshot\(service, appointment\)/);
  assert.match(appointmentServiceSnapshot, /appointment\.service_name_snapshot/);
  assert.match(appointmentServiceSnapshot, /appointment\.service_price_snapshot/);
  assert.match(appointmentServiceSnapshot, /appointment\.service_duration_snapshot/);
  const rescheduleUpdate = appointmentRoutes.match(
    /UPDATE appointments\s+SET professional_id = \$3,[\s\S]*?RETURNING \*/u
  )?.[0];
  assert.ok(rescheduleUpdate);
  assert.doesNotMatch(rescheduleUpdate, /service_(?:id|name_snapshot|price_snapshot|duration_snapshot)\s*=/);
  assert.match(rescheduleUpdate, /scheduled_start = \$5, scheduled_end = \$6/);
});
