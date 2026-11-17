# Runbook operacional: backup, recuperação e disponibilidade

Este documento registra as decisões e procedimentos que a equipe responsável deve completar antes da operação de produção. Não configura infraestrutura, não executa backups e não define metas operacionais em nome do negócio.

## Preparação e validação local

Os comandos disponíveis e os limites dos testes estão catalogados no `README.md`, na seção **Verificações e testes**. A API PHP tem smoke test, bateria P0 e testes de integração próprios. Nenhuma verificação sem banco substitui a integração PostgreSQL.

Antes de iniciar localmente:

1. Instalar dependências com `npm ci` na raiz, usando o `package-lock.json` versionado. Não é necessário repetir instalações separadas por workspace.
2. Confirmar que o PostgreSQL local é uma instância de desenvolvimento descartável, e revisar `docker-compose.yml` antes de usar `npm run db:up`. Esse comando inicia o serviço `postgres` do Compose padrão; o volume `pgdata` é persistente. Não o confundir com um banco de integração dedicado.
3. Fornecer configuração por variáveis do processo ou mecanismo seguro aprovado. `php-backend/src/bootstrap.php` carrega `backend/.env` por padrão; `NOA_ENV_FILE=php://memory` impede essa leitura. Para evitar configuração acidental, usar a opção de memória e injetar apenas as variáveis necessárias. Nunca imprimir o ambiente nem incluir credenciais nos argumentos/comandos.
4. Iniciar backend e frontend com os comandos listados no README. Para acesso local, verificar separadamente `VITE_API_URL` e `CORS_ORIGIN`; não usar endereço de produção para validações locais.
5. Para testes unitários, usar somente os comandos de runner documentados no README. Os testes de integração devem permanecer desativados até que host, porta, nome do banco e usuário sejam conferidos contra a instância isolada dedicada.

Nenhum destes procedimentos foi executado nesta etapa.

## Preparação para a primeira hospedagem

Esta seção registra a configuração encontrada no repositório e os passos que ainda dependem de decisões de infraestrutura. Ela não configura infraestrutura nem autoriza publicação. A aplicação **não está certificada como pronta para produção**.

### Arquitetura e inventário atual

- Frontend React/Vite e API PHP são componentes separados no código; `npm --workspace frontend run build` gera os arquivos estáticos em `frontend/dist`. Para o staging gratuito aprovado, o plano é empacotar ambos em um serviço web Render e servi-los na mesma origem, evitando dependência de cookies cross-site. O container usa fallback de SPA para `index.html` em rotas como `/login` e `/booking/:slug`.
- `php-backend/public/index.php` é o front controller PHP e `/api/health/live` é liveness; `/api/health/ready` verifica PostgreSQL. O servidor PHP embutido em `php -S` é somente local/teste; produção exige PHP-FPM ou runtime equivalente configurado pela plataforma. O backend Node foi removido após validação integrada da API PHP.
- PostgreSQL é dependência externa da aplicação. O único `docker-compose.yml` existente é para desenvolvimento local: credenciais de demonstração, volume persistente e bind de PostgreSQL limitado a `127.0.0.1:5432`. **Não o use como Compose de produção nem exponha essa porta publicamente.**
- A topologia de staging escolhida, ainda não provisionada, é um serviço Docker no Render Free para frontend + API na mesma origem, Neon Free para PostgreSQL e Resend Free para SMTP. Cloudflare Pages fica fora desta topologia inicial para evitar separar a sessão clínica em uma origem diferente. Os limites de gratuidade incluem suspensão após inatividade e não são adequados para produção com dados reais.
- O `Dockerfile` e a configuração Apache deste repositório preparam o serviço único para Render; eles não criam nem publicam recursos. O build define `VITE_API_URL=/api`; `CORS_ORIGIN`, banco, SMTP e segredos ainda precisam ser fornecidos no ambiente do serviço após uma implantação explicitamente autorizada. O build da imagem ainda não foi validado: Docker Desktop não iniciou neste ambiente. Nenhum domínio próprio, região ou política de disponibilidade foi definido.
- Não há versão/runtime PHP de produção fixado nem imagem de aplicação. Definir e validar a versão e configuração PHP-FPM compatíveis com o código no pipeline/ambiente escolhido antes de publicar. Node.js é necessário apenas para as ferramentas e os testes do frontend.

### Preparação do ambiente e publicação

1. A topologia de staging gratuito foi escolhida: serviço único Docker no Render, Neon PostgreSQL e Resend SMTP, sem Cloudflare Pages separado. Antes de provisionar, ainda definir região, nome/URL, responsável, rede, disponibilidade e plano de rollback. Para produção, selecionar e aprovar uma topologia separada; não assumir que os limites gratuitos são aceitáveis.
2. Instalar dependências de forma reproduzível com `npm ci` a partir da raiz e do `package-lock.json`. Executar os testes antes de publicar e guardar o artefato de build aprovado.
3. Para builds separados, fornecer `VITE_API_URL` como URL HTTPS canônica da API, terminando em `/api`. No container unificado de staging, `/api` aponta para a mesma origem e evita cookies cross-site. A variável é incorporada ao artefato; ela não é segredo. Não gravar tokens, senhas ou credenciais em variáveis `VITE_*`.
4. Publicar o conteúdo de `frontend/dist` em host estático com fallback de rotas para `index.html`, HTTPS, certificados renovados automaticamente e cabeçalhos de segurança/CSP compatíveis com o frontend. A CSP das respostas da API PHP **não** protege o HTML servido pelo host estático. Validar os cabeçalhos e a navegação por URL direta no domínio final.
5. Executar a API PHP em PHP-FPM ou runtime equivalente; o servidor embutido `php -S` é somente local/teste. Configurar `NODE_ENV=production`, `JWT_SECRET`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL=true` e `CORS_ORIGIN` no ambiente do processo. `SESSION_COOKIE_SAME_SITE` aceita `lax`, `strict` ou `none` e usa `lax` por padrão; cookies de sessão são `Secure` em produção. Usar `none` somente quando frontend e API realmente precisarem de contexto cross-site e ambos estiverem em HTTPS; preferir hospedagem same-site, pois navegadores podem bloquear cookies de terceiros. `DB_SSL_CA_PATH` é opcional e somente necessário quando o provedor exigir CA própria; `JWT_EXPIRES_IN` é opcional e tem padrão de 8 horas. Configurar a porta e o encaminhamento HTTP no servidor web/plataforma. O runtime recusa segredo JWT ausente/menor que 32 bytes, variáveis obrigatórias ausentes, banco em loopback, credenciais padrão locais, CORS sem uma única origem HTTPS e TLS PostgreSQL desativado.
6. Configurar `CORS_ORIGIN` como a origem HTTPS exata do frontend, sem caminho. Configurar DNS e HTTPS para frontend e API; manter comunicação API–PostgreSQL em rede privada sempre que suportado. A API não termina HTTPS por si só neste repositório; confirmar que o proxy/load balancer protege a conexão externa e encaminha corretamente para o processo.
7. Injetar segredos a partir de um gestor aprovado, com acesso mínimo, rotação e auditoria. Não versionar `.env`; `.gitignore` ignora `.env` e `.env.*` e permite somente `.env.example`. A revisão local encontrou apenas arquivos `.env.example` versionados, sem arquivos `.env` rastreados. Se um arquivo `.env` existir no ambiente local, mantê-lo fora de qualquer contexto de build/imagem; um futuro `.dockerignore` deve excluí-lo explicitamente. Não imprimir valores reais durante verificações.

### Conexões PostgreSQL, proxy e limites de escala

- Confirme o ciclo de conexão do PDO e dimensione `PHP-FPM workers × conexões concorrentes` contra o limite PostgreSQL, reservando folga para migrations, administração e monitoramento.
- `DB_SSL=true` em produção ativa validação de certificado (`rejectUnauthorized: true`). Manter verificação de hostname/cadeia TLS; não desativar validação para contornar erros. Conceder à identidade runtime apenas permissões necessárias à operação da aplicação; migrations e provisionamento devem usar identidade/credencial separada.
- A API PHP usa `REMOTE_ADDR` como IP de origem e não confia automaticamente em `X-Forwarded-For`. Após escolher a topologia, restringir acesso direto à API e configurar o proxy para transmitir a origem somente a partir de proxies controlados; testar rate limit e falsificação de cabeçalhos antes de publicar.
- Todos os limitadores usam memória por processo. Eles reiniciam com o processo e não agregam contagens entre réplicas; não escalar horizontalmente contando com limite global efetivo até definir e monitorar um store compartilhado e sua política de falha.
- O código atual não implementa retries distribuídos nem métrica de pool. Testar readiness, saturação e recuperação com os limites do PostgreSQL escolhido, sem usar banco de produção para testes de carga.

### Recuperação de senha e provisionamento de contas

- O link **Criar conta** informa que uma conta deve ser provisionada pelo administrador da clínica; cadastro público de usuário/clínica não está habilitado. Não transforme a rota autenticada `POST /api/auth/register` em rota pública nem aceite `clinic_id` ou papel fornecidos pelo cliente.
- A recuperação usa `POST /api/auth/password-reset/request` e `POST /api/auth/password-reset/confirm`. Antes de habilitá-la em qualquer ambiente, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` e `PUBLIC_APP_URL` no gestor de segredos/runtime do backend. `PUBLIC_APP_URL` deve ser a origem do frontend, sem caminho, e HTTPS em produção. O `.env.example` só documenta nomes vazios; não copie senhas reais para o repositório.
- A migration revisável `database/migrations/011_password_reset_tokens.sql` cria armazenamento por conta clínica de hashes de tokens. Ela não foi aplicada. Para bancos existentes, confirme o banco de destino, o estado dos objetos e as permissões, revise a migration, aprove-a pelo processo de change management e planeje backup/rollback antes de executá-la. O `database/schema.sql` atualizado atende instalações novas; não execute nenhum dos dois sem aprovação.
- Tokens expirando em 30 minutos são de uso único, vinculados ao usuário e à clínica, e só aparecem no conteúdo do e-mail. Uma redefinição aumenta `users.token_version`, invalidando JWTs existentes. Para endereços associados a mais de uma conta, o e-mail contém links separados; a resposta HTTP continua genérica para não enumerar contas.
- Os limitadores específicos de solicitação/redefinição e o limitador geral de autenticação são em memória. Em múltiplas réplicas a contagem não é global. Não alegar proteção distribuída até configurar um store compartilhado e testar sua disponibilidade e política de falha.
- Os limites atuais são 5 tentativas por IP a cada 15 minutos para solicitação/confirmação, 3 solicitações por endereço (chave armazenada como hash) por hora, além do limite geral de autenticação já existente. Tokens consumidos/expirados não são apagados automaticamente; definir retenção e uma rotina de limpeza aprovada antes de manter o recurso por longo prazo.
- Os testes de unidade usam destinatários e SMTP sintéticos/simulados; eles não validam entrega real. Antes de liberar o serviço, validar entrega e expiração em staging com uma caixa controlada, sem registrar links/tokens, e revisar SPF/DKIM/DMARC, reputação, monitoramento e tratamento de bounce com o provedor escolhido.

### Logs, health checks e encerramento

- Logs são enviados por `console` para stdout/stderr, apropriados para captura pela plataforma, mas o repositório não define formato estruturado, retenção, APM, métricas nem alertas. Configurar retenção, controle de acesso e alertas de falhas/latência/uso conforme a plataforma, evitando corpos de requisição, tokens, senhas e dados pessoais.
- Em produção, o middleware de erro retorna mensagem genérica e `requestId`; o log de erro registra somente categoria, request ID e status. A checagem de readiness responde apenas `ready`/`not_ready` e não serializa erro de banco. Liveness/readiness não divulgam configuração nem credenciais.
- `SIGTERM`/`SIGINT` iniciam encerramento HTTP e fechamento do pool; validar no runtime escolhido que o período de grace do orquestrador comporta requisições em andamento e fechamento do pool. O processo usa os sinais para shutdown controlado.
- Verificar liveness e readiness no ambiente de staging com a política de probes do runtime. Não expor endpoints administrativos ou adicionar informação de banco às respostas de health.

### Schema, migrations e administrador inicial

- Não foi executada migration nesta preparação. Para banco novo, o README identifica `database/schema.sql` como snapshot atual; ele não é seguro para reexecução. Para banco existente, obter inventário somente leitura e confirmar cada migration pendente em ordem, com backup aprovado, change review, janela, plano de recuperação e operador autorizado. O projeto não possui migration runner nem ledger, e a migration 010 não deve ser reaplicada sobre o snapshot atual que já cria suas tabelas.
- Não dar privilégios DDL à identidade runtime da API. Aplicar mudanças pelo cliente/processo aprovado da equipe de banco, após verificar destino, estado anterior e checksum/SQL revisado. Registrar evidência externa; nunca improvisar `IF NOT EXISTS`, baseline ou rollback em produção.
- Para provisionar a conta global inicial, o script PHP é `php-backend/bin/provision-platform-admin.php`; exige `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME`, `PLATFORM_ADMIN_PASSWORD` e `PLATFORM_ADMIN_PROVISIONING_CONFIRM=CREATE_PLATFORM_ADMIN`. O operador deve confirmar que o schema/tabelas existem e que o destino é o correto, fornecer os valores por mecanismo efêmero seguro e executar o script uma única vez com identidade restrita. O script cria a conta e a auditoria; não atualiza conta existente. Definir `NOA_ENV_FILE=php://memory` para evitar carregar configuração local acidental.

### Backup, rollback e verificações pós-publicação

- Backup/PITR, retenção, cópias independentes, alertas e periodicidade de restauração continuam dependentes do banco/provedor e da política ainda não definida. Definir RPO/RTO, responsáveis e acesso antes de armazenar dados reais. Testar restauração em destino isolado autorizado, validar integridade, duração e procedimento de redirecionamento; não restaurar sobre o primário em um exercício.
- Rollback de aplicação deve apontar a artefato/configuração previamente aprovada. Não reverter schema automaticamente: não há down migrations aprovadas e alterações podem ser incompatíveis ou conter dados/auditoria. Para falha de migration, parar, preservar evidência sem segredos, obter avaliação do DBA e seguir change process; não apagar objetos/dados para “voltar”.
- Após publicação em staging, verificar DNS/certificado HTTPS, redirecionamento HTTP→HTTPS, CSP/cabeçalhos do host estático, rotas diretas e refresh SPA, CORS para origem aprovada e rejeição de origem não autorizada, API liveness/readiness, conectividade PostgreSQL TLS, login/fluxos autorizados, logs sem dados sensíveis, limites de conexão e shutdown por `SIGTERM`. Registrar versão do artefato, configuração (sem valores secretos), resultado e responsável. Só promover depois de revisão e aprovação do ambiente.
- Permanecem pendentes: provisionamento e validação do staging, domínio/região, confirmação de proxy e headers no runtime, política de escala e store compartilhado de rate limit, gestão de segredos, permissões efetivas do banco, processo CI/CD/rollback, backup/PITR e RPO/RTO, monitoramento/alertas/responsáveis e validação em staging. A configuração CSP/headers do container precisa ser verificada após o build e deploy.

### SEO e metadados públicos

`frontend/public/robots.txt` e `frontend/public/llms.txt` existem e são copiados para o build. O `robots.txt` permite a área pública e exclui login e `/booking/`; o `llms.txt` descreve o produto sem domínios. Não existe `sitemap.xml`. Ele só deve ser criado quando a equipe aprovar um domínio canônico e revisar quais páginas públicas existentes devem ser indexadas; não incluir rotas privadas, administrativas, dados de clínicas ou endpoints da API. Não inventar páginas para completar sitemap.

## Migration 010 — revisão, aplicação e recuperação

`database/migrations/010_platform_admin_accounts.sql` cria `platform_admin_accounts` e `platform_audit_logs`, seus índices e constraints, dentro de uma transação. A segunda tabela conserva eventos de auditoria e referencia a conta com `ON DELETE SET NULL`. A migration não contém proteção de reexecução (`IF NOT EXISTS`) e não há migration runner, ledger ou script de aplicação identificado no projeto. **Não reaplicar em um banco onde os objetos já existam.**

O snapshot atual `database/schema.sql` já cria essas tabelas. Em instalação nova que use esse snapshot, **não aplicar a migration 010 em seguida**. A migration é somente para um banco existente cujo estado anterior, ausência dos objetos e sequência de mudanças tenham sido confirmados.

### Pré-requisitos e aprovação

- Aprovação de mudança de banco e janela de execução por responsáveis designados; esses responsáveis e o processo de aprovação ainda precisam ser definidos.
- Backup recente e recuperável, com teste de restauração para destino isolado conforme a política aprovada. Backup, retenção, RPO/RTO e procedimento de recuperação continuam pendentes de decisão operacional.
- Identidade de migration separada da identidade runtime da API, com privilégios DDL estritamente necessários e acesso limitado ao destino aprovado. A aplicação runtime não deve receber credenciais de migration.
- Compatibilidade PostgreSQL confirmada pelo responsável do banco e disponibilidade da função `gen_random_uuid()`.
- Revisão do arquivo SQL exato, das constraints, do escopo de grants e do plano de recuperação. Não editar nem consolidar migrations históricas como parte desta operação.
- Dependências da aplicação preparadas para lidar com as tabelas após a mudança. A aplicação não executa migrations automaticamente.

### Conferência do destino e do estado antes da execução

Usar uma sessão **somente de leitura**, conectada pelo mecanismo aprovado, antes de qualquer DDL. Conferir e registrar no pedido de mudança, sem credenciais:

```sql
SELECT current_database() AS database_name,
       current_user AS database_role,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port;

SELECT to_regclass('public.platform_admin_accounts') AS platform_admin_accounts,
       to_regclass('public.platform_audit_logs') AS platform_audit_logs,
       to_regprocedure('gen_random_uuid()') AS gen_random_uuid;
```

Confirmar a identidade do servidor, banco, role, ambiente e endpoint com uma fonte independente aprovada; não confiar somente no nome do banco. Comparar o estado com o baseline aprovado:

- Se ambas as tabelas não existirem, continuar a revisão do schema e dos pré-requisitos.
- Se uma ou ambas existirem, parar. Não executar novamente nem tentar completar objetos manualmente; comparar colunas, constraints e índices com a migration e investigar o histórico.
- Conferir também a ausência/conformidade dos índices `uq_platform_admin_accounts_email`, `idx_platform_audit_logs_created_at` e `idx_platform_audit_logs_admin_created_at`; confirmar que o schema não contém objetos conflitantes com esses nomes.

**Barreiras contra execução acidental em produção:** não usar conexão, credencial ou perfil de produção para ensaio; preferir uma instância não produtiva isolada e identificável; exigir conferência por segunda pessoa do ambiente/servidor/banco/role; usar credencial DDL temporária limitada ao destino aprovado; não executar a partir de configuração implícita carregada de `.env`; abortar se qualquer identidade divergir do pedido aprovado. Produção permanece bloqueada até existir aprovação formal e plano de mudança próprio.

O repositório não fornece um comando de aplicação de migration. Depois da aprovação, usar somente o cliente/processo de mudança PostgreSQL aprovado pela organização, que deve falhar diante de erro e respeitar a transação explícita do arquivo. Registrar no sistema externo de mudanças: arquivo e checksum revisados, ambiente/identidade de destino, aprovadores, operador, horário, resultado, saída sem dados sensíveis e verificações pós-aplicação. Não registrar senha, token ou string de conexão. Como não há ledger no projeto, esse registro externo é necessário para rastreabilidade.

### Validação posterior

Em sessão somente de leitura, confirmar:

- as duas relações existem no schema `public`;
- colunas e tipos correspondem ao SQL revisado, incluindo status, `token_version`, timestamps e JSON de auditoria;
- `uq_platform_admin_accounts_email` é único e os dois índices da auditoria existem;
- a FK de `platform_audit_logs.platform_admin_id` referencia a conta global e tem a ação `ON DELETE SET NULL`;
- checks de status, e-mail, nome, versão de token e objeto JSON estão instalados;
- grants estão limitados às identidades aprovadas, sem conceder privilégios adicionais à API;
- os logs da mudança não contêm credenciais ou dados pessoais desnecessários.

Não inserir conta para “testar” a migration. A validação funcional de ponta a ponta deve usar a integração opt-in somente em cluster PostgreSQL descartável separado, conforme o README; ela cria schema e dados sintéticos e não é um teste pós-migration de produção.

### Reversão e recuperação

Não existe migration reversa aprovada. Remover as tabelas apagaria contas administrativas e/ou eventos de auditoria; por isso **não executar `DROP TABLE`, não apagar linhas e não criar down migration automaticamente**.

Se a execução falhar, interromper a implantação, preservar a saída e confirmar com o DBA o estado transacional antes de qualquer nova tentativa. Se a aplicação precisar ser revertida, manter as tabelas e dados novos, desde que isso seja compatível com a versão anterior; a tabela adicional é preferível a uma reversão destrutiva. Se o schema estiver inconsistente, restaurar o backup aprovado em destino isolado, comparar e recuperar contas e auditoria antes de decidir qualquer ação no banco alvo. Qualquer correção deve ser uma mudança aditiva revisada e aprovada. Exclusão permanente de contas/logs exigiria análise de retenção, exportação protegida, autorização explícita e procedimento separado.

## Administração global da plataforma

- A administração global usa `platform_admin_accounts`, separada de `users` e dos papéis por clínica. A audiência JWT global é diferente da audiência de sessão clínica; a API verifica assinatura, expiração, status e versão da sessão no banco em cada requisição.
- Antes de ativar `/platform-admin`, revisar e aplicar manualmente `database/migrations/010_platform_admin_accounts.sql` conforme o processo de mudança de banco aprovado. A aplicação não executa migrations automaticamente.
- Provisionar o primeiro proprietário por operador autorizado com `php-backend/bin/provision-platform-admin.php`, usando variáveis efêmeras injetadas diretamente no processo a partir de cofre aprovado. Definir `NOA_ENV_FILE=php://memory` para evitar carregar `backend/.env`. Não armazenar a senha em arquivo, no frontend ou no histórico do shell; não reutilizar contas administrativas das clínicas.
- Suspensão/revogação exige atualizar a conta por procedimento de banco autorizado e incrementar `token_version`; mudanças de status globais não são oferecidas pela interface atual.
- Para suspender uma conta, um operador autorizado deve identificar exatamente a conta, executar uma alteração transacional revisada que defina `status = 'suspended'` e incremente `token_version`, confirmar que exatamente uma linha foi afetada e verificar o estado pelo identificador da conta. A atualização de versão revoga tokens emitidos. Não há endpoint administrativo de suspensão; não alterar outras contas nem remover seus registros de auditoria.
- Consultas administrativas e eventos de autenticação são registrados em `platform_audit_logs`. Não registrar senha, JWT, e-mail digitado em falha de login ou outros segredos. Definir controle de acesso, retenção, monitoramento e revisão periódica dos logs antes de produção.
- O painel é somente leitura. Não há gateway de pagamento SaaS, status `pending` de assinatura ou pagamento associado a assinatura. MRR/ARR são estimativas baseadas no catálogo e não comprovam recebimento; os pagamentos existentes pertencem a agendamentos das clínicas.
- Não há notificações em tempo real. Os eventos são consultados sob demanda a partir dos registros de clínica e da auditoria de assinaturas.

### Provisionamento seguro da conta global

O script `php-backend/bin/provision-platform-admin.php` cria uma única conta e um evento de auditoria dentro da mesma transação. Não é um fluxo de cadastro público, não atualiza conta existente e não contém senha padrão. Exige:

- migration 010 aplicada e verificada no banco de destino;
- aprovação e autorização operacional para criar a identidade global;
- ambiente PHP configurado com `NODE_ENV`, `JWT_SECRET` e parâmetros de banco exigidos pelo `php-backend/src/bootstrap.php`;
- `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME`, `PLATFORM_ADMIN_PASSWORD` e `PLATFORM_ADMIN_PROVISIONING_CONFIRM=CREATE_PLATFORM_ADMIN` disponíveis no processo;
- privilégio INSERT somente nas tabelas administrativas necessárias, sem disponibilizar credencial DDL ou superuser à API.

O script importa `php-backend/src/bootstrap.php`, que carrega `backend/.env` por padrão. Definir `NOA_ENV_FILE=php://memory` e injetar configuração apenas pelo mecanismo seguro aprovado, para não carregar acidentalmente valores locais. Nunca fornecer senha como argumento de linha de comando, digitá-la em comando registrado, habilitar shell tracing ou despejar o ambiente em logs. Usar cofre/gerenciador aprovado com injeção efêmera no processo e política de logs que mascare valores; o método específico de injeção depende da plataforma e permanece pendente de escolha. Ao terminar, remover a injeção temporária segundo o procedimento do mecanismo utilizado.

O script retorna somente um identificador de conta no sucesso e uma mensagem genérica na falha. Registrar o identificador e o resultado no registro de mudança, sem copiar o ambiente ou credenciais. Um operador autorizado pode verificar, por consulta de leitura limitada ao ID emitido, e-mail e estado da conta; não exibir hash de senha. O script não é idempotente: e-mail já cadastrado resulta em falha e não deve ser contornado apagando a conta.

Revogação/suspensão é descrita acima: alterar o status para suspenso e incrementar `token_version` em uma única transação aprovada, verificar a única linha afetada e preservar a auditoria. Logout revoga somente a sessão do administrador autenticado; não suspende a conta. A forma de solicitar, aprovar e executar essas operações ainda depende de procedimento operacional formal.

## Checklist documental antes de produção

Todos os itens abaixo exigem evidência e aprovação apropriadas. Este checklist não configura serviços nem declara que o ambiente de produção foi preparado.

| Área | Verificação necessária | Situação |
|---|---|---|
| Ambiente/configuração | Separar desenvolvimento, teste e produção; conferir nomes de variáveis obrigatórias e origem de configuração sem registrar seus valores; confirmar processo de rotação. | PENDENTE |
| Domínio e HTTPS | O staging planeja usar a URL HTTPS gerada pelo Render, ainda não provisionada; aprovar domínio canônico para produção e testar HTTPS, cabeçalhos e CSP no runtime. | PENDENTE |
| Segredos | Selecionar cofre aprovado; limitar leitura por serviço/operador; definir rotação e revogação; impedir segredos em logs, builds, documentação e histórico. | PENDENTE |
| PostgreSQL/acesso | Selecionar provedor/região; separar credenciais runtime e migration; conceder menor privilégio; confirmar TLS, rede, monitoramento e recuperação. | PENDENTE |
| Backups/restauração | Aprovar destino independente, criptografia, frequência, retenção, alertas e responsáveis; executar restauração em destino isolado e registrar evidência. | PENDENTE |
| Migrações | Definir processo/ledger, revisão, aprovação, janela, identidade DDL separada, pré-checagem de destino, registro de versão e recuperação. Não há runner/ledger no projeto. | PENDENTE |
| Conta administrativa | Aplicar o schema/migration correto sem duplicação; aprovar proprietário; provisionar via processo seguro; testar revogação e revisão periódica de acesso. | PENDENTE |
| Autenticação/autorização | Validar tokens e audiências distintas, expiração/revogação, rate limiting e permissões do backend; testar acesso negativo entre contas globais e clínicas. | PENDENTE |
| Isolamento entre clínicas | Testar IDs manipulados para cada recurso e papel, com fixtures sintéticas em ambiente isolado; revisar consultas que usam `clinic_id`. | PENDENTE |
| Limites de requisição | Confirmar topologia de instâncias e política de proxy; decidir armazenamento compartilhado para rate limiting se houver múltiplas instâncias; validar comportamento de falha. | PENDENTE |
| Monitoramento/logs | Definir métricas, alertas, retenção, revisão de `platform_audit_logs`, acesso, correlação por request ID e resposta a alertas sem dados pessoais/segredos. | PENDENTE |
| Incidentes | Nomear responsáveis, canal de escalonamento, classificação, comunicação, preservação de evidências e exercício de resposta. | PENDENTE |
| RPO/RTO | Aprovar limites de perda/recuperação e demonstrá-los em ensaio de restauração cronometrado. Valores propostos neste documento não são metas aprovadas. | PENDENTE |
| Rollback da aplicação | Definir artefatos/versionamento, compatibilidade frontend/API/schema, autoridade de decisão, execução e validação pós-retorno. | PENDENTE |
| Recuperação do banco | Aprovar procedimento específico por provedor, ponto de restauração, destino isolado, validação e autorização para retorno. Não remover contas globais nem auditoria como rollback de rotina. | PENDENTE |
| Validação pós-implantação | Definir smoke tests, health/readiness, login clínico e global, autorização, isolamento, booking, métricas, alertas, desempenho e critérios de interrupção; guardar evidências sem segredos. | PENDENTE |

Não publicar nem conectar a produção para completar este checklist sem autorização explícita e sem evidência de que o destino e as credenciais correspondem ao ambiente aprovado.

## Estado e responsáveis

| Item | Definição |
|---|---|
| Responsável técnico pelos backups e restaurações | PENDENTE DE DEFINIÇÃO OPERACIONAL |
| Responsável por aprovar recuperação e retorno à operação | PENDENTE DE DEFINIÇÃO OPERACIONAL |
| Serviço/plataforma de banco e respectiva região | PENDENTE DE DEFINIÇÃO OPERACIONAL |
| Repositório de backups aprovado, independente do banco primário | PENDENTE DE DEFINIÇÃO OPERACIONAL |
| Procedimento de acesso emergencial e controle de permissões | PENDENTE DE DEFINIÇÃO OPERACIONAL |

## RPO, RTO e retenção

Antes de configurar frequência ou retenção, o responsável de negócio e o responsável operacional devem definir e aprovar:

- **RPO:** perda máxima de dados aceitável, expressa como intervalo de tempo.
- **RTO:** tempo máximo aceitável para recuperar o serviço.
- frequência dos backups e período de retenção compatíveis com os valores aprovados;
- requisitos de criptografia em trânsito e em repouso;
- requisitos legais, contratuais e de residência dos dados;
- custo, propriedade e prazo de retenção de cópias históricas.

**RPO, RTO, frequência, retenção e localização ainda estão PENDENTES DE DEFINIÇÃO OPERACIONAL.** Não considerar valores-padrão do provedor como metas aprovadas pelo projeto.

### Proposta inicial para aprovação (não configurada)

Os parâmetros abaixo são uma proposta para avaliação de negócio, segurança, requisitos legais e custo. **Não representam backups existentes, metas aprovadas ou configuração ativa.** Não configurar estes valores sem aprovação explícita dos responsáveis e confirmação de suporte/custo pelo provedor.

| Controle | Proposta inicial |
|---|---|
| RPO | Até 15 minutos, usando recuperação pontual contínua (PITR/WAL) se suportada pelo serviço aprovado. |
| RTO | Até 4 horas, sujeito a exercício de restauração que comprove o tempo real. |
| Backups base | Snapshot completo automatizado diário, mais PITR contínuo com granularidade compatível com o RPO aprovado. |
| Retenção operacional | Backups diários/PITR por 35 dias. |
| Retenção histórica | Snapshot mensal por 12 meses, sujeito a obrigações legais, contratuais e custo aprovados. |
| Proteção | Criptografia em trânsito e em repouso gerenciada pelo provedor; acesso apenas por identidades operacionais específicas; cópia em conta/projeto de segurança separado do primário; alertas de falha e auditoria de acesso. Imutabilidade/retention lock somente após revisão legal e aprovação do ciclo de vida. |
| Separação de ambientes | Produção e testes em contas/projetos, credenciais, chaves e políticas de backup distintos. Não restaurar dados pessoais de produção no ambiente de teste; usar dados sintéticos ou anonimizados e aprovados. |
| Teste de recuperação | Exercício trimestral e após mudança relevante de plataforma: restaurar um ponto recente para destino isolado, verificar integridade, schema, inicialização e fluxos essenciais; registrar duração e resultado sem copiar dados para ambientes compartilhados. |

Se o provedor não oferecer PITR compatível, não assumir que backups diários satisfazem o RPO de 15 minutos: documentar a limitação, propor um RPO alternativo e obter aprovação antes de alterar ou adquirir serviços. Frequência, retenção e metas finais continuam pendentes até decisão formal.

## Procedimento a estabelecer para backups

1. O responsável operacional deve configurar o recurso de backup gerenciado ou processo aprovado após confirmar os requisitos e responsabilidades.
2. Armazenar cópias em repositório controlado, criptografado e independente da falha do banco primário, conforme política aprovada.
3. Restringir leitura, cópia e exclusão a identidades operacionais autorizadas; auditar alterações na política e acessos.
4. Monitorar resultado e idade da cópia mais recente; tratar falha ou atraso por canal operacional aprovado.
5. Registrar identificador, horário, escopo, região/localização, status e responsável por cada backup, sem registrar credenciais.
6. Definir como cópias antigas expiram e como exclusões são autorizadas, respeitando retenção legal e holds aplicáveis.

## Validação e teste de restauração

- Após cada backup, validar o status informado pela plataforma e a disponibilidade/legibilidade do artefato pelo mecanismo suportado.
- Não considerar a existência de um arquivo ou status de sucesso, isoladamente, prova suficiente de recuperabilidade.
- Realizar testes de restauração em ambiente isolado e autorizado, sem sobrescrever o banco primário.
- Antes de cada teste, aprovar escopo, destino isolado, responsáveis, janela e proteção dos dados restaurados.
- Validar integridade funcional e documentar duração, resultado, problemas e ações corretivas.
- Definir periodicidade dos testes em conjunto com as metas aprovadas; até então, a periodicidade está **PENDENTE DE DEFINIÇÃO OPERACIONAL**.

## Recuperação

### Perda ou indisponibilidade do banco

1. O responsável operacional declara o incidente e comunica os responsáveis definidos.
2. Confirmar escopo, último backup utilizável, ponto de recuperação disponível e aprovações necessárias.
3. Restaurar em destino controlado seguindo as instruções da plataforma aprovada; não apontar a aplicação ao destino até completar validações.
4. Verificar integridade e funcionamento com procedimentos aprovados, registrar a perda de dados estimada em relação ao RPO e o tempo em relação ao RTO.
5. Com aprovação, atualizar a configuração/roteamento do serviço, validar prontidão e monitorar a recuperação.
6. Preservar evidências operacionais e conduzir revisão pós-incidente.

### Falha da aplicação ou implantação

1. O responsável pelo serviço registra o incidente e avalia saúde da aplicação, dependências e logs sem expor credenciais ou dados pessoais.
2. Reverter para artefato/configuração de aplicação previamente aprovada, conforme processo de deploy da plataforma.
3. Não restaurar ou alterar o banco como resposta automática a falha exclusivamente da aplicação.
4. Validar liveness, readiness, autenticação e fluxos essenciais em ambiente autorizado; comunicar o retorno à operação.
5. Registrar causa, duração, impacto, decisão de recuperação e ações preventivas.

Os passos dependem dos serviços, controles de acesso e mecanismos de implantação escolhidos. O destino, os nomes dos responsáveis, os mecanismos de retorno e a autorização formal continuam **PENDENTES DE DEFINIÇÃO OPERACIONAL**.

## Exercícios e revisão

O proprietário operacional deve manter evidência datada de backups, verificações, testes isolados de restauração, resultados e ações corretivas. Revisar este runbook após mudanças de plataforma, requisitos, responsabilidades ou metas de RPO/RTO.

## Readiness e liveness da API

- `GET /api/health` e `GET /api/health/live` indicam que o processo responde; não verificam PostgreSQL.
- `GET /api/health/ready` executa uma verificação simples de dependência do banco e responde `503` quando indisponível. Testes locais cobrem o contrato com uma dependência simulada, sem conexão real.
- O readiness real do PostgreSQL ainda depende de validação em ambiente autorizado; latência, política de retries e integração com o orquestrador também precisam ser confirmadas.

## Rate limiting e proxy

- O código atual usa `RateLimiterMemory` para autenticação, API e reserva pública. Os limites são locais ao processo e são reiniciados junto com ele.
- Não há configuração de implantação no repositório que determine se a produção usará uma instância ou múltiplas; portanto, a topologia efetiva permanece **NÃO VERIFICADA**. Em uma instância, o limite só é efetivo enquanto aquele processo estiver ativo. Em múltiplas instâncias, cada processo mantém contadores separados e a proteção agregada pode ser excedida.
- Antes de habilitar mais de uma instância, a equipe de infraestrutura deve escolher, provisionar e monitorar um armazenamento compartilhado compatível com `rate-limiter-flexible`, definir autenticação, rede, custo, retenção/expiração das chaves e comportamento quando o armazenamento estiver indisponível. Nenhum Redis ou outro serviço foi configurado ou adicionado por este runbook.
- Manter os limites atuais. Não contornar falhas do armazenamento compartilhado com fallback silencioso para limites locais; definir e aprovar previamente a política de falha (bloquear ou permitir com alerta) conforme endpoint e risco.
- O PHP usa `REMOTE_ADDR` e não confia automaticamente em `X-Forwarded-For`. Atrás de proxy, isso pode agrupar tráfego no endereço do proxy. A infraestrutura deve definir a origem de IP confiável e bloquear cabeçalhos forjados antes de alterar essa política.

## CSP e hosting do frontend

O front controller em `php-backend/public/index.php` adiciona cabeçalhos às respostas da API. O frontend é um build Vite separado e esses cabeçalhos não configuram nem comprovam a CSP do host que entrega `frontend/dist`. A implantação deve definir e verificar sua própria CSP e cabeçalhos no host do frontend, sem assumir que os headers da API protegem documentos HTML servidos por outra plataforma. Nenhum host de produção foi inspecionado.

## Privilégios PostgreSQL e evidências de produção

Não foram inspecionados privilégios de uma instância de produção. Em uma sessão somente de leitura, autorizada e conectada como a identidade runtime da aplicação, a equipe responsável pode registrar a identidade efetiva e consultar os grants visíveis sem exibir credenciais:

```sql
SELECT current_database() AS database_name, current_user AS runtime_role;

SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication
FROM pg_roles
WHERE rolname = current_user;

SELECT table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = current_user AND table_schema = 'public'
ORDER BY table_name, privilege_type;
```

Verificar contra a matriz de operações runtime realmente necessária: a identidade da aplicação não deve ser superuser, proprietária do banco/schema, nem ter privilégios de administração de roles ou criação/alteração de schema. Conceder somente os privilégios DML estritamente necessários às tabelas usadas pela aplicação. Se migrations forem necessárias, executá-las por processo controlado com identidade separada, credencial não disponibilizada ao serviço runtime e aprovação por ambiente. Não executar comandos `GRANT`/`REVOKE` durante esta verificação; mudanças exigem revisão e autorização próprias.

Antes de declarar produção validada, obter evidências datadas e sem segredos de: topologia/quantidade e autoscaling de instâncias; identidade e privilégios runtime/migration; terminação HTTPS e certificados; política CSP e cabeçalhos do host frontend; origem CORS e cadeia de proxies; política e alertas de backup/PITR; relatório recente de restauração isolada e tempos medidos; retenção e acesso a logs/auditoria; monitoramento, alertas, responsáveis e procedimento de incidentes. Segredos devem ser validados por presença/rotação no gestor de segredos, sem imprimir seus valores.

## Observabilidade

O backend gera um `X-Request-ID` para correlação básica e evita registrar detalhes de erro nas respostas/logs de produção. Métricas, alertas, retenção de logs, APM e monitoramento externos dependem da plataforma de operação e estão **PENDENTES DE INFRAESTRUTURA**.

## Histórico: preparação isolada para validação de migrations

> Registro histórico anterior à remoção do backend Node, concluída após os testes integrados da API PHP. Referências a `backend/src`, `backend/test`, Express e aos comandos npm do workspace backend abaixo descrevem o código que existia durante essas etapas; não são instruções executáveis para a estrutura atual. O histórico é mantido para rastreabilidade.

Esta seção prepara uma validação futura; não aplica schema ou migrations e não autoriza conexão a bancos existentes.

### Resultado da verificação local

Diagnóstico anterior, antes de o Docker Desktop ser disponibilizado:

- Docker CLI e Docker Compose estavam instalados, mas o Docker daemon não estava disponível.
- Foi detectado um serviço PostgreSQL local em escuta na porta `5432`. Ele não foi identificado nem utilizado.
- A porta `55432` não estava em escuta durante a verificação. É somente uma porta candidata, não reservada nem garantida como livre no momento de uso.
- O `docker-compose.yml` existente não é configuração para testes de migrations: ele usa o nome fixo `clinic_postgres`, expõe `5432` e mantém o volume persistente `pgdata`. Não iniciar esse Compose como parte da validação isolada.

Preparação não produtiva concluída em 2026-10-06:

- Docker Desktop `running`; Docker Engine disponível; contexto `desktop-linux`.
- Container `sistema-agendamento-postgres-test`, imagem `postgres:16`, status `Up`.
- PostgreSQL publicado somente em `127.0.0.1:55432` (não utilizar `5432` para este container).
- Volume dedicado `sistema-agendamento-postgres-test-data`; banco `agendamento_test`; usuário `agendamento_test`. A senha é temporária, exclusiva de teste e não é registrada aqui.
- `pg_isready` aceitou conexões; `psql --version` e `SELECT version()` confirmaram PostgreSQL `16.15`.
- `SELECT current_database(), current_user` retornou `agendamento_test` e `agendamento_test`.
- A consulta de `information_schema.tables` no schema `public` retornou zero tabelas.
- A porta local `55432` respondeu ao teste TCP. A porta `5432` também respondeu, mas não foi alvo de nenhum comando de criação, configuração ou conexão desta etapa; o PostgreSQL local permaneceu intocado.
- Não foram executados migrations, `database/schema.sql`, seed ou operações de escrita. `.env` não foi aberto nem alterado e a aplicação não foi conectada ao container.

Comandos de verificação executados (somente leitura):

```powershell
docker ps --filter name=sistema-agendamento-postgres-test
docker inspect sistema-agendamento-postgres-test
docker volume ls --filter name=sistema-agendamento-postgres-test-data
docker exec sistema-agendamento-postgres-test pg_isready -U agendamento_test -d agendamento_test
docker exec sistema-agendamento-postgres-test psql --version
docker exec sistema-agendamento-postgres-test psql -U agendamento_test -d agendamento_test -c "SELECT version();"
docker exec sistema-agendamento-postgres-test psql -U agendamento_test -d agendamento_test -c "SELECT current_database(), current_user;"
docker exec sistema-agendamento-postgres-test psql -U agendamento_test -d agendamento_test -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
Test-NetConnection localhost -Port 55432
npm --workspace backend run check
```

### Estratégia de isolamento

O container acima é exclusivo para testes não produtivos, com banco e usuário próprios, senha temporária aleatória, publicação somente em localhost e volume Docker dedicado. Não usar o Compose padrão deste projeto, o container `clinic_postgres`, a porta `5432` ou o volume `pgdata`. Não apontar a aplicação a esse container por meio de `.env`. Não importar dados reais. O container e seu volume permanecem até que uma etapa autorizada determine seu descarte explícito.

### Análise de baseline — etapa 15.4

Conclusão da análise estática em 2026-10-06: **não existe baseline histórico reproduzível** anterior às migrations 001–007 nos arquivos/documentos pesquisados, nem ledger ou migration runner. Não reconstruir o estado histórico por inferência. O `database/schema.sql` declara o conjunto final dos objetos das sete migrations e é a estratégia recomendada para uma instalação limpa. Classificação: **OPÇÃO C — BASELINE HISTÓRICO INDETERMINADO**; recomendação operacional para uma etapa futura autorizada: **A — aplicar somente `database/schema.sql` ao banco vazio**, sem executar depois as migrations históricas.

| Migration | Objetos adicionados/alterados | Também presente em `schema.sql`? | Risco se aplicada sobre o schema limpo | Conclusão |
|---|---|---|---|---|
| 001 `add_users_token_version` | `users.token_version INTEGER NOT NULL DEFAULT 0` e check não negativo | Sim, coluna e check estão declarados em `users` | `ADD COLUMN IF NOT EXISTS` seria no-op para o objeto compatível; ainda assim não registra histórico nem é necessária | Não aplicar após o schema |
| 002 `enforce_clinic_consistency` | Seis índices únicos compostos; onze FKs compostas multi-clínica; função `enforce_audit_entity_clinic()` e trigger `trg_audit_logs_entity_clinic` | Sim; os índices/constraints, função e trigger constam no schema | Checagens por nome deixam os índices/constraints e trigger existentes; a função é substituída e as constraints validadas sob locks. Redundante e sem ledger, embora os objetos esperados coincidam | Não aplicar após o schema |
| 003 `prevent_overlapping_appointments` | `btree_gist`, exclusion constraint `ex_appointments_no_overlapping_professional`; remoção do índice legado `ux_appointments_unique_slot` se existir | Sim; extensão e exclusion constraint estão declaradas. O índice legado não está no schema | A extensão/constraint existentes passam pelas verificações; a remoção do índice legado é condicional e seria no-op se ausente. Desnecessária; não usar como prova de histórico | Não aplicar após o schema |
| 004 `validate_professional_schedule_intervals` | Check nomeado `ck_professional_schedules_valid_interval` em `professional_schedules` | A regra equivalente `CHECK (end_time > start_time)` existe inline, mas não com o nome da migration | A migration não reconheceria o check inline pelo nome e adicionaria um segundo check equivalente, depois o validaria | Não aplicar; evitar constraint redundante |
| 005 `add_clinic_timezone` | `clinic_configurations.timezone VARCHAR(64) NOT NULL DEFAULT 'UTC'` e check não vazio | Sim, coluna e check estão declarados | `ADD COLUMN IF NOT EXISTS` seria no-op para a coluna existente; não valida que a definição coincida e não é necessária | Não aplicar após o schema |
| 006 `add_services` | `services`, `professional_services`, quatro colunas/snapshots em `appointments`, FK/check, índices e trigger de `updated_at` | Sim; tabelas, colunas, constraints, índices e trigger estão declarados | Falha ao tentar `CREATE TABLE services` que já existe; a migration está em transação, mas não deve ser usada como mecanismo de detecção | Não aplicar; incompatível com schema já instalado |
| 007 `public_booking` | `clinic_configurations.public_slug` e check/índice único parcial; `appointments.public_idempotency_key` e índice único parcial | Sim; colunas, checks e índices parciais estão declarados | `ALTER TABLE ... ADD COLUMN` sem `IF NOT EXISTS` falha na coluna já existente | Não aplicar; incompatível com schema já instalado |

#### Dependências e propriedades estáticas de `schema.sql`

- Extensões requeridas: `pgcrypto` (default `gen_random_uuid()`) e `btree_gist` (operadores GiST usados pela exclusion constraint). Na inspeção estática anterior à etapa 15.5, ambas apareciam disponíveis no PostgreSQL 16 do container (`pg_available_extensions`); a etapa 15.5 confirmou a instalação de ambas no banco.
- Funções PL/pgSQL definidas pelo schema: `enforce_audit_entity_clinic()` e `update_updated_at_column()`. Não há `CREATE TYPE` de tipos customizados.
- Triggers: `trg_audit_logs_entity_clinic` e doze triggers `trg_*_updated_at` nas tabelas clínicas, usuários, especialidades, serviços, profissionais, pacientes, agendas, bloqueios, agendamentos, pagamentos, configurações e configurações da clínica.
- O schema declara FKs simples e compostas, checks, chaves primárias/únicas e a exclusion constraint de agendamento; cria índices comuns e índices únicos parciais para slug público e chave de idempotência. As tabelas estão ordenadas pelas dependências referenciadas; funções são definidas antes dos triggers que as usam.
- A inspeção estática indicou que o arquivo é autocontido quanto à definição desses objetos e ordenado para instalação limpa em PostgreSQL 16 com as extensões disponíveis. A execução controlada na etapa 15.5 confirmou que o arquivo completou sem erro nesse ambiente.
- Reexecução não é segura: apenas as criações das extensões usam `IF NOT EXISTS`; funções usam `CREATE OR REPLACE`, mas tabelas, índices e triggers usam criações sem guarda. Uma segunda execução encontra tabelas existentes e falha.

#### Busca por histórico e runner

- A busca no repositório por ledger, tabela de histórico, baseline, runner e ferramentas conhecidas (`knex`, `prisma`, `sequelize`, `typeorm`, `flyway`, `liquibase`, `pgmigrate`) não encontrou mecanismo de aplicação/histórico de migrations. As sete migrations disponíveis estão em `database/migrations/`.
- `package.json` oferece apenas `db:up` e `db:down`, que controlam o serviço do `docker-compose.yml`; não são migration runner e não devem ser usados para esta validação. `backend/package.json` não define script de migration.
- O README recomenda `database/schema.sql` para instalação nova e migrations pendentes em bancos existentes, mas não fornece baseline histórico anterior a 001 ou mecanismo para provar quais migrations já foram aplicadas.
- Na etapa 15.4, verificação somente leitura confirmou `agendamento_test`, usuário `agendamento_test` e zero tabelas públicas. Nenhuma migration, schema, seed ou escrita foi executada naquela análise.

### Execução controlada do schema — etapa 15.5

Execução concluída em 2026-10-06 no container `sistema-agendamento-postgres-test`, PostgreSQL `16.15`, banco `agendamento_test`, usuário `agendamento_test`, publicado somente em `127.0.0.1:55432`. O precheck confirmou o banco e usuário esperados e zero tabelas públicas antes da execução.

Comando utilizado, executado uma única vez:

```powershell
Get-Content -LiteralPath '.\database\schema.sql' -Raw |
  docker exec -i sistema-agendamento-postgres-test psql -X -v ON_ERROR_STOP=1 -U agendamento_test -d agendamento_test
```

O comando terminou com código zero; o `psql` concluiu os comandos `CREATE EXTENSION`, `CREATE TABLE`, `CREATE INDEX`, `CREATE FUNCTION` e `CREATE TRIGGER` sem erro. O esquema criou 14 tabelas públicas:

`appointments`, `audit_logs`, `clinic_configurations`, `clinics`, `patients`, `payments`, `professional_schedules`, `professional_services`, `professionals`, `schedule_blocks`, `services`, `settings`, `specialties`, `users`.

Verificações somente leitura após execução:

- Extensões instaladas: `btree_gist` 1.7 e `pgcrypto` 1.3.
- Funções próprias confirmadas: `enforce_audit_entity_clinic()` e `update_updated_at_column()`. As extensões também disponibilizam funções no schema `public`.
- Triggers: 13 triggers não internos; `trg_audit_logs_entity_clinic` atende INSERT e UPDATE, além dos doze triggers `trg_*_updated_at`.
- Constraints em `public`: 14 PRIMARY KEY, 16 UNIQUE, 37 FOREIGN KEY, 19 CHECK e uma exclusion constraint. Entre as principais FKs estão as compostas multi-clínica para usuários, profissionais, pacientes, especialidades, serviços, agendamentos, pagamentos e auditoria.
- Exclusion constraint presente: `ex_appointments_no_overlapping_professional` em `appointments`.
- Índices: 52 no total em `public`, incluindo `uq_clinic_configurations_public_slug`, `uq_appointments_clinic_id_idempotency_key`, `idx_appointments_clinic_service_id`, `idx_professional_services_clinic_service` e índices de tenant (`clinic_id`).
- Contagem de registros retornou zero em todas as 14 tabelas; não foram inseridos dados de negócio.
- Migrations 001–007 não foram executadas; seed e `test-flow` não foram executados.
- PostgreSQL local na porta `5432` não foi alvo de comandos. `.env` não foi aberto ou modificado. Backend não foi conectado ao banco.
- `npm --workspace backend run check` passou. Não foi iniciado servidor nem executado fluxo que acessasse o banco.

Resultado: **ETAPA 15.5 CONCLUÍDA**. O banco de teste agora contém a estrutura do snapshot atual, não está mais vazio em termos de tabelas e permanece sem registros de negócio. Não reaplicar `schema.sql` nem executar migrations 001–007 sobre este banco.

### Integração Backend ↔ PostgreSQL — etapa 15.6

Resultado em 2026-10-06: **ETAPA 15.6 PARCIALMENTE VALIDADA / BLOQUEADA PARA FLUXOS AUTENTICADOS**.

- Backend iniciado temporariamente em `127.0.0.1:4000`, com `NODE_ENV=test` e variáveis `DB_*` em memória apontando exclusivamente para `127.0.0.1:55432`, banco `agendamento_test`. Foi usado segredo JWT efêmero; nenhum valor secreto foi registrado.
- O processo foi iniciado com diretório de trabalho temporário recém-criado, sem `.env`, e encerrado ao fim dos testes. Nenhum `.env` do projeto foi aberto ou alterado. A porta HTTP não estava ocupada e o listener observado foi somente `127.0.0.1`; após o teste não restou listener em `4000`.
- PostgreSQL direto confirmou `pg_isready`, banco/usuário esperados e versão `16.15`.
- Endpoints: `/api/health` → HTTP 200; `/api/health/ready` → HTTP 200 (consulta real `SELECT 1` pelo pool do backend); `/api/public/clinics/nonexistent-test-clinic` e `/services` → HTTP 404 esperado para slug sintético inexistente; `POST /api/auth/login` com usuário fictício inexistente → HTTP 401 após consulta ao banco; `GET /api/clinics` sem token e com token inválido → HTTP 401.
- **Bloqueio de operações autenticadas:** não há rota de criação de clínica. `POST /api/auth/register` exige autenticação e papel `admin`; não existe fluxo disponível para provisionar com segurança o primeiro administrador. Para respeitar a exigência de criação oficial de usuários e não contornar a autorização, não foram inseridos clínicas, usuários ou recursos por SQL, e não foi fabricado token de usuário.
- Consequentemente, CRUD autenticado, multi-clínica/IDOR, serviços, disponibilidade, agendamento/conflito, booking público com slug real, idempotência e auditoria não foram exercitados nesta etapa.
- Nenhum dado foi criado, então não houve limpeza necessária. Verificação posterior confirmou as 14 tabelas intactas, total de registros de negócio igual a zero e exclusion constraint preservada.
- Nenhuma migration, seed ou `test-flow` foi executado. A porta local `5432` não foi usada; `.env` permaneceu intocado.
- `npm --workspace backend run check` passou após o teste.

### Provisionamento controlado de autenticação — etapa 15.6.1

Resultado da execução inicial em 2026-10-06: **PARCIAL**, complementado pelo reteste após correção registrado abaixo. O provisionamento, login/JWT e operações iniciais de duas clínicas foram exercitados no banco não produtivo; a leitura autenticada de serviços retornou HTTP 500 e impediu concluir a validação de isolamento por essa rota.

- Motivo do provisionamento direto: não existe rota para criar a primeira clínica/admin; `POST /api/auth/register` exige um administrador existente. Conforme autorização específica da etapa, foram criadas diretamente no PostgreSQL isolado duas clínicas sintéticas — `Clinica Teste Integracao` e `Clinica Teste B` — e os administradores `admin.integration@example.invalid` e `admin.integration.b@example.invalid`. Não foram usados dados pessoais/reais.
- As senhas aleatórias foram mantidas apenas em memória durante os testes. Os valores armazenados em `users.password_hash` foram produzidos por `hashPassword()` do projeto (`bcryptjs`, custo 12); somente prefixo/custo/comprimento foram verificados, sem registrar hash ou senha. As senhas não foram preservadas para reutilização.
- Login real de ambos os administradores retornou HTTP 200. Os JWTs recebidos em memória foram verificados localmente quanto a assinatura HS256, issuer, audience, `sub`, `clinicId` e `sessionVersion`; nenhum token foi salvo ou registrado.
- `GET /api/clinics` e `GET /api/auth/me` retornaram a clínica/identidade correspondentes para os dois tokens. Token ausente, token inválido e senha inválida retornaram HTTP 401; tentativa de sobrescrever `clinicId` no corpo com token da outra clínica retornou HTTP 403. Uma tentativa adicional de login com clínica errada foi limitada pelo rate limiter (HTTP 429), não usada como evidência de autorização.
- Pela API autenticada foram criados em cada clínica: uma configuração pública com slug sintético (`clinica-teste-integracao` / `clinica-teste-b`), uma especialidade, um profissional, um serviço associado ao profissional e um horário semanal. As rotas públicas retornaram as duas clínicas e um serviço ativo por clínica; consultar profissionais da clínica A usando o ID de serviço da clínica B retornou lista vazia.
- Acesso cruzado a especialidade e profissional por token da outra clínica retornou HTTP 404. O corpo com `clinicId` da clínica B enviado pela clínica A foi rejeitado com HTTP 403.
- **Falha observada na execução inicial:** GET próprio e cruzado de `/api/services/:id` retornaram HTTP 500. A auditoria confirmou que `serviceSelectSql()` sempre inclui o predicado profissional com placeholders até `$3` na listagem e `$4` na consulta individual, enquanto os handlers só anexavam `userId` para o papel `professional`. Para `admin` e `patient`, faltava um valor vinculado. O IDOR de serviço permaneceu sem validação até o reteste abaixo.
- Auditoria de serviços contém, em cada clínica, uma ação `created` e uma `professional_assigned`. Estado final: 2 clínicas, 2 usuários admin, 2 configurações, 2 especialidades, 2 profissionais, 2 serviços, 2 associações profissional-serviço, 2 horários semanais e 4 linhas de auditoria de serviço; 0 pacientes e 0 agendamentos.
- Dados sintéticos foram mantidos no banco isolado para continuidade controlada. Não houve limpeza. A estrutura e a exclusion constraint permaneceram intactas. Nenhuma migration, seed ou `test-flow` foi executado.
- Backend temporário escutou somente em `127.0.0.1:4000` e foi encerrado; não restou listener. A conexão usou exclusivamente `127.0.0.1:55432`. A porta `5432` não foi usada; `.env` não foi aberto nem alterado.
- Na execução inicial, `npm --workspace backend run check` passou e nenhum arquivo de código foi alterado; apenas este runbook foi atualizado.

#### Reteste após correção da consulta de serviços — etapa 15.6.1

Resultado em 2026-10-06: **CONCLUÍDA para a validação controlada de autenticação e isolamento na leitura de serviços**.

- Causa técnica confirmada no fluxo: as duas consultas GET adicionam o predicado de visibilidade por papel, que referencia `userId` mesmo quando a condição de `patient` ou `professional` não é usada. Os handlers de listagem e consulta individual enviavam esse parâmetro somente para profissionais, deixando incompleta a lista de parâmetros para admins e pacientes.
- Correção mínima em `backend/src/routes/serviceRouterFactory.js`: ambos os handlers agora sempre vinculam `req.user.userId`. A sequência de parâmetros passou a corresponder aos placeholders (`clinicId, role, userId` na lista; `clinicId, serviceId, role, userId` no item). O filtro multi-clínica `s.clinic_id = $1`, as condições por papel e as regras de autorização não foram alterados.
- O teste de `backend/test/serviceRoutes.test.js` agora também confirma que o maior placeholder da SQL tem parâmetro correspondente nos GET de lista e item, além de verificar os valores vinculados.
- Teste real no container `sistema-agendamento-postgres-test`, somente contra `agendamento_test`/PostgreSQL 16: login A/B → HTTP 200; `/api/auth/me` → HTTP 200 e identidade/tenant esperados; serviço próprio A/B → HTTP 200 e `clinic_id` correspondente; serviço do outro tenant → HTTP 404 com a mensagem genérica “Serviço não encontrado.”, sem expor o ID do serviço. JWTs foram usados somente em memória.
- Como as senhas temporárias anteriores não estavam disponíveis, foram geradas credenciais sintéticas efêmeras para os dois admins e senha efêmera para o usuário do banco isolado. Somente os hashes bcrypt dos admins foram atualizados nesse banco de teste. Nenhuma credencial foi exibida ou registrada; elas não foram preservadas para reutilização. O segredo JWT também foi efêmero. `.env` não foi lido nem alterado.
- Estado conferido após os testes: 2 clínicas, 2 usuários, 2 configurações, 2 especialidades, 2 profissionais, 2 serviços, 2 associações profissional-serviço, 2 horários, 4 registros de auditoria, 0 pacientes e 0 agendamentos. Nenhum recurso de negócio adicional foi criado pelo reteste; volume e schema permaneceram intactos.
- Validação: suíte existente completa `node --test backend/test/*.test.js` — 145 passaram, 0 falharam; `npm --workspace backend run check` passou. Os testes automatizados relacionados a serviços também passaram.
- Backend temporário escutou somente em `127.0.0.1:4000` e foi encerrado; porta `4000` sem listener ao final. PostgreSQL continuou publicado somente em `127.0.0.1:55432`; a porta `5432` não foi usada.
- Nenhuma migration, schema, seed ou `test-flow` foi executado. Nenhum arquivo do frontend, autenticação/JWT, schema ou constraints foi alterado.
- Arquivos alterados nesta correção: `backend/src/routes/serviceRouterFactory.js`, `backend/test/serviceRoutes.test.js` e este runbook.

### Cenários e baselines para etapa posterior autorizada

**Instalação limpa já preparada:** o banco `agendamento_test` recebeu `database/schema.sql` na etapa 15.5. Não reaplicar o arquivo nele nem aplicar as migrations 001–007. Para outra instalação limpa, usar um banco de teste novo e isolado e aplicar somente o snapshot revisado, mediante autorização específica.

**Banco evolutivo:** não existe no repositório um schema inicial versionado anterior à cadeia 001–007. Os arquivos disponíveis incluem o schema final e migrations incrementais que pressupõem tabelas base. Portanto, o baseline histórico completo está **BASELINE NÃO RECONSTRUÍVEL COM SEGURANÇA** apenas com os arquivos atuais. Não derivar um baseline removendo objetos do schema final nem aplicar a cadeia nele. Para validar a evolução, obter e revisar o DDL histórico aprovado do estado imediatamente anterior à migration necessária, ou preparar um dump sintético desse estado em ambiente isolado com aprovação explícita; sem isso, validar somente cada migration estaticamente.

| Migration | Baseline imediatamente anterior esperado | Situação do baseline neste repositório |
|---|---|---|
| 001 | Schema base com `users`, sem `token_version` | Não há schema base histórico; não reconstruível com segurança |
| 002 | Tabelas base e FKs simples, sem garantias compostas da migration | Não há schema base histórico; não reconstruível com segurança |
| 003 | `appointments` com intervalos/status e índice legado opcional `ux_appointments_unique_slot` | Não há baseline histórico que prove essa forma; não reconstruível com segurança |
| 004 | `professional_schedules` sem a constraint nomeada `ck_professional_schedules_valid_interval` | Não há baseline histórico; schema final já contém check equivalente |
| 005 | `clinic_configurations` sem `timezone` | Não há baseline histórico; schema final já contém `timezone` |
| 006 | Tabelas base, FKs compostas requeridas e função `update_updated_at_column()`, sem objetos do módulo de serviços | Não há baseline completo; o schema final já inclui o módulo |
| 007 | `clinic_configurations` e `appointments` sem os objetos de booking público | Não há baseline histórico; schema final já inclui slug e idempotência |

### Plano de validação futura

Executar somente mediante autorização específica; a preparação e as verificações abaixo já concluídas não autorizam alterações no banco:

1. Reconfirmar a identidade do container `sistema-agendamento-postgres-test` e banco de teste antes de qualquer conexão posterior.
2. O servidor já foi confirmado como PostgreSQL 16; registrar extensões disponíveis, sem assumir permissões para instalá-las.
3. O banco `agendamento_test` já recebeu `schema.sql` na etapa 15.5; não repetir nele. Para uma instalação separada, autorizada e limpa, criar outro banco isolado e aplicar somente o snapshot revisado.
4. Não criar o cenário evolutivo até obter baseline histórico revisado e aprovado; não usar o schema final como baseline.
5. Fazer snapshot lógico do banco de teste vazio ou do baseline sintético antes da validação. Usar somente dados artificiais; nunca fazer backup ou restore de banco real como parte desse ensaio.
6. Executar prechecks somente leitura antes da migration correspondente: referências cross-clinic da 002; sobreposições não canceladas para 003; intervalos inválidos para 004; objetos existentes e função para 006; colunas, constraints, índices, slugs e chaves existentes para 007.
7. Aplicar uma migration por vez na cadeia aprovada `001 → 002 → 003 → 004 → 005 → 006 → 007`, somente contra baseline cuja identidade e objetos tenham sido verificados. Interromper diante de qualquer objeto duplicado, precheck não vazio ou definição divergente. A ordem não substitui a confirmação do estado.
8. Validar constraints, índices, FKs, triggers, funções e extensões após cada etapa; registrar saídas sem credenciais ou dados pessoais.
9. Executar integração e cenários multi-clínica somente no container e com fixtures sintéticas: conflito/consecutividade/cancelamento, criação e snapshot de serviço, isolamento de associação, slug e idempotência incluindo a pendência de retry após cancelamento.
10. Testar recuperação/rollback somente em cópia descartável do banco de teste. Não tratar rollback destrutivo de 006/007 como seguro após criação de dados.
11. Após aprovação do resultado, remover apenas o container isolado identificado e documentar a confirmação de descarte.

Não há migration ledger, tabela de histórico, ferramenta ou script de aplicação de migrations no projeto identificado nesta auditoria. Os scripts npm de banco existentes iniciam/param o Compose padrão e não devem ser usados para este ambiente de validação.

### Assinaturas SaaS — migration 008 e validação PostgreSQL

Concluído em 2026-10-07 no container `sistema-agendamento-postgres-test`, PostgreSQL 16.15, exclusivamente no banco `agendamento_test`, publicado em `127.0.0.1:55432`.

- Causa do erro SCRAM `28P01`: o volume persistente continha o cluster inicializado com uma senha anterior. `POSTGRES_PASSWORD` no `docker inspect` representa a configuração de inicialização do container e não altera a senha do role em um volume já inicializado.
- Correção restrita ao ambiente de teste: usando a conexão local autenticada do sistema operacional dentro do container identificado, a senha do role `agendamento_test` foi sincronizada com o valor já configurado nesse mesmo container. SCRAM permaneceu habilitado; não houve recriação ou descarte do volume. O valor da credencial não foi impresso ou registrado.
- Identidade verificada por conexão TCP ao alvo configurado: `current_database() = agendamento_test`, `current_user = agendamento_test`, porta do servidor PostgreSQL `5432` dentro do container, versão `160015`; o encaminhamento Docker confirmado foi somente `127.0.0.1:55432`. O endereço retornado por `inet_server_addr()` foi o IP interno Docker do container, esperado nessa topologia.
- Baseline antes da migration: schema base instalado, 14 tabelas públicas, `clinics` e `update_updated_at_column()` presentes e nenhuma relação `subscriptions`. Migrations 001–007 não foram repetidas.
- A migration `008_clinic_subscriptions.sql` foi executada uma vez, em transação, somente em `agendamento_test`. Resultado: 15 tabelas públicas (as 14 preexistentes mais `subscriptions`), 15 colunas da nova tabela, 11 constraints (PK, FK e checks), 4 índices e o trigger `trg_subscriptions_updated_at`. Nenhuma tabela preexistente foi alterada pela migration.
- Validação real de API/DB usou quatro clínicas e cinco contas sintéticas, removidas pela chave UUID exata ao final. Testou login/JWT, ausência inicial de assinatura, leitura autenticada, isolamento A/B, tentativa de sobrescrever `clinicId`, autorização de admin, rejeição de mutações sem endpoint, ciclos mensal/trimestral/anual (14999/39999/139999 centavos), constraints de plano/ciclo/status/datas/FK, duplicidade de assinatura atual, cancelamento, transições ativa ↔ inadimplente e substituição após cancelamento.
- Auditoria reutilizou `audit_logs`: criação (4), cancelamento (1) e atualização (2), com clínica e usuário corretos, sem credenciais nos detalhes. A integrity query retornou zero órfãs, linhas inválidas, duplicidades atuais e referências de auditoria inconsistentes.
- Após a limpeza, contagens foram restauradas exatamente ao baseline: 2 clínicas, 2 usuários, 0 assinaturas e 8 logs de auditoria. Nenhuma fixture foi mantida.
- A primeira integração identificou incompatibilidade de inferência PostgreSQL no parâmetro de status da instrução de transição; a consulta foi corrigida com cast explícito `varchar` e a integração passou no reteste.
- `node --test backend/test/subscriptionService.test.js backend/test/subscriptionRoutes.test.js backend/test/subscriptionSchema.test.js`: 16 passaram, 0 falharam. Suíte completa com `RUN_SUBSCRIPTION_DB_INTEGRATION=1`: 170 passaram, 0 falharam, 0 ignorados. `npm --workspace backend run check` passou.
- O backend temporário foi encerrado com o teste; o container PostgreSQL de teste foi parado após a auditoria. O volume dedicado foi preservado. Nenhum banco de produção foi acessado, nenhuma autenticação foi desabilitada e nenhuma credencial foi exposta.
- O teste real repetível está em `backend/test/subscriptionDatabaseIntegration.test.js` e somente executa quando `RUN_SUBSCRIPTION_DB_INTEGRATION=1`, exigindo explicitamente `DB_HOST=127.0.0.1`, `DB_PORT=55432`, `DB_NAME=agendamento_test` e o usuário de teste correspondente.
