# Sistema de agendamento para clínica

## Visão geral

Este projeto foi desenvolvido como base arquitetural para um sistema de agendamento para clínicas, com separação entre frontend, backend e banco de dados, além de autenticação, autorização e regras de agendamento.

## Stack

- Frontend: React + Vite
- Backend principal: PHP 8.1+ com PostgreSQL
- Banco: PostgreSQL
- Segurança: JWT, CORS, rate limiting, cabeçalhos de segurança e validações

O comando `npm run dev:backend` inicia a API PHP. Node.js é usado apenas como ferramenta para dependências, desenvolvimento e testes do frontend; não há backend Node no projeto.

## Estrutura

- `backend/` — configuração local e modelo de ambiente carregados pela API PHP
- `php-backend/` — API HTTP e regras de negócio em PHP
- `frontend/` — site público, reserva online e painel administrativo
- `database/` — schema SQL
- `Dockerfile` e `deploy/` — imagem de staging que serve frontend e API PHP na mesma origem
- `docker-compose.yml` — banco PostgreSQL local
- `.gitignore` — arquivos sensíveis

Para uma descrição detalhada das áreas, fluxos, API, autenticação e modelo de dados, consulte o [Guia funcional e técnico](./SYSTEM-GUIDE.md).

## Área pública e acesso

O frontend oferece a área pública em `/`, com seções acessíveis em `/recursos`, `/planos`, `/sobre` e `/contato`. `/login` abre a autenticação existente; `/booking/<identificador>` mantém a reserva pública da clínica. O painel autenticado continua no mesmo frontend.

O cadastro autônomo de clínicas ainda não existe. Novas contas de usuário são criadas por um administrador autenticado da clínica; portanto, **Criar conta** direciona a uma explicação e não oferece cadastro público. Os cards de planos apresentam a proposta comercial Essencial e Profissional. Eles não iniciam contratação: a página mantém o acesso pelo login existente, sem checkout ou cobrança. O tema compartilhado entre as áreas pública e autenticada é salvo no navegador.

**Esqueci minha senha** usa `POST /api/auth/password-reset/request` e `POST /api/auth/password-reset/confirm`. Os links são de uso único, expiram em 30 minutos e são armazenados somente como hash. Redefinir a senha incrementa a versão de sessão da conta. Se o mesmo e-mail estiver ligado a mais de uma conta/clínica, a mensagem contém um link individual por conta, sem revelar a associação na resposta da API.

A recuperação depende de SMTP e de `PUBLIC_APP_URL`, configurados somente no ambiente do backend: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`true` para TLS implícito ou `false` para STARTTLS obrigatório), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` e `PUBLIC_APP_URL` (origem do frontend, sem caminho; HTTPS obrigatório em produção). A configuração ausente ou parcial mantém o endpoint indisponível, sem simular sucesso. Use um transportador de e-mail simulado nos testes; não configure credenciais reais. Os limitadores de recuperação são armazenados em memória por processo e não agregam contagens entre réplicas.

### Lembretes, portal do paciente e contratação

Em bancos existentes, revise e aplique em ordem as migrations `012_patient_tools_and_reminders.sql`, `013_mercadopago_checkout.sql`, `014_payment_received_at.sql`, `015_safe_payment_webhooks.sql` e `017_clinic_privacy_profile.sql`; migrations são manuais e não rodam no startup. A migration 015 classifica suspensões existentes sem motivo conhecido como administrativas, por segurança. Revise e reconcilie esses casos antes de aplicar; pagamento não reativa suspensões administrativas. A migration 017 garante a tabela de configurações por clínica usada pelo perfil de privacidade. Para instalação limpa, `database/schema.sql` já inclui essas estruturas. Lembretes só entram na fila quando a clínica ativa a opção e o paciente consente; SMTP usa as variáveis existentes. Para WhatsApp configure `WHATSAPP_API_URL` e `WHATSAPP_API_TOKEN` para um endpoint que aceite `POST` JSON `{to, message}`. Checkout Mercado Pago exige `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_WEBHOOK_URL` e `PUBLIC_APP_URL` no backend. Cadastre no painel do Mercado Pago a mesma URL de webhook, valide-a em sandbox e só depois configure credenciais de produção. Notificações aprovadas são validadas e processadas idempotentemente; aprovações após falha/expiração são registradas como `paid_late`, sem ativar assinatura ou clínica. Confira filtros/rede do provedor e monitoramento de entregas em produção.

Os arquivos `frontend/public/robots.txt` e `frontend/public/llms.txt` descrevem a área pública sem definir um domínio. O `sitemap.xml` deve ser configurado quando houver um domínio canônico aprovado.

Para o inventário da configuração de produção, publicação, operação e pendências que dependem da plataforma, consulte [OPERATIONS-RUNBOOK.md](./OPERATIONS-RUNBOOK.md). Ainda não há Dockerfile de aplicação nem pipeline CI/CD; o único Compose do repositório é para PostgreSQL local.

Para o inventário técnico de dados pessoais, controles existentes, retenção observada e pendências de privacidade, consulte [docs/PRIVACIDADE-LGPD.md](./docs/PRIVACIDADE-LGPD.md). O documento não declara conformidade jurídica nem define prazos de conservação.

## Como executar

### 1) Instalar dependências

```bash
npm ci
```

O comando usa o `package-lock.json` da raiz para instalar as dependências do workspace frontend.

### 2) Configuração local segura

O backend exige `NODE_ENV` explícito e `JWT_SECRET` com pelo menos 32 bytes. No modo `development`, os parâmetros de banco têm defaults de desenvolvimento; prefira, ainda assim, definir explicitamente as variáveis `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` e `CORS_ORIGIN` para o PostgreSQL local escolhido. Não copie configurações de produção.

O backend PHP carrega `backend/.env` por padrão. `NOA_ENV_FILE` seleciona outro arquivo; use `php://memory` para impedir a leitura de um `.env` durante operações administrativas e injete somente as variáveis necessárias pelo mecanismo seguro aprovado. Nunca coloque valores secretos em comandos, argumentos, logs ou no frontend.

Em produção, o runtime PHP exige configuração explícita de banco e origem CORS HTTPS; DB TLS também é obrigatório. Builds de produção do frontend exigem `VITE_API_URL` HTTPS, exceto quando frontend e API são servidos pela mesma origem, caso em que `/api` é aceito. Os nomes de variáveis são descritos em `php-backend/src/bootstrap.php` e `backend/.env.example`; seus valores dependem do ambiente e não devem ser documentados aqui.

Os inventários JSON em [`docs/json/`](./docs/json/) registram variáveis de configuração, campos das entidades, exemplos de API e status/erros observados. São documentação, não são carregados pelo runtime e não alteram contratos ou funcionalidades.

### 3) Subir o banco PostgreSQL

Se o Docker estiver disponível no ambiente local:

```bash
npm run db:up
```

Este comando inicia o serviço `postgres` definido no `docker-compose.yml`, cujo volume é persistente. Usar somente para o PostgreSQL local de desenvolvimento após conferir o serviço e o destino. Não é um banco de integração descartável, e não deve ser confundido com o container/banco isolado documentado no `OPERATIONS-RUNBOOK.md`.

### 4) Executar o backend

Em uma instalação nova, use `database/schema.sql`, que inclui o fuso da clínica, o catálogo de serviços e a estrutura de assinaturas, inclusive as tabelas administrativas globais e de tokens de recuperação. **Não aplique a migration 010 sobre esse schema.** Em bancos existentes, aplique somente migrations ainda pendentes, respeitando a ordem exigida pelo estado do banco: a migration `001_add_users_token_version.sql` prepara o controle de sessão, `005_add_clinic_timezone.sql` adiciona `clinic_configurations.timezone` com padrão `UTC`, `006_add_services.sql` cria serviços e snapshots opcionais, `007_public_booking.sql` adiciona identificadores públicos e chaves de idempotência, `008_clinic_subscriptions.sql` cria a estrutura interna de assinaturas, `009_commercial_plan_tiers.sql` amplia a constraint de planos sem modificar registros existentes, `010_platform_admin_accounts.sql` adiciona contas e auditoria separadas para a administração global, `011_password_reset_tokens.sql` cria a tabela dos hashes de tokens vinculados a contas clínicas e `017_clinic_privacy_profile.sql` garante a tabela `settings` para o perfil de privacidade por clínica. Não aplique uma migration se seus objetos já existirem; revise o estado do banco e a migration antes de executá-la. Migrations não são executadas automaticamente pela aplicação. Consulte `OPERATIONS-RUNBOOK.md` para revisão, confirmação do destino, registro e plano de recuperação das migrations.

### Assinaturas SaaS e cobrança Mercado Pago

`GET /api/subscriptions/current` retorna a assinatura mais recente da clínica autenticada apenas para usuários administradores; se ainda não houver registro, retorna `data: null`. O endpoint não aceita `clinic_id` como fonte de autoridade. A contratação pública cria sessão pendente via Mercado Pago. O webhook valida assinatura, ID, moeda e valor do pagamento antes de transicionar a sessão. Pagamentos tardios ficam registrados como `paid_late` sem conceder acesso; notificações repetidas não reaplicam a transição. Pagamento aprovado pode ativar somente clínicas suspensas por `onboarding` ou `billing`; suspensão `administrative` permanece bloqueada. A migration 015 adiciona o motivo de suspensão e a unicidade do ID Mercado Pago em pagamentos de agendamento; ela não foi executada neste trabalho e deve ser revisada e aplicada pelo processo autorizado.

Planos, preços e regras comerciais vivem em `shared/planCatalog.js`, consumido pelo backend e pela página comercial. Os preços ficam em centavos inteiros. No ciclo mensal, o preço informado é cobrado por mês; nos ciclos trimestral e anual, o preço informado é o total do período, e a página separa esse total do equivalente mensal:

| Plano | Mensal | Total trimestral | Total anual | Funcionários ativos | Pacientes | Agendamentos | Serviços |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Essencial | R$ 150,00 | R$ 400,00 | R$ 1.400,00 | Até 5 | Ilimitados | Ilimitados | Ilimitados |
| Profissional | R$ 250,00 | R$ 675,00 | R$ 2.400,00 | Ilimitados | Ilimitados | Ilimitados | Ilimitados |

Os equivalentes mensais trimestrais são R$ 133,33 no Essencial e R$ 225,00 no Profissional; os anuais são R$ 116,67 e R$ 200,00, respectivamente. A economia é comparada ao pagamento mensal pelo mesmo número de meses; não há oferta de parcelamento.

O limite de funcionários conta somente registros ativos em `professionals` (`status = 'active'`). Funcionários inativos não ocupam vaga, mas a reativação verifica o limite dentro de uma transação protegida por lock consultivo da clínica. Administradores e outros usuários não são contados como funcionários. Pacientes, agendamentos e serviços não têm limite comercial nestes planos.

`complete` e `premium` permanecem reconhecidos internamente para assinaturas históricas e não aparecem como planos comerciais. A compatibilidade de `complete` aponta para Profissional como equivalência comercial/de recursos, preservando o identificador, preço, ciclo, datas, estado e permissões existentes; suas condições históricas de limite ilimitado também são mantidas. `premium` continua com seu catálogo histórico sem alteração. Nenhuma assinatura é convertida ou reprecificada automaticamente. A tabela `subscriptions` armazena plano, ciclo, estado e período, não um preço congelado por contrato; o preço exibido e auditado é consultado no catálogo.

Essencial disponibiliza os recursos básicos já existentes. Profissional inclui esses recursos e, adicionalmente, gestão de usuários, permissões básicas, registros internos de pagamento e consulta de auditoria. Os registros de pagamento não processam cobranças. Relatórios, dashboard completo, exportações, permissões/auditoria avançadas e personalização avançada não são anunciados como funcionalidades disponíveis.

Recursos autenticados e reserva pública exigem uma assinatura `active` ou `trialing` cujo período vigente não expirou; `past_due`, `cancelled`, `expired`, período encerrado ou assinatura ausente não concedem acesso. O limite de funcionários ativos é verificado no backend durante cadastro e reativação, dentro de uma transação com lock consultivo por clínica para impedir excedentes concorrentes. A API retorna `PLAN_LIMIT_REACHED` ou `PLAN_FEATURE_NOT_AVAILABLE` com os metadados necessários à interface. As transições internas permitidas continuam `trialing → active|cancelled|expired`, `active → past_due|cancelled|expired`, `past_due → active|cancelled|expired` e `cancelled → expired`; `expired` é terminal. Trials não são iniciados automaticamente. Identificadores opcionais de gateway são metadados; credenciais não são armazenadas nessa tabela. Eventos de criação, atualização, cancelamento e trial usam o mecanismo existente de auditoria na mesma transação.

### Administração global da plataforma

`/platform-admin` é uma área separada do painel das clínicas. Usa contas exclusivas em `platform_admin_accounts`, tokens JWT com audiência própria e autorização verificada no backend em cada requisição; papéis `admin` de clínica não concedem acesso global. O token global permanece apenas em memória no navegador. Endpoints: `POST /api/platform/auth/login`, `GET /api/platform/auth/me`, `POST /api/platform/auth/logout`, `GET /api/platform/dashboard`, `GET /api/platform/clinics`, `GET /api/platform/clinics/:clinicId`, `GET /api/platform/subscriptions` e `GET /api/platform/events`. A consulta global é somente leitura nesta etapa. A migration `010_platform_admin_accounts.sql` precisa ser revisada e aplicada por operador autorizado antes de ativar a área; não há migration automática.

Para provisionar uma conta, o operador autorizado deve confirmar que as tabelas administrativas existem no banco correto (criadas pelo schema completo em instalação nova ou pela migration 010 em banco existente), injetar `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME`, `PLATFORM_ADMIN_PASSWORD` e `PLATFORM_ADMIN_PROVISIONING_CONFIRM=CREATE_PLATFORM_ADMIN` somente no ambiente do processo a partir de um mecanismo seguro e executar `php .\\php-backend\\bin\\provision-platform-admin.php` uma vez. Use senha forte e única, não a grave em `.env`, no frontend, em documentação ou no histórico do shell; remova imediatamente os valores temporários. O script não contém credenciais padrão e não atualiza contas existentes. O runbook descreve os cuidados com configuração e diretório de trabalho.

Novas senhas definidas no cadastro clínico e no provisionamento administrativo devem conter pelo menos 12 pontos de código Unicode e no máximo 72 bytes em UTF-8, limite efetivo do bcrypt. O login continua aceitando senhas legadas de até 1024 caracteres; não há redefinição forçada nem alteração de sessões existentes. Contas antigas criadas com senhas acima do limite de bytes ainda podem depender do comportamento histórico de truncamento do bcrypt e devem ser migradas por um fluxo de redefinição autorizado, caso exista.

O token clínico permanece em `localStorage`, o que mantém a sessão após recarregar a página, mas deixa o token acessível a JavaScript executado na origem em caso de XSS. Alternativas a avaliar separadamente são mantê-lo apenas em memória (reduz persistência, mas exige nova autenticação após recarga) ou migrar para cookie `HttpOnly`/`Secure`/`SameSite` com validação CSRF e ajustes coordenados no backend, CORS e todos os fluxos clínicos/admin. Nenhuma dessas mudanças de arquitetura foi feita nesta etapa; os testes atuais não comprovam comportamento em navegador real nem a segurança da hospedagem.

MRR estimado considera apenas assinaturas `active` com período vigente: mensal = preço mensal do catálogo; trimestral = total trimestral / 3; anual = total anual / 12, com arredondamento por assinatura para centavos. ARR estimado = MRR × 12. São estimativas de catálogo e não receita recebida. O schema atual não possui status `pending` nem pagamentos associados a assinaturas/gateway. A tabela `payments` registra pagamentos de agendamentos das clínicas; portanto, ela não é usada como receita SaaS. Cobranças e pagamentos de assinatura são mostrados como indisponíveis, sem criar registros fictícios.

```bash
npm run dev:backend
```

### 5) Executar o frontend

```bash
npm run dev:frontend
```

### TLS do PostgreSQL

Em desenvolvimento e testes, `DB_SSL=false` permite conectar ao PostgreSQL local sem TLS. Em produção, configure `DB_SSL=true`; o backend recusa iniciar sem TLS e sempre valida o certificado do servidor. Se o provedor exigir uma CA própria, forneça o caminho do bundle por `DB_SSL_CA_PATH`, sem incluir o certificado no repositório.

Builds de produção do frontend exigem `VITE_API_URL` configurada no ambiente de build com uma URL HTTPS da API ou `/api` quando frontend e API compartilham a mesma origem. O backend exige `CORS_ORIGIN` configurada como origem HTTPS explícita em produção.

`GET /api/health` e `GET /api/health/live` são verificações de liveness do processo e não verificam o banco. `GET /api/health/ready` verifica a dependência do banco e retorna `503` quando ela está indisponível; a validação real em ambiente autorizado permanece pendente. Consulte [OPERATIONS-RUNBOOK.md](./OPERATIONS-RUNBOOK.md) para pendências de backup/DR, proxy, rate limiting e observabilidade.

## Verificações e testes

As verificações PHP e de frontend podem ser executadas sem banco. Execute a partir da raiz:

### Testes do backend PHP

```powershell
& .\php-backend\test.ps1
php .\php-backend\test\security-p0.php
```

O smoke test verifica sintaxe PHP, health checks, validações HTTP, respostas de rotas e outros comportamentos sem banco. A bateria P0 aplica testes unitários e guardas estáticas de segurança; nenhuma delas substitui a integração PostgreSQL.

### Testes do frontend

```bash
node --test frontend/test/*.test.js
```

Os testes do frontend usam `node:test`, renderer de componentes e respostas HTTP sintéticas, sem rede nem banco. A navegação `BrowserRouter` usa History API sintética e não substitui testes em navegadores reais.

### Integração PostgreSQL — somente instância descartável

Os testes de integração criam e/ou alteram tabelas e dados. Nunca os apontar para o banco de desenvolvimento persistente, compartilhado ou de produção. Antes de habilitá-los, criar/identificar uma instância isolada e descartável, confirmar host/porta/banco/usuário por conexão somente de leitura e guardar sua configuração em processo seguro; os testes possuem destinos fixos e algumas suítes não removem o schema/destino criado.

Suíte de integração PHP:

| Suíte | Ativação | Destino exigido pelo código | Escritas e cautelas |
|---|---|---|---|
| API PHP | `php-backend/test/run-security-integration.ps1 -ConfigPath <arquivo-local>` | `127.0.0.1:5432`, banco `agendamento_php_security_test` | Exige base vazia e configuração fora do repositório; cria schema mínimo e fixtures sintéticas, inicia dois servidores locais e limpa somente os IDs fixos. A estrutura do schema permanece; não reutilizar a base sem inspecionar seu estado. |

Os exemplos acima descrevem guardas que já existem; não configuram nem autorizam execução. A criação, preparação, execução e descarte do ambiente dependem de autorização e procedimento local aprovado. Para ativar uma suíte, definir somente a respectiva flag no ambiente efêmero do processo, nunca em arquivo versionado.

### Build do frontend

```bash
npm --workspace frontend run build
```

Para build de produção, fornecer `VITE_API_URL` HTTPS ao processo de build por mecanismo apropriado, ou `/api` quando frontend e API forem publicados juntos na mesma origem. Não inventar domínio e não usar URL de produção para validar somente a compilação.

### Verificação manual no navegador

Não há script de navegador/E2E configurado nos manifests. Quando autorizada, a checagem manual local deve cobrir: página comercial e planos; `/login` e login válido/inválido; seleção pós-autenticação quando houver e-mail/senha duplicados em clínicas; `/platform-admin` com conta global provisionada em ambiente isolado; rejeição de conta/token clínico no painel global; rotas por perfil clínico; booking público com clínica sintética; busca/filtros; responsividade; temas claro/escuro; falhas de API e logout. Registrar ambiente, passos, resultado e evidência sem capturar segredos ou dados pessoais. Não marcar esses cenários como aprovados sem executá-los.

Os comandos deste capítulo são procedimentos, não evidência de execução. Registre os resultados por release no pipeline ou sistema operacional aprovado; não interprete testes unitários como validação de integração PostgreSQL ou de hospedagem. Consulte o `OPERATIONS-RUNBOOK.md` antes de qualquer operação de banco ou administração global.

## Endpoints principais

### Autenticação

- `POST /api/auth/login`
- `POST /api/auth/login/select-clinic`
- `GET /api/auth/me`

O login recebe somente `email` e `password`; a clínica é obtida da associação do usuário no banco, nunca de um identificador escolhido no pedido inicial. Como `users` garante unicidade de e-mail apenas dentro de cada clínica, o mesmo e-mail pode existir em clínicas diferentes. Se a mesma senha validar mais de uma dessas contas, o login retorna opções de clínicas e um token de seleção assinado, de audiência distinta e válido por cinco minutos. `POST /api/auth/login/select-clinic` só aceita uma clínica contida nesse token e então emite o JWT normal da sessão. Senha inválida, conta inativa ou seleção não autorizada não revela a existência de uma conta.

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
- `GET /api/schedules/professionals/:professionalId/availability?date=YYYY-MM-DD&serviceId=<uuid>` — quando informado, calcula a disponibilidade com a duração cadastrada para o serviço associado ao profissional.
- `POST /api/schedules/professionals/:professionalId`
- `POST /api/schedules/professionals/:professionalId/blocks`

### Serviços

- `GET /api/services` — lista serviços visíveis na clínica e os profissionais associados.
- `GET /api/services/:id`
- `POST /api/services` — cria serviço e pode associar profissionais ativos da clínica.
- `PUT /api/services/:id` — atualiza dados e/ou associações profissionais.
- `PATCH /api/services/:id/status` — ativa ou desativa sem apagar o histórico.

### Agendamentos

- `GET /api/appointments`
- `GET /api/appointments/:id`
- `POST /api/appointments`
- `PATCH /api/appointments/:id` — atualiza somente `notes` (admin/recepção)
- `PATCH /api/appointments/:id/status`
- `PATCH /api/appointments/:id/cancel`
- `PATCH /api/appointments/:id/reschedule`

Novos agendamentos exigem `serviceId`; preço e duração são obtidos do cadastro do serviço, não de valores enviados pelo cliente. Nome, preço e duração são gravados como snapshots no agendamento e continuam sendo exibidos mesmo que o cadastro do serviço seja editado ou desativado. Serviços inativos não podem ser usados para novos agendamentos; um agendamento histórico que já os referencia pode ser reagendado mantendo seu serviço e snapshots originais, desde que o profissional escolhido ofereça esse serviço. Agendamentos preexistentes permanecem sem serviço e com snapshots nulos; o reagendamento não atribui serviço retroativamente.

### Agendamento público

O administrador configura um identificador público único em **Configurações**; a página usa `/booking/<identificador>`. A API pública está separada das rotas administrativas em `/api/public/clinics/:clinicSlug`, lista somente serviços ativos e profissionais ativos associados, e deriva preço e duração no backend. A criação revalida disponibilidade, timezone, bloqueios, conflito e associação profissional-serviço; a confirmação usa os snapshots gravados. Uma chave de idempotência é limitada à clínica e persistida no agendamento. Se um telefone ou e-mail já estiver cadastrado naquela clínica, o fluxo público não vincula o agendamento ao paciente existente sem verificação de posse; a solicitação é recusada para evitar associação indevida ou duplicação automática. A página não expõe IDs de agendamentos nem oferece cancelamento público.

A Migration 007 precisa ser aplicada antes que a configuração do identificador e a idempotência funcionem no PostgreSQL. A proteção definitiva contra agendamentos sobrepostos também depende da Migration 003 em bancos existentes; nenhuma dessas migrations foi executada por esta implementação. Rate limiting público é em memória por processo e deve ser complementado por proteção distribuída antes de escalar para múltiplas instâncias.

### Regras atuais da agenda

- O schema aceita `scheduled`, `confirmed`, `completed`, `cancelled`, `no_show` e `rescheduled`. Somente `cancelled` e `rescheduled` deixam de ocupar o horário. As transições permitidas são `scheduled → confirmed|cancelled` e `confirmed → completed|cancelled|no_show`; `completed`, `cancelled` e `no_show` são finais. Reagendar preserva o registro original como `rescheduled` e cria um novo registro ligado a ele. Em bancos existentes, a alteração da constraint e o vínculo histórico dependem da migration `016_appointment_state_machine.sql`, ainda não executada.
- Intervalos são semiabertos (`[início, fim)`), portanto horários consecutivos que apenas se tocam não conflitam.
- `break_duration_minutes` é armazenado como inteiro não negativo. Atualmente o backend soma esse valor à duração para avançar entre inícios de slots, mas o schema e a documentação anterior não definem formalmente se ele representa uma pausa obrigatória entre consultas. Confirmar a regra de negócio antes de alterá-la.
- Horários de expediente e bloqueios são interpretados no fuso IANA da clínica, configurado em `clinic_configurations.timezone` (padrão `UTC`). Agendamentos continuam armazenados como instantes absolutos em `TIMESTAMPTZ`; a interface os exibe no fuso da clínica, independentemente do fuso do navegador. Horários locais inexistentes ou ambíguos durante transições de horário de verão não são oferecidos nem aceitos.
- REGRA DE NEGÓCIO PENDENTE — agendamentos retroativos. Não há decisão documentada sobre permitir ou bloquear horários no passado.

### Pagamentos

- `GET /api/payments`
- `POST /api/payments`

### Auditoria

- `GET /api/audit`

## Observação

Essa é uma base sólida para o sistema e segue o roteiro proposto, porém ainda precisa de refinamentos e validações no ambiente real para alcançar a produção completa.
