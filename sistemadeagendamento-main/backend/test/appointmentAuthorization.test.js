import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAppointmentPatientAllowed,
  isAppointmentPatientOwner,
  isAppointmentProfessionalAllowed,
  isAppointmentSpecialtyAllowed,
  isResourceInClinic,
} from '../src/services/appointmentAuthorization.js';

const clinicA = 'clinic-a';
const clinicB = 'clinic-b';
const patientA = { id: 'patient-a', user_id: 'user-a', clinic_id: clinicA, status: 'active' };
const patientB = { id: 'patient-b', user_id: 'user-b', clinic_id: clinicA, status: 'active' };
const professionalA = {
  id: 'professional-a',
  clinic_id: clinicA,
  specialty_id: 'specialty-a',
  status: 'active',
};
const specialtyA = { id: 'specialty-a', clinic_id: clinicA, status: 'active' };

test('A: paciente não pode criar agendamento para outro paciente', () => {
  assert.equal(isAppointmentPatientAllowed({
    role: 'patient',
    userId: 'user-a',
    patientId: patientB.id,
    patient: patientB,
    clinicId: clinicA,
  }), false);
});

test('B/C: paciente não é autorizado para cancelar ou reagendar agendamento alheio', () => {
  assert.equal(isAppointmentPatientOwner('user-a', patientB.user_id), false);
});

test('D: registro de outra clínica não passa pela validação de tenant', () => {
  assert.equal(isResourceInClinic(clinicA, clinicB), false);
});

test('E: profissional de outra clínica não é permitido', () => {
  assert.equal(isAppointmentProfessionalAllowed({
    clinicId: clinicA,
    professional: { ...professionalA, clinic_id: clinicB },
  }), false);
});

test('F: especialidade de outra clínica não é permitida', () => {
  assert.equal(isAppointmentSpecialtyAllowed({
    clinicId: clinicA,
    professionalSpecialtyId: specialtyA.id,
    specialty: { ...specialtyA, clinic_id: clinicB },
  }), false);
});

test('G: especialidade incompatível com o profissional não é permitida', () => {
  assert.equal(isAppointmentSpecialtyAllowed({
    clinicId: clinicA,
    professionalSpecialtyId: professionalA.specialty_id,
    specialty: { ...specialtyA, id: 'specialty-b' },
  }), false);
});

test('H: profissional inativo não é permitido', () => {
  assert.equal(isAppointmentProfessionalAllowed({
    clinicId: clinicA,
    professional: { ...professionalA, status: 'inactive' },
  }), false);
});

test('I: admin/recepção podem selecionar paciente ativo da própria clínica', () => {
  for (const role of ['admin', 'reception']) {
    assert.equal(isAppointmentPatientAllowed({
      role,
      userId: 'staff-user',
      patientId: patientB.id,
      patient: patientB,
      clinicId: clinicA,
    }), true);
  }
});

test('J: referências de paciente ou profissional inexistentes não são autorizadas', () => {
  assert.equal(isAppointmentPatientAllowed({
    role: 'admin',
    userId: 'staff-user',
    patientId: 'missing-patient',
    patient: undefined,
    clinicId: clinicA,
  }), false);
  assert.equal(isAppointmentProfessionalAllowed({
    clinicId: clinicA,
    professional: undefined,
  }), false);
});

test('K: paciente pode criar agendamento para si', () => {
  assert.equal(isAppointmentPatientAllowed({
    role: 'patient',
    userId: 'user-a',
    patientId: patientA.id,
    patient: patientA,
    clinicId: clinicA,
  }), true);
});
