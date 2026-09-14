import { setTimeout as delay } from 'node:timers/promises';

const API_URL = process.env.API_URL || 'http://localhost:4000/api';

async function apiRequest(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => null);

  return { response, payload };
}

async function waitForApi() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const { response } = await apiRequest('/health');
      if (response.ok) {
        return true;
      }
    } catch (error) {
      // ignore until service is ready
    }

    await delay(1000);
  }

  return false;
}

async function run() {
  console.log('Aguardando API disponível...');
  const available = await waitForApi();

  if (!available) {
    console.error('API não respondeu dentro do tempo esperado. Verifique o backend e o banco.');
    process.exit(1);
  }

  const loginPayload = {
    clinicId: process.env.TEST_CLINIC_ID || '11111111-1111-1111-1111-111111111111',
    email: process.env.TEST_EMAIL || 'admin@clinicacentral.com.br',
    password: process.env.TEST_PASSWORD || 'Admin123!',
  };

  console.log('Fazendo login com usuário administrativo...');
  const loginResponse = await apiRequest('/auth/login', 'POST', loginPayload);

  if (!loginResponse.response.ok || !loginResponse.payload?.data?.token) {
    console.error('Login falhou:', loginResponse.payload || 'Sem resposta válida');
    process.exit(1);
  }

  const token = loginResponse.payload.data.token;
  console.log('Login bem-sucedido. Token recebido.');

  const me = await apiRequest('/auth/me', 'GET', null, token);
  console.log('Perfil do usuário:', me.payload?.data || me.payload);

  const professionals = await apiRequest('/professionals', 'GET', null, token);
  console.log('Profissionais:', professionals.payload?.data || professionals.payload);

  const appointmentPayload = {
    patientId: process.env.TEST_PATIENT_ID || null,
    professionalId: process.env.TEST_PROFESSIONAL_ID || null,
    scheduledStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scheduledEnd: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    notes: 'Teste de fluxo de agendamento',
  };

  const appointmentResponse = await apiRequest('/appointments', 'POST', appointmentPayload, token);

  if (!appointmentResponse.response.ok) {
    console.error('Agendamento falhou:', appointmentResponse.payload || 'Sem resposta válida');
    process.exit(1);
  }

  console.log('Agendamento criado:', appointmentResponse.payload?.data || appointmentResponse.payload);
  console.log('Fluxo principal concluído com sucesso.');
}

run();
