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
- `frontend/` — site público, reserva online e painel administrativo
- `database/` — schema SQL
- `docker-compose.yml` — banco PostgreSQL local
- `.gitignore` — arquivos sensíveis

## Área pública e acesso

O frontend oferece a área pública em `/`, com seções acessíveis em `/recursos`, `/planos`, `/sobre` e `/contato`. `/login` abre a autenticação existente; `/booking/<identificador>` mantém a reserva pública da clínica. O painel autenticado continua no mesmo frontend.

O cadastro autônomo de clínicas ainda não existe. Novas contas de usuário são criadas por um administrador autenticado da clínica; portanto, a área pública direciona o acesso ao login e não simula cadastro. Os cards de planos apresentam a proposta comercial Essencial e Profissional. Eles não iniciam contratação: a página mantém o acesso pelo login existente, sem checkout ou cobrança. O tema compartilhado entre as áreas pública e autenticada é salvo no navegador.

Os arquivos `frontend/public/robots.txt` e `frontend/public/llms.txt` descrevem a área pública sem definir um domínio. O `sitemap.xml` deve ser configurado quando houver um domínio canônico aprovado.

## Como executar

### 1) Instalar dependências

```bash
npm ci
```

O comando usa o `package-lock.json` da raiz para instalar os dois workspaces.

### 2) Configuração local segura

O backend exige `NODE_ENV` explícito e `JWT_SECRET` com pelo menos 32 bytes. No modo `development`, os parâmetros de banco têm defaults de desenvolvimento; prefira, ainda assim, definir explicitamente as variáveis `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` e `CORS_ORIGIN` para o PostgreSQL local escolhido. Não copie configurações de produção.

O backend carrega `dotenv.config()` a partir do diretório de trabalho. Antes de iniciar a aplicação ou executar scripts que importem a configuração, confirme que o diretório de trabalho contém somente a configuração local esperada. Para operações administrativas, prefira diretório controlado sem `.env` e injeção efêmera pelo mecanismo seguro aprovado. Nunca coloque valores secretos em comandos, argumentos, logs ou no frontend.

Em produção, o runtime exige configuração explícita de banco e origem CORS HTTPS; DB TLS também é obrigatório. Builds de produção do frontend exigem `VITE_API_URL` HTTPS. Os nomes de variáveis são descritos em `backend/src/config/runtimeConfig.js`; seus valores dependem do ambiente e não devem ser documentados aqui.

### 3) Subir o banco PostgreSQL

Se o Docker estiver disponível no ambiente local:

```bash
npm run db:up
```

Este comando inicia o serviço `postgres` definido no `docker-compose.yml`, cujo volume é persistente. Usar somente para o PostgreSQL local de desenvolvimento após conferir o serviço e o destino. Não é um banco de integração descartável, e não deve ser confundido com o container/banco isolado documentado no `OPERATIONS-RUNBOOK.md`.

### 4) Executar o backend

Em uma instalação nova, use `database/schema.sql`, que inclui o fuso da clínica, o catálogo de serviços e a estrutura de assinaturas, inclusive as tabelas administrativas globais. **Não aplique a migration 010 sobre esse schema.** Em bancos existentes, aplique somente migrations ainda pendentes, respeitando a ordem exigida pelo estado do banco: a migration `001_add_users_token_version.sql` prepara o controle de sessão, `005_add_clinic_timezone.sql` adiciona `clinic_configurations.timezone` com padrão `UTC`, `006_add_services.sql` cria serviços e snapshots opcionais, `007_public_booking.sql` adiciona identificadores públicos e chaves de idempotência, `008_clinic_subscriptions.sql` cria a estrutura interna de assinaturas, `009_commercial_plan_tiers.sql` amplia a constraint de planos sem modificar registros existentes e `010_platform_admin_accounts.sql` adiciona contas e auditoria separadas para a administração global. Não aplique uma migration se seus objetos já existirem; revise o estado do banco e a migration antes de executá-la. Migrations não são executadas automaticamente pela aplicação. Consulte `OPERATIONS-RUNBOOK.md` para revisão, confirmação do destino, registro e plano de recuperação da migration 010.

### Assinaturas SaaS (preparação, sem cobrança)

`GET /api/subscriptions/current` retorna a assinatura mais recente da clínica autenticada apenas para usuários administradores; se ainda não houver registro, retorna `data: null`. O endpoint não aceita `clinic_id` como fonte de autoridade. A tabela `subscriptions` não é preenchida automaticamente, e não existem endpoints públicos para criar, alterar ou cancelar assinaturas. Provisionamento e transições permanecem restritos aos serviços internos; não há gateway ou cobrança.

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

Para provisionar uma conta, o operador autorizado deve confirmar que as tabelas administrativas existem no banco correto (criadas pelo schema completo em instalação nova ou pela migration 010 em banco existente), injetar `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME`, `PLATFORM_ADMIN_PASSWORD` e `PLATFORM_ADMIN_PROVISIONING_CONFIRM=CREATE_PLATFORM_ADMIN` somente no ambiente do processo a partir de um mecanismo seguro e executar `node backend/src/scripts/provision-platform-admin.js` uma vez. Use senha forte e única, não a grave em `.env`, no frontend, em documentação ou no histórico do shell; remova imediatamente os valores temporários. O script não contém credenciais padrão e não atualiza contas existentes. O runbook descreve o cuidado adicional com o `dotenv` e o diretório de trabalho.

Novas senhas definidas no cadastro clínico, no seed de desenvolvimento/teste e no provisionamento administrativo devem conter pelo menos 12 pontos de código Unicode e no máximo 72 bytes em UTF-8, limite efetivo do bcrypt. O login continua aceitando senhas legadas de até 1024 caracteres; não há redefinição forçada nem alteração de sessões existentes. Contas antigas criadas com senhas acima do limite de bytes ainda podem depender do comportamento histórico de truncamento do bcrypt e devem ser migradas por um fluxo de redefinição autorizado, caso exista.

O token clínico permanece em `localStorage`, o que mantém a sessão após recarregar a página, mas deixa o token acessível a JavaScript executado na origem em caso de XSS. Alternativas a avaliar separadamente são mantê-lo apenas em memória (reduz persistência, mas exige nova autenticação após recarga) ou migrar para cookie `HttpOnly`/`Secure`/`SameSite` com validação CSRF e ajustes coordenados no backend, CORS e todos os fluxos clínicos/admin. Nenhuma dessas mudanças de arquitetura foi feita nesta etapa; os testes atuais não comprovam comportamento em navegador real nem a segurança da hospedagem.

MRR estimado considera apenas assinaturas `active` com período vigente: mensal = preço mensal do catálogo; trimestral = total trimestral / 3; anual = total anual / 12, com arredondamento por assinatura para centavos. ARR estimado = MRR × 12. São estimativas de catálogo e não receita recebida. O schema atual não possui status `pending` nem pagamentos associados a assinaturas/gateway. A tabela `payments` registra pagamentos de agendamentos das clínicas; portanto, ela não é usada como receita SaaS. Cobranças e pagamentos de assinatura são mostrados como indisponíveis, sem criar registros fictícios.

```bash
npm run dev:backend
```

### 5) Executar o frontend

```bash
npm run dev:frontend
```

### 6) Popular dados iniciais

O seed só pode ser executado em `development` ou `test` e exige `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` fornecidos pelo ambiente. A senha precisa atender à política descrita acima. Não reutilize credenciais de exemplo.

```bash
node backend/src/scripts/seed.js
```

O seed escreve no banco configurado e exige credenciais sintéticas fornecidas ao processo; execute somente em `development` ou `test` e após confirmar o destino.

### TLS do PostgreSQL

Em desenvolvimento e testes, `DB_SSL=false` permite conectar ao PostgreSQL local sem TLS. Em produção, configure `DB_SSL=true`; o backend recusa iniciar sem TLS e sempre valida o certificado do servidor. Se o provedor exigir uma CA própria, forneça o caminho do bundle por `DB_SSL_CA_PATH`, sem incluir o certificado no repositório.

Builds de produção do frontend exigem `VITE_API_URL` configurada no ambiente de build com uma URL HTTPS da API. O backend exige `CORS_ORIGIN` configurada como origem HTTPS explícita em produção.

`GET /api/health` e `GET /api/health/live` são verificações de liveness do processo e não verificam o banco. `GET /api/health/ready` verifica a dependência do banco e retorna `503` quando ela está indisponível; a validação real em ambiente autorizado permanece pendente. Consulte [OPERATIONS-RUNBOOK.md](./OPERATIONS-RUNBOOK.md) para pendências de backup/DR, proxy, rate limiting e observabilidade.

## Fluxo de teste local

O script `backend/src/scripts/test-flow.js` só pode ser executado em `development` ou `test`, exige `TEST_CLINIC_ID`, `TEST_EMAIL` e `TEST_PASSWORD`, e aceita somente uma API HTTP em loopback. Não configure endpoint ou credenciais de produção para esse script.

## Verificações e testes

O backend não define um script `test`; o frontend oferece `npm --workspace frontend test`. Os testes automatizados usam o runner nativo do Node. Execute os comandos a partir da raiz do projeto:

### Verificações estáticas

```bash
npm --workspace backend run check
```

O script executa `node --check` somente em `backend/src/server.js`, `src/app.js`, `src/config/env.js` e `src/db/index.js`; não é type-check abrangente nem substitui testes.

### Testes unitários e de rotas sem banco de integração

```bash
node --test backend/test/*.test.js
node --test frontend/test/*.test.js
```

Os testes do frontend podem ser executados com `npm --workspace frontend test`; usam o runner nativo `node:test`, renderer de componentes e respostas HTTP sintéticas, sem rede nem banco. A navegação com `BrowserRouter` é exercitada contra uma implementação sintética da History API, inclusive eventos de voltar/avançar; isso cobre a integração do roteador com esse contrato, mas não substitui testes em navegadores reais. Os testes com `MemoryRouter` verificam somente navegação em memória. Nenhum deles valida hospedagem/reescrita de rotas, comportamento visual responsivo ou diferenças específicas de navegador, nem substitui testes de autorização do backend. O conjunto backend inclui testes unitários, de serviço, rota, autorização e validação; os arquivos de integração têm guardas opt-in e são ignorados quando a variável correspondente não está habilitada. Omitir a saída dos testes de integração não comprova integração com PostgreSQL.

### Testes de integração PostgreSQL — somente instância descartável

Os testes de integração criam e/ou alteram tabelas e dados. Nunca os apontar para o banco de desenvolvimento persistente, compartilhado ou de produção. Antes de habilitá-los, criar/identificar uma instância isolada e descartável, confirmar host/porta/banco/usuário por conexão somente de leitura e guardar sua configuração em processo seguro; os testes possuem destinos fixos e algumas suítes não removem o schema/destino criado.

Guardas encontrados nos testes:

| Suíte | Ativação | Destino exigido pelo código | Escritas e cautelas |
|---|---|---|---|
| Autenticação | `RUN_AUTH_DATABASE_INTEGRATION=1` | `127.0.0.1:55439`, banco `auth_login_test`, usuário `postgres` | Exige schema público vazio, aplica `database/schema.sql`, cria fixtures sintéticas e remove as linhas de clínica/usuário ao final. O schema permanece; não é repetível no mesmo banco já inicializado. |
| Painel global | `RUN_PLATFORM_ADMIN_DATABASE_INTEGRATION=1` | `127.0.0.1:55440`, banco `platform_admin_test`, usuário `postgres` | Cria tabelas/schema e dados sintéticos. Também cria `platform_admin_migration_test` através de uma conexão como `postgres`; não há descarte automático garantido dos bancos ou fixtures. Usar cluster novo, exclusivo e descartável. |
| Assinaturas e limites | `RUN_SUBSCRIPTION_DB_INTEGRATION=1` | `127.0.0.1:55432`, banco `agendamento_test`, usuário `agendamento_test`, senha fornecida ao processo | Executa fixtures e operações reais no banco; a suíte documenta limpeza/restauração de contagens. Ainda assim, usar somente uma instância isolada descartável e confirmar identidade antes de habilitar. A mesma flag ativa os dois arquivos de integração de assinaturas/limites. |

O teste administrativo global usa o usuário `postgres` esperado pelo próprio teste e precisa de privilégios de criação de banco. Não conceder esses privilégios ao usuário runtime da aplicação. Os exemplos acima descrevem guardas que já existem; não configuram nem autorizam execução. A criação, preparação, execução e descarte do ambiente dependem de autorização e procedimento local aprovado. Para ativar uma suíte, definir somente a respectiva flag no ambiente efêmero do processo, nunca em arquivo versionado.

### Build do frontend

```bash
npm --workspace frontend run build
```

Para build de produção, fornecer `VITE_API_URL` HTTPS ao processo de build por mecanismo apropriado. Não inventar domínio e não usar URL de produção para validar somente a compilação.

### Verificação manual no navegador

Não há script de navegador/E2E configurado nos manifests. Quando autorizada, a checagem manual local deve cobrir: página comercial e planos; `/login` e login válido/inválido; seleção pós-autenticação quando houver e-mail/senha duplicados em clínicas; `/platform-admin` com conta global provisionada em ambiente isolado; rejeição de conta/token clínico no painel global; rotas por perfil clínico; booking público com clínica sintética; busca/filtros; responsividade; temas claro/escuro; falhas de API e logout. Registrar ambiente, passos, resultado e evidência sem capturar segredos ou dados pessoais. Não marcar esses cenários como aprovados sem executá-los.

Os comandos deste capítulo documentam procedimentos; **nenhum teste, build, migration ou comando de provisionamento foi executado nesta etapa documental**. Consulte o `OPERATIONS-RUNBOOK.md` antes de qualquer operação de banco ou administração global.

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

- O schema aceita `scheduled`, `confirmed`, `completed`, `cancelled`, `no_show` e `rescheduled`. Somente `cancelled` deixa de ocupar o horário; os demais status são tratados como ocupantes pelo backend e pela constraint de exclusão. Em bancos existentes, a constraint só é aplicada após a migration `003_prevent_overlapping_appointments.sql`.
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
