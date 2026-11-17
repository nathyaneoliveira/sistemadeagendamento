# Guia funcional e técnico do NOA CONNECT

Este documento descreve o funcionamento implementado no repositório: áreas da aplicação, fluxos, API, autenticação, dados, configuração e limitações conhecidas. Ele complementa o [README](./README.md), que contém os comandos de instalação, execução e testes, e o [runbook operacional](./OPERATIONS-RUNBOOK.md), que trata da preparação para hospedagem e operação.

> A existência de uma funcionalidade no código não comprova que ela esteja configurada ou operacional em um ambiente específico. Banco de dados, migrations, SMTP e infraestrutura precisam ser verificados separadamente.

## 1. Visão geral da arquitetura

O sistema é composto por três partes:

1. **Frontend:** aplicação React com Vite e React Router. Reúne páginas comerciais públicas, login, reserva pública de horários, painel da clínica e painel de administração global.
2. **API:** aplicação PHP que valida requisições, autentica usuários, aplica autorização, executa regras de negócio e acessa o PostgreSQL.
3. **Banco de dados:** PostgreSQL com schema e migrations SQL versionados em `database/`.

O frontend e a API são executados separadamente. O frontend consome a API usando `VITE_API_URL`; o servidor aceita a origem configurada em `CORS_ORIGIN`. O frontend não acessa o PostgreSQL diretamente.

```text
Navegador
  ├── páginas comerciais e reserva pública ──┐
  ├── painel da clínica ─────────────────────┼──> API PHP ──> PostgreSQL
  └── painel de administração global ────────┘
```

### Tecnologias e pontos de entrada

| Componente | Implementação principal |
|---|---|
| Aplicação web | `frontend/src/main.jsx`, `frontend/src/routes.jsx` |
| Painel da clínica | `frontend/src/App.jsx` |
| Site público/comercial | `frontend/src/CommercialSite.jsx` |
| Reserva pública | `frontend/src/PublicBooking.jsx` |
| Acesso e recuperação de senha | `frontend/src/AuthPages.jsx` e tela de login em `frontend/src/App.jsx` |
| Administração global | `frontend/src/PlatformAdmin.jsx` |
| Inicialização e rotas HTTP | `php-backend/public/index.php`, `php-backend/src/bootstrap.php` |
| Conexão PostgreSQL | `php-backend/src/bootstrap.php` |
| Schema de instalação nova | `database/schema.sql` |
| Migrations incrementais | `database/migrations/` |

## 2. Áreas e navegação

### 2.1 Site comercial público

As rotas `/`, `/recursos`, `/planos`, `/sobre` e `/contato` exibem seções do site comercial. O conteúdo apresenta recursos, proposta dos planos, informações de segurança e contato. A seleção de tema também está disponível.

Os preços e as características comerciais vêm do catálogo compartilhado em `shared/planCatalog.js`. As páginas comerciais são informativas: **não existe checkout, cobrança real nem contratação automática de assinatura**.

### 2.2 Acesso à clínica

- `/login`: autenticação de usuário de clínica.
- `/register`: explicação de que não há cadastro autônomo de clínica/conta.
- `/forgot-password`: solicitação de recuperação por e-mail.
- `/reset-password`: formulário para concluir a redefinição usando o token recebido.
- `/clinic/dashboard`, `/clinic/professionals`, `/clinic/services`, `/clinic/schedule`, `/clinic/appointments` e `/clinic/settings`: áreas do painel autenticado.

O painel da clínica tem as seguintes áreas principais:

| Área | Funcionamento |
|---|---|
| Dashboard | Apresenta visão resumida e próximas consultas. Para usuários administradores, consulta também o resumo da assinatura. |
| Profissionais | Lista e administra profissionais, especialidades, horários semanais e bloqueios de agenda. |
| Serviços | Mantém o catálogo da clínica, incluindo duração, preço, profissionais habilitados e estado ativo/inativo. |
| Agenda | Consulta horários disponíveis e permite criar um agendamento ou iniciar um reagendamento. |
| Consultas | Lista agendamentos e expõe ações permitidas, incluindo cancelamento e reagendamento. |
| Configurações | Permite ajustar dados apresentados pela clínica, fuso horário e identificador da página pública de reserva. |

Pacientes são recursos da API e participam dos fluxos de agendamento. Não há uma rota de navegação independente de pacientes na lista principal do painel.

### 2.3 Reserva pública

`/booking/:clinicSlug` abre a página pública da clínica quando ela está configurada e disponível. A jornada é:

1. Carregar identificação, contato e fuso horário da clínica.
2. Listar serviços ativos disponíveis para pelo menos um profissional ativo.
3. Selecionar um serviço e carregar os profissionais associados.
4. Selecionar profissional e data; consultar horários disponíveis.
5. Informar nome, telefone e, opcionalmente, e-mail.
6. Enviar a solicitação de agendamento e mostrar a confirmação retornada pela API.

A página mantém uma chave de idempotência por sessão/navegador para reduzir duplicações em novas tentativas. A chave não substitui a validação de disponibilidade no servidor. A API revalida clínica, serviço, profissional, horário e conflitos no momento de criar o agendamento.

### 2.4 Administração da plataforma

`/platform-admin` é uma área separada para contas administrativas globais. O código tem autenticação própria, sessão e trilha de auditoria distintas das contas de clínica. As telas cobrem visão geral, clínicas e assinaturas; eventos administrativos podem ser consultados pela API.

O painel global não é um papel clínico e não deve ser acessado com o token de usuário da clínica. As rotas globais disponíveis são predominantemente de consulta; este conjunto não implementa um portal de provisionamento público.

## 3. Contas, autenticação e autorização

### 3.1 Tipos de conta e papéis

Contas clínicas pertencem a uma clínica (`clinic_id`) e têm um destes papéis no schema:

- `admin`
- `reception`
- `professional`
- `patient`

Os papéis são verificados nas rotas da API. Em linhas gerais, ações de configuração e gestão de usuários são mais restritas a administradores; operações diárias são permitidas a administradores e recepção conforme a rota; operações ligadas ao próprio paciente podem permitir o papel `patient`. A permissão efetiva deve ser consultada na rota específica: não se deve assumir que todos os papéis têm as mesmas ações.

Contas administrativas globais ficam na tabela separada `platform_admin_accounts` e usam endpoints e middleware próprios.

### 3.2 Login clínico e sessões

O login recebe e-mail e senha. A API determina a clínica pela associação da conta, não por um `clinic_id` fornecido pelo cliente. Como o e-mail é único por clínica, um mesmo endereço pode existir em clínicas distintas. Se a autenticação exigir escolha entre contas válidas, a API retorna um token de seleção temporário; o cliente envia esse token e a clínica escolhida a `/api/auth/login/select-clinic`, e a API verifica que a opção pertence ao token antes de emitir a sessão.

O JWT clínico usa HS256, emissor e audiência configurados no backend, e inclui a identidade da conta, clínica e versão da sessão. Nas requisições autenticadas, o middleware verifica assinatura, expiração, conta ativa e versão atual de `token_version`. A aplicação cliente mantém o token clínico no `localStorage` do navegador.

O logout incrementa a versão de sessão no banco, invalidando tokens anteriores daquela conta. A redefinição de senha também atualiza essa versão.

### 3.3 Cadastro de usuários

Não há cadastro público de clínicas nem criação autônoma de conta pela tela de login. A criação de usuário da clínica está disponível pela rota autenticada `POST /api/auth/register`, restrita a `admin` e à capacidade de gestão de usuários do plano. A rota associa o novo usuário à clínica da sessão; não aceita a clínica como autoridade do pedido.

As senhas são armazenadas como hash usando bcryptjs. A política implementada exige ao menos 12 caracteres e limita a entrada a 72 bytes em UTF-8. O limite de bytes corresponde ao mecanismo de hash, não a um limite de armazenamento de senha em texto puro.

### 3.4 Recuperação de senha

O fluxo é composto por:

1. `POST /api/auth/password-reset/request`: valida e normaliza o e-mail, aplica limites por IP e e-mail, e responde genericamente para não confirmar se a conta existe.
2. O serviço gera tokens aleatórios de uso único, grava somente o hash e associa cada token a uma conta clínica.
3. O e-mail contém o link gerado a partir de `PUBLIC_APP_URL`; o link expira em 30 minutos.
4. `/reset-password` envia token, senha e confirmação a `POST /api/auth/password-reset/confirm`.
5. A API valida a política da senha, verifica e consome o token e incrementa a versão de sessão.

Se um e-mail corresponder a mais de uma conta clínica ativa, o serviço pode enviar um link individual por conta; a resposta HTTP permanece genérica. O fluxo requer migration `011_password_reset_tokens.sql` aplicada e configuração SMTP completa. Sem configuração necessária, a API não deve simular um envio bem-sucedido.

## 4. Funcionamento dos agendamentos

### 4.1 Dados usados para calcular horários

A disponibilidade considera:

- horários semanais ativos de trabalho do profissional;
- duração do serviço selecionado e intervalo configurado na jornada;
- fuso horário IANA da clínica;
- bloqueios ativos que cruzam o período solicitado;
- agendamentos não cancelados que ocupam o mesmo intervalo.

O servidor calcula a disponibilidade. Uma lista de horários mostrada no browser não garante que o horário continuará livre; a API valida novamente durante a criação. A constraint de exclusão GiST do schema também impede sobreposição de consultas não canceladas para o mesmo profissional, inclusive em concorrência, se o schema/migration correspondente estiver instalado.

### 4.2 Criação, atualização, cancelamento e reagendamento

- `POST /api/appointments` cria um agendamento da clínica autenticada.
- O serviço é obrigatório para novos agendamentos. Preço e duração vêm do serviço existente; o cliente não é autoridade para esses valores.
- O registro guarda snapshots de nome, preço e duração do serviço, preservando o histórico se o serviço mudar ou for desativado.
- `PATCH /api/appointments/:id` atualiza somente notas e exige papel de administrador ou recepção.
- `PATCH /api/appointments/:id/status` aplica a matriz de transições permitidas dentro de uma transação que bloqueia o agendamento.
- `PATCH /api/appointments/:id/cancel` cancela somente estados elegíveis e mantém a autorização existente.
- `PATCH /api/appointments/:id/reschedule` marca o registro original como `rescheduled` e cria um novo `scheduled` ligado ao anterior, após validar autorização e disponibilidade.

A matriz implementada é `scheduled → confirmed|cancelled` e `confirmed → completed|cancelled|no_show`. `completed`, `cancelled` e `no_show` são estados finais; transições para o mesmo estado também são rejeitadas. `rescheduled` é um estado histórico e não ocupa a agenda. Os bloqueios de linha mantêm a validação do estado e a alteração atômicas. Em bancos existentes, o vínculo histórico e a atualização da constraint dependem da migration `016_appointment_state_machine.sql`, ainda não executada.

### 4.3 Reserva pública e duplicações

Os endpoints públicos expõem apenas dados necessários à reserva: clínica configurada para reserva, serviços ativos, profissionais elegíveis e horários. O endpoint de criação usa transação, validação de conflitos e chave de idempotência por clínica. A disponibilidade pública depende de uma assinatura válida conforme as regras de acesso do plano.

## 5. Planos, pagamentos internos e auditoria

O catálogo em `shared/planCatalog.js` é fonte comum para a apresentação comercial e para capacidades/limites aplicados no backend. O plano Essencial limita profissionais ativos; o plano Profissional libera recursos adicionais. Os detalhes de preços e limites podem evoluir no catálogo e não são repetidos neste guia para evitar divergência.

O backend verifica status e período da assinatura e aplica capacidades e limites ao uso de recursos. A ausência de uma assinatura válida pode bloquear endpoints que exigem assinatura ativa. A tabela `subscriptions` não é preenchida automaticamente e o endpoint clínico expõe apenas a assinatura atual para administradores.

Há endpoints internos para registrar pagamentos ligados a agendamentos e atualizar seus status. Isso é **controle de registros internos**, não integração com gateway: não há processamento de cartão, captura de cobrança, checkout ou reconciliação de provedor no sistema descrito.

Eventos operacionais de clínica são gravados em `audit_logs`; a consulta está sujeita a papel e capacidade de plano. Eventos de administração global ficam em `platform_audit_logs`. Logs de auditoria não substituem monitoramento de infraestrutura ou alertas.

## 6. API HTTP

Todas as rotas de negócio usam prefixo `/api`. O padrão de resposta usual é `{ "ok": true, "data": ... }`; erros usam `{ "ok": false, "message": ... }`. O formato exato pode variar em respostas paginadas e rotas específicas.

### Saúde

| Método e caminho | Acesso | Resultado |
|---|---|---|
| `GET /api/health` | Público | Verifica se o processo HTTP responde. |
| `GET /api/health/live` | Público | Liveness; não valida conexão ao PostgreSQL. |
| `GET /api/health/ready` | Público | Readiness; executa consulta simples ao PostgreSQL. |

### Autenticação

| Método e caminho | Funcionamento |
|---|---|
| `POST /api/auth/login` | Login de conta clínica. |
| `POST /api/auth/login/select-clinic` | Finaliza login quando uma seleção de clínica é necessária. |
| `POST /api/auth/password-reset/request` | Solicita recuperação por e-mail; resposta não revela existência da conta. |
| `POST /api/auth/password-reset/confirm` | Valida token e define nova senha. |
| `POST /api/auth/register` | Cria usuário na clínica da sessão; requer admin e capacidade de gestão de usuários. |
| `GET /api/auth/me` | Retorna o perfil da sessão autenticada. |
| `POST /api/auth/logout` | Invalida a versão atual da sessão. |

### Recursos da clínica

| Prefixo | Rotas principais | Uso |
|---|---|---|
| `/api/clinics` | `GET /`, `GET /users` | Dados da clínica e listagem de usuários, de acordo com papel/plano. |
| `/api/professionals` | `GET /`, `POST /`, `GET /:id`, `PUT /:id`, `PATCH /:id/status` | Gestão de profissionais. |
| `/api/patients` | `GET /`, `POST /`, `GET /:id`, `PUT /:id` | Consulta e gestão de pacientes. |
| `/api/specialties` | `GET /`, `GET /:id`, `POST /`, `PUT /:id` | Catálogo de especialidades. |
| `/api/services` | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `PATCH /:id/status`, `PUT /:id/professionals` | Serviços e associações com profissionais. |
| `/api/schedules` | `GET /professionals/:professionalId`, `POST /professionals/:professionalId`, `POST /professionals/:professionalId/blocks`, `GET /professionals/:professionalId/availability` | Horários semanais, bloqueios e disponibilidade. |
| `/api/appointments` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `PATCH /:id/status`, `PATCH /:id/cancel`, `PATCH /:id/reschedule` | Consultas e agendamentos. |
| `/api/settings` | `GET /`, `POST /` | Configurações da clínica, timezone e reserva pública. |
| `/api/audit` | `GET /` | Consulta de auditoria da clínica, limitada por acesso e plano. |
| `/api/payments` | `GET /`, `POST /`, `PATCH /:id/status` | Registros internos de pagamento. |
| `/api/subscriptions` | `GET /current` | Assinatura mais recente da clínica autenticada. |

As rotas de clínica obtêm a clínica da sessão e restringem as consultas ao respectivo `clinic_id`. O corpo da requisição não deve ser tratado como fonte confiável para selecionar outro tenant.

### Reserva pública

| Método e caminho | Funcionamento |
|---|---|
| `GET /api/public/clinics/:clinicSlug` | Dados públicos da clínica. |
| `GET /api/public/clinics/:clinicSlug/services` | Serviços ativos com profissionais ativos elegíveis. |
| `GET /api/public/clinics/:clinicSlug/services/:serviceId/professionals` | Profissionais ativos associados ao serviço. |
| `GET /api/public/clinics/:clinicSlug/services/:serviceId/professionals/:professionalId/availability?date=AAAA-MM-DD` | Horários disponíveis na data e fuso da clínica. |
| `POST /api/public/clinics/:clinicSlug/appointments` | Cria pedido/agendamento público sujeito a revalidação e idempotência. |

### Administração global

| Método e caminho | Funcionamento |
|---|---|
| `POST /api/platform/auth/login` | Login de administrador global. |
| `GET /api/platform/auth/me` | Consulta a sessão global. |
| `POST /api/platform/auth/logout` | Revoga sessão global. |
| `GET /api/platform/dashboard` | Métricas agregadas por período. |
| `GET /api/platform/clinics` | Lista clínicas com filtros/paginação. |
| `GET /api/platform/clinics/:clinicId` | Detalhes de clínica. |
| `GET /api/platform/subscriptions` | Lista assinaturas com filtros/paginação. |
| `GET /api/platform/events` | Lista eventos globais recentes. |

As rotas administrativas de dados exigem autenticação global depois do login. Não são endpoints públicos nem devem ser autorizadas com JWT de uma clínica.

## 7. Modelo de dados

O schema organiza dados em torno da clínica. Entidades principais:

| Tabela | Finalidade |
|---|---|
| `clinics` | Identidade e dados cadastrais da clínica. |
| `users` | Contas clínicas, papéis, estado e versão de sessão. E-mail é único dentro da clínica. |
| `platform_admin_accounts` | Contas separadas para administração global. |
| `password_reset_tokens` | Hash de token, conta associada, expiração e consumo. |
| `specialties` | Especialidades clínicas. |
| `professionals` | Profissionais associados à clínica e opcionalmente a uma conta. |
| `services` e `professional_services` | Catálogo de serviços e profissionais que os oferecem. |
| `patients` | Cadastro de pacientes e associação opcional com usuário. |
| `professional_schedules` | Horários recorrentes por dia da semana. |
| `schedule_blocks` | Férias, feriados, reuniões, ausências ou bloqueios personalizados. |
| `appointments` | Agendamentos, status, horários, serviço e snapshots comerciais. |
| `payments` | Registros internos ligados a agendamentos. |
| `subscriptions` | Plano, ciclo, período e status da assinatura. |
| `settings` e `clinic_configurations` | Configurações gerais e apresentação/reserva pública da clínica. |
| `audit_logs` e `platform_audit_logs` | Auditoria clínica e global, separadas. |

O schema usa chaves estrangeiras compostas para reforçar a consistência de clínica entre entidades. Os identificadores UUID não substituem autorização: as rotas também precisam filtrar pela clínica da sessão. Agendamentos não cancelados têm constraint de exclusão por intervalo/profissional para impedir sobreposição.

### Schema e migrations

- `database/schema.sql` descreve o schema para instalação nova.
- `database/migrations/` contém alterações incrementais destinadas a bancos existentes.
- A aplicação não executa migrations durante a inicialização.
- A migration correta depende do estado real do banco; não se deve reaplicar migration nem executar `schema.sql` sobre banco existente sem revisão.
- A migration 011 adiciona persistência de tokens de recuperação. A migration 010 cria estruturas da administração global; a instalação nova já inclui essas estruturas no schema — não aplicar a migration 010 sobre um schema completo recém-criado.

Consulte as instruções de revisão e aprovação do banco em [OPERATIONS-RUNBOOK.md](./OPERATIONS-RUNBOOK.md). Nenhuma migration deve ser executada contra um banco não identificado ou sem cópia/procedimento aprovados.

## 8. Segurança e configuração de execução

### Controles observados

- Cabeçalhos HTTP de segurança definidos pelo front controller PHP.
- CORS limitado à origem configurada.
- Limite de tamanho de JSON de 1 MB.
- Autenticação JWT, papéis e verificação de sessão ativa.
- Consultas SQL parametrizadas nas rotas inspecionadas.
- Limites de requisição para API, login, agendamento e recovery.
- Filtros por clínica e constraints relacionais no PostgreSQL.
- Identificador de requisição para correlação de erros.

Os limitadores são guardados em memória por processo. Contagens não são compartilhadas entre réplicas e se perdem com reinicialização. A API PHP usa o endereço de conexão recebido em `REMOTE_ADDR`; ela não confia automaticamente em `X-Forwarded-For`. A topologia e a confiança no proxy precisam ser definidas antes de publicar ou escalar. Os cabeçalhos HTTP da API não configuram os cabeçalhos do host que serve os arquivos estáticos do frontend.

### Variáveis de ambiente

Os nomes abaixo descrevem a configuração suportada; valores reais devem ser fornecidos pelo ambiente e não devem ser versionados ou incluídos neste documento.

| Variável | Uso |
|---|---|
| `NODE_ENV` | Deve ser explicitamente `development`, `test` ou `production`. |
| `PORT` | Porta do servidor HTTP local; produção deve configurar a porta e o encaminhamento no servidor web/PHP-FPM da plataforma. |
| `JWT_SECRET` | Chave de assinatura; requer no mínimo 32 bytes e não pode ter espaços externos. |
| `JWT_EXPIRES_IN` | Expiração do JWT; opcional, padrão de 8 horas. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Conexão PostgreSQL; explícitas e obrigatórias em produção. |
| `DB_SSL` | TLS do PostgreSQL; obrigatório em produção e com certificado validado. |
| `DB_SSL_CA_PATH` | Opcional, quando for necessário informar uma CA própria. |
| `CORS_ORIGIN` | Origem autorizada do frontend; deve ser HTTPS explícito em produção. |
| `VITE_API_URL` | URL base da API incorporada no build do frontend; HTTPS obrigatório em build de produção. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Transporte de e-mail de recuperação. |
| `PUBLIC_APP_URL` | Origem do frontend usada para construir o link de redefinição; HTTPS obrigatório em produção. |

`php-backend/src/bootstrap.php` carrega `backend/.env` por padrão; `NOA_ENV_FILE` pode selecionar outro arquivo. Antes de iniciar a aplicação ou scripts, confirme qual configuração será carregada. Não imprima variáveis de ambiente nem coloque segredos em `VITE_*`, no Git, em argumentos de comando ou em logs.

Em produção, o runtime PHP rejeita configuração crítica ausente, segredo JWT fraco, banco local/default, CORS não HTTPS e TLS de banco desabilitado. O PHP abre conexões PostgreSQL conforme o ciclo de requisição; dimensione PHP-FPM e limites do banco em conjunto.

## 9. Execução, build e testes

Os comandos a seguir são definidos nos manifests. Para instruções locais completas e precauções de ambiente, use a seção **Como executar** do README.

```powershell
# Na raiz do repositório
npm ci

# Em terminais PowerShell separados
npm run dev:backend
npm run dev:frontend

# Build do frontend
npm run build:frontend

# Smoke test e guardas de segurança do backend PHP
& .\php-backend\test.ps1
php .\php-backend\test\security-p0.php

# Testes do frontend
node --test frontend/test/*.test.js
```

O Docker Compose existente é destinado ao PostgreSQL local, não é implantação de produção e usa volume persistente. Revise o serviço e confirme o destino antes de iniciá-lo. Não execute testes de integração PostgreSQL até confirmar que a instância é isolada e descartável; essas suítes podem criar ou alterar schema e dados.

## 10. Limitações e pendências do produto/operação

O código/documentação atuais indicam as seguintes fronteiras:

- Não existe onboarding público para criar clínica ou administrador.
- A página de planos não contrata nem cobra; não há gateway de pagamento.
- A administração global não deve ser confundida com administração de clínica.
- A recuperação depende da migration 011 e de SMTP configurado; o código sozinho não comprova entrega de e-mail.
- A migration `016_appointment_state_machine.sql` precisa ser aplicada pelo processo autorizado antes que o vínculo de reagendamento e a liberação de horários `rescheduled` estejam disponíveis em bancos existentes.
- Rate limiting é por processo, não compartilhado entre réplicas.
- O repositório não contém Dockerfile da aplicação, configuração de proxy reverso nem pipeline de CI/CD.
- O host estático, DNS, TLS externo, cabeçalhos do frontend, monitoramento, alertas, backups e restauração dependem da infraestrutura escolhida e dos procedimentos do runbook.
- `robots.txt` e `llms.txt` existem; a criação de `sitemap.xml` depende da definição de domínio canônico e páginas públicas indexáveis.

Esses itens não são afirmação de falha em um ambiente específico. São pontos cujo estado depende de configuração, decisão de negócio ou validação operacional.

## 11. Fontes de verdade para manutenção

Ao alterar o sistema, mantenha alinhados:

- rotas do frontend em `frontend/src/routes.jsx`;
- navegação e fluxos do painel em `frontend/src/App.jsx`, `frontend/src/AuthPages.jsx`, `frontend/src/PublicBooking.jsx` e `frontend/src/PlatformAdmin.jsx`;
- montagem de rotas e regras da API em `php-backend/public/index.php` e `php-backend/src/bootstrap.php`;
- regras comerciais em `shared/planCatalog.js`;
- estrutura do banco em `database/schema.sql` e migrations;
- comandos e variáveis nos `package.json`, `php-backend/src/bootstrap.php` e exemplos de ambiente;
- documentação operacional no README e no runbook.

Quando uma capacidade ainda não existe, documente-a como pendente em vez de apresentar uma tela ou registro interno como se fosse uma integração completa.
