import pg from 'pg';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

const { Pool } = pg;

const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  user: env.db.user,
  password: env.db.password,
});

async function seed() {
  const client = await pool.connect();

  try {
    const clinicResult = await client.query(
      `INSERT INTO clinics (name, trade_name, cnpj, phone, whatsapp, email, address_line1, city, state, zip_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        'Clínica Central',
        'Clínica Central',
        '00.000.000/0001-00',
        '(11) 4000-0000',
        '(11) 99999-0000',
        'contato@clinicacentral.com.br',
        'Avenida Brasil, 100',
        'São Paulo',
        'SP',
        '01000-000',
      ]
    );

    const clinicId = clinicResult.rows[0]?.id || (await client.query('SELECT id FROM clinics LIMIT 1')).rows[0]?.id;

    if (!clinicId) {
      throw new Error('Não foi possível localizar ou criar a clínica. Verifique o banco e o schema.');
    }

    const passwordHash = await bcrypt.hash('Admin123!', 12);

    const userResult = await client.query(
      `INSERT INTO users (clinic_id, name, email, password_hash, phone, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (clinic_id, email) DO NOTHING
       RETURNING id`,
      [clinicId, 'Administrador', 'admin@clinicacentral.com.br', passwordHash, '(11) 98888-0000', 'admin']
    );

    const adminUserId = userResult.rows[0]?.id || (await client.query(
      'SELECT id FROM users WHERE clinic_id = $1 AND email = $2',
      [clinicId, 'admin@clinicacentral.com.br']
    )).rows[0]?.id;

    if (!adminUserId) {
      throw new Error('Não foi possível criar o usuário administrador.');
    }

    const specialtyResult = await client.query(
      `INSERT INTO specialties (clinic_id, name, description, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (clinic_id, name) DO NOTHING
       RETURNING id`,
      [clinicId, 'Cardiologia', 'Atendimento cardiológico e avaliação clínica.']
    );

    const specialtyId = specialtyResult.rows[0]?.id || (await client.query(
      'SELECT id FROM specialties WHERE clinic_id = $1 AND name = $2',
      [clinicId, 'Cardiologia']
    )).rows[0]?.id;

    if (!specialtyId) {
      throw new Error('Não foi possível criar a especialidade.');
    }

    const professionalResult = await client.query(
      `INSERT INTO professionals (clinic_id, user_id, specialty_id, name, crm, phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [clinicId, adminUserId, specialtyId, 'Dr. João da Silva', 'SP-123456', '(11) 97777-0001', 'active']
    );

    const professionalId = professionalResult.rows[0]?.id || (await client.query(
      'SELECT id FROM professionals WHERE clinic_id = $1 LIMIT 1',
      [clinicId]
    )).rows[0]?.id;

    if (!professionalId) {
      throw new Error('Não foi possível criar o profissional inicial.');
    }

    const patientResult = await client.query(
      `INSERT INTO patients (clinic_id, user_id, name, cpf, birth_date, phone, email, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
       ON CONFLICT (clinic_id, cpf) DO NOTHING
       RETURNING id`,
      [clinicId, null, 'Maria Oliveira', '123.456.789-09', '1990-04-10', '(11) 97111-2222', 'maria@email.com']
    );

    const patientId = patientResult.rows[0]?.id || (await client.query(
      'SELECT id FROM patients WHERE clinic_id = $1 LIMIT 1',
      [clinicId]
    )).rows[0]?.id;

    if (!patientId) {
      throw new Error('Não foi possível criar o paciente inicial.');
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(9, 0, 0, 0);

    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

    const appointmentResult = await client.query(
      `INSERT INTO appointments (clinic_id, patient_id, professional_id, specialty_id, scheduled_start, scheduled_end, status, code, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', $7, 'Consulta inicial de avaliação')
       ON CONFLICT (professional_id, scheduled_start) DO NOTHING
       RETURNING id`,
      [clinicId, patientId, professionalId, specialtyId, startDate, endDate, 'CONS-SEED-001']
    );

    const scheduleResult = await client.query(
      `INSERT INTO professional_schedules (clinic_id, professional_id, weekday, start_time, end_time, duration_minutes, break_duration_minutes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
       ON CONFLICT (professional_id, weekday, start_time, end_time) DO NOTHING`,
      [clinicId, professionalId, 2, '08:00', '18:00', 30, 15]
    );

    console.log('Dados iniciais criados com sucesso.');
    console.log({ clinicId, adminUserId, specialtyId, professionalId, patientId, appointmentId: appointmentResult.rows[0]?.id || null, scheduleRows: scheduleResult.rowCount });
  } catch (error) {
    console.error('Erro ao popular dados iniciais:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
