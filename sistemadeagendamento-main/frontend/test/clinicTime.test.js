import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clinicDateAt,
  clinicDateTimeToIso,
  clinicDateTimeInputValue,
  clinicToday,
  isValidIanaTimeZone,
} from '../src/clinicTime.js';

test('converte datetime-local como horário da clínica, não do navegador', () => {
  assert.equal(
    clinicDateTimeToIso('2026-10-02T08:00', 'America/Sao_Paulo'),
    '2026-10-02T11:00:00.000Z'
  );
});

test('rejeita entrada local inexistente ou ambígua durante DST', () => {
  assert.equal(clinicDateTimeToIso('2026-03-08T02:30', 'America/New_York'), null);
  assert.equal(clinicDateTimeToIso('2026-11-01T01:30', 'America/New_York'), null);
});

test('formata o dia civil e datetime-local no fuso da clínica', () => {
  const timestamp = '2026-10-02T02:00:00.000Z';
  assert.equal(clinicDateAt(timestamp, 'America/Sao_Paulo'), '2026-10-01');
  assert.equal(clinicDateTimeInputValue(timestamp, 'America/Sao_Paulo'), '2026-10-01T23:00');
  assert.match(clinicToday('Europe/Lisbon'), /^\d{4}-\d{2}-\d{2}$/);
});

test('valida o fuso configurado como identificador IANA', () => {
  assert.equal(isValidIanaTimeZone('America/Sao_Paulo'), true);
  assert.equal(isValidIanaTimeZone('UTC-3'), false);
});
