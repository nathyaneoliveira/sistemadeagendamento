# Sistema de agendamento para clínica

## Visão geral

Este projeto foi desenvolvido como base arquitetural para um sistema de agendamento para clínicas, com separação entre frontend, backend e banco de dados, além de autenticação, autorização e regras de agendamento.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Banco: PostgreSQL
- Segurança: JWT, helmet, CORS, rate limiting, validações

## Estrutura

- `backend/` — API de negócios
- `frontend/` — painel administrativo
- `database/` — schema SQL
- `docker-compose.yml` — banco PostgreSQL local
- `.gitignore` — arquivos sensíveis

## Como executar

### 1) Instalar dependências

```bash
npm install
npm install --workspace backend
npm install --workspace frontend
```

### 2) Subir o banco PostgreSQL

Se o Docker estiver disponível no ambiente local:

```bash
docker compose up -d
```

### 3) Executar o backend

```bash
npm run dev:backend
```

### 4) Executar o frontend

```bash
npm run dev:frontend
```

### 5) Popular dados iniciais

```bash
node backend/src/scripts/seed.js
```

## Credenciais de teste

Usuário administrador de exemplo:

- Clínica: `11111111-1111-1111-1111-111111111111`
- E-mail: `admin@clinicacentral.com.br`
- Senha: `Admin123!`

> Ajuste os valores conforme o seu ambiente real, caso a clínica seja criada com outro UUID.

## Endpoints principais

### Autenticação

- `POST /api/auth/login`
- `GET /api/auth/me`

### Clínicas

- `GET /api/clinics`
- `GET /api/clinics/users`

### Profissionais

- `GET /api/professionals`
- `POST /api/professionals`

### Pacientes

- `GET /api/patients`
- `POST /api/patients`

### Agenda

- `GET /api/schedules/professionals/:professionalId`
- `POST /api/schedules/professionals/:professionalId`
- `POST /api/schedules/professionals/:professionalId/blocks`

### Agendamentos

- `GET /api/appointments`
- `POST /api/appointments`
- `PATCH /api/appointments/:id/status`
- `PATCH /api/appointments/:id/cancel`
- `PATCH /api/appointments/:id/reschedule`

### Pagamentos

- `GET /api/payments`
- `POST /api/payments`

### Auditoria

- `GET /api/audit`

## Observação

Essa é uma base sólida para o sistema e segue o roteiro proposto, porém ainda precisa de refinamentos e validações no ambiente real para alcançar a produção completa.
