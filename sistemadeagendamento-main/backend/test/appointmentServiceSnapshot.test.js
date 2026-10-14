import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAppointmentServiceSnapshot } from '../src/services/appointmentServiceSnapshot.js';

test('reagendamento preserva nome, preço e duração históricos após alteração do serviço', () => {
  const currentService = {
    id: 'service-1',
    name: 'Limpeza Premium',
    price: '150.00',
    duration_minutes: 90,
    is_active: false,
  };
  const appointment = {
    service_name_snapshot: 'Limpeza',
    service_price_snapshot: '100.00',
    service_duration_snapshot: 60,
  };

  assert.deepEqual(applyAppointmentServiceSnapshot(currentService, appointment), {
    id: 'service-1',
    name: 'Limpeza',
    price: '100.00',
    duration_minutes: 60,
    is_active: false,
  });
});
