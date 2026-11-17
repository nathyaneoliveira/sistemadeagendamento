# Backend PHP

Esta é a implementação da API sob o prefixo `/api`; ela lê, sem imprimir valores, a configuração local em `backend/.env`. A integração HTTP com PostgreSQL foi validada no banco isolado `agendamento_php_security_test`; isso não certifica, por si só, a hospedagem de produção.

## O que já está portado

- `GET /api/health` e `/api/health/live`.
- `GET /api/health/ready`.
- Login de clínica, incluindo seleção assinada quando o mesmo e-mail/senha corresponde a mais de uma clínica.
- `GET /api/auth/me` e `POST /api/auth/logout`, com JWT HS256, validação de `token_version` e isolamento por clínica.
- Recuperação de senha: solicitação por e-mail e confirmação com token de uso único, validade de 30 minutos e invalidação de sessões anteriores; SMTP usa as variáveis documentadas para o backend e tem limites por IP e e-mail.
- Cadastro de usuários da clínica por administradores, com permissão por plano e hash bcrypt compatível.
- Clínicas: `GET /api/clinics` e `GET /api/clinics/users`.
- Pacientes: `GET/POST /api/patients`, `GET/PUT /api/patients/:id`.
- Especialidades: listagem e leitura, criação e edição.
- Profissionais: listagem/detalhe, criação/edição e alteração de status.
- Serviços: listagem/detalhe, criação/edição, status e associação de profissionais.
- Agenda: horários semanais, bloqueios e consulta de disponibilidade.
- Agendamentos: listagem/detalhe, criação, edição de notas, status, cancelamento e reagendamento.
- Configurações: consulta e atualização dos dados da clínica, fuso horário, endereço público e preferências de lembrete.
- Assinatura atual: plano, ciclo, valor, limites e capacidades do plano.
- Auditoria: consulta dos últimos 200 eventos para planos com esse recurso.
- Relatórios: resumo do período, série diária, serviços, profissionais e valores recebidos.
- Pagamentos: listagem, registro interno, alteração de status e geração de checkout Mercado Pago para cobrança de consulta.
- Contratação: cadastro inicial da clínica e criação de preferência de assinatura Mercado Pago; webhook assinado ativa a assinatura e a clínica após pagamento aprovado.
- Lista de espera: inclusão interna e pública com consentimento, consulta de interessados compatíveis com um horário cancelado e atualização de status.
- Portal do paciente: solicitação de link por e-mail, consulta do agendamento e cancelamento futuro com token único de 24 horas.
- Administração da plataforma: login global separado das clínicas, sessão e logout revogáveis, dashboard financeiro estimado, busca/paginação de clínicas e assinaturas, detalhes e eventos recentes com auditoria administrativa.
- Agendamento público: leitura dos dados da clínica, serviços, profissionais por serviço e disponibilidade; criação com chave idempotente, trava contra concorrência, validação de contato e consentimento de lembretes.
- Os módulos acima preservam autenticação, escopo por clínica e as permissões/limites de plano implementados nesta etapa.
- Limites de chamadas por IP portados para grupos de API, autenticação, consultas públicas e ações sensíveis.
- Worker de lembretes por e-mail e WhatsApp com seleção concorrente segura, tentativas limitadas e repetição progressiva.

Senhas existentes com hash bcrypt permanecem compatíveis via `password_verify`. O segredo JWT, os dados PostgreSQL e CORS são lidos do ambiente/arquivo local de configuração, nunca retornados pela API.

Para enviar os e-mails de recuperação, configure em conjunto `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` e `PUBLIC_APP_URL` no ambiente; em produção, `PUBLIC_APP_URL` deve usar HTTPS. Se o envio falhar, os tokens emitidos são revogados e a API informa indisponibilidade.

Para cobrança e contratação, configure `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_WEBHOOK_URL` e `PUBLIC_APP_URL`. O webhook valida a assinatura HMAC e confirma o valor/currency antes de marcar pagamentos ou ativar uma clínica.

## Executar no Windows

### Requisitos

- Windows 11 com PowerShell.
- PHP CLI 8.1 ou superior disponível no `PATH`.
- Extensão `pdo_pgsql` carregada na configuração efetiva do PHP CLI.

Confira qual PHP será usado e sua versão:

```powershell
Get-Command php
php -v
```

Confira se `pdo_pgsql` está carregada e disponível como driver PDO:

```powershell
php -m | Select-String -Pattern '^(PDO|pdo_pgsql)$'
php -r "if (!extension_loaded('pdo_pgsql') || !in_array('pgsql', PDO::getAvailableDrivers(), true)) { exit(1); } echo 'pdo_pgsql disponível';"
```

O inicializador repete as verificações de versão e driver antes de iniciar. Ele não modifica `php.ini` nem força o carregamento de extensões. Se uma dependência estiver ausente, o script informa o requisito e interrompe a inicialização.

### Iniciar a API

Na raiz do repositório:

```powershell
& .\php-backend\run.ps1
```

De qualquer outro diretório, invoque o script pelo caminho absoluto do projeto:

```powershell
& 'C:\caminho\completo\do\projeto\php-backend\run.ps1'
```

O script localiza os arquivos a partir do próprio `$PSScriptRoot`, usa `php-backend\public` como document root e `php-backend\public\index.php` como front-controller. O servidor escuta somente em `127.0.0.1`, na porta `4000`; a API local fica em `http://127.0.0.1:4000/api`.

Configure `backend/.env` de acordo com o ambiente PHP antes do login ou do readiness check. `GET /api/health` não depende do banco. Para selecionar outro arquivo de configuração, defina `NOA_ENV_FILE` antes de iniciar.

Em qualquer ambiente, `NODE_ENV` deve ser explicitamente `development`, `test` ou `production`, e `JWT_SECRET` deve estar configurado com pelo menos 32 bytes, sem espaços no início ou no fim. Em produção, a inicialização falha se faltar `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ou `CORS_ORIGIN`; valores locais de desenvolvimento são rejeitados. `DB_SSL` deve estar habilitado, o host do banco não pode ser loopback e `CORS_ORIGIN` deve ser uma origem HTTPS não local. Se `DB_SSL_CA_PATH` for definido, deve apontar para um certificado CA legível.

`JWT_EXPIRES_IN` aceita somente um inteiro positivo seguido de `s`, `m`, `h` ou `d` (por exemplo, `30m` ou `8h`); o padrão é `8h`. `JWT_AUDIENCE` é opcional e define a audiência dos tokens de clínica, cujo padrão é `sistema-de-agendamentos-client`. As audiências de administração da plataforma e de seleção de clínica permanecem próprias e não são substituídas por essa variável.

### Produção

O servidor embutido iniciado por `php -S` é somente para desenvolvimento local. Não o use como servidor de produção. Em produção, use um servidor web e uma configuração PHP-FPM ou equivalente apropriada à plataforma, com TLS, configuração segura e gestão de processos. A hospedagem PHP ainda precisa de validação integrada antes de ser considerada pronta para produção.

## Verificação local

Na raiz do repositório, rode `& .\php-backend\test.ps1`. Esse smoke test valida sintaxe PHP, carga do driver, health/readiness, erros de validação sem acesso ao banco e resposta 404. Também verifica a ajuda do worker e o bloqueio seguro do provisionamento sem confirmação. Os fluxos integrados com PostgreSQL estão cobertos por runner isolado próprio.

Para executar a primeira bateria P0 de segurança do PHP, rode `php .\php-backend\test\security-p0.php`. Ela verifica JWT e revogação por `token_version` com dados sintéticos e aplica guardas estáticas às consultas tenant-scoped, autorização administrativa e allowlists. Essas guardas estáticas não substituem testes de integração: não executam as rotas contra PostgreSQL nem comprovam seus efeitos.

### Integração HTTP + PostgreSQL isolado

A bateria integrada é opt-in e executa a API PHP em `127.0.0.1` apenas durante os testes. Ela exige uma base local vazia chamada `agendamento_php_security_test`, no serviço PostgreSQL em `127.0.0.1:5432`, e um arquivo JSON de configuração local fora do repositório, com as propriedades `host`, `port`, `database`, `user` e `password`. Não reutilize o `.env` da aplicação. O runner recusa qualquer outro host, porta ou nome de base e nunca lê `database/schema.sql` nem executa migrations.

Exemplo de configuração (substitua usuário e senha localmente; não versione o arquivo):

```json
{
  "host": "127.0.0.1",
  "port": 5432,
  "database": "agendamento_php_security_test",
  "user": "<usuario-local-de-teste>",
  "password": "<senha-local>"
}
```

Crie uma base PostgreSQL dedicada e vazia, salve a configuração fora do repositório e execute:

```powershell
& .\php-backend\test\run-security-integration.ps1 -ConfigPath 'C:\caminho\local\php-security-test.json'
```

O runner verifica identidade do banco e do usuário, carrega somente o schema mínimo versionado em `test/security-integration-schema.sql` em uma base sem objetos, cria fixtures sintéticas, inicia a API local, verifica respostas HTTP e efeitos persistidos e remove somente os IDs fixos das fixtures. O schema mínimo cobre as relações usadas pelos cenários; não certifica o snapshot completo do PostgreSQL de produção. Se a preparação, execução ou limpeza falhar, o runner retorna erro e não tenta migrations nem limpeza ampla. O servidor PHP embutido é usado somente para desenvolvimento/teste, nunca para produção.

A suíte cobre JWT no limite HTTP (assinatura, algoritmo, issuer, audience, exp, nbf e `sessionVersion`), revogação concorrente, isolamento de pacientes/profissionais/agendamentos/pagamentos, autorização, mass assignment, validação e persistência financeira. Também valida por HTTP que somente clínicas com `status = active` acessam rotas protegidas, inclusive quando a assinatura permanece ativa, e que status de clínica ou assinatura inválidos/expirados são negados sem persistir alterações. A confirmação de um webhook aprovado pelo provedor de pagamentos não é simulada pela suíte. Ela também evidencia o comportamento atual de criação de pagamento: usuário administrativo clínico pode fornecer `amount` e `status`; o teste confirma que `paid_at` é derivado no servidor, mas não prova que o valor/status foram autorizados por um gateway. Esse ponto requer decisão de regra de negócio e não deve ser interpretado como validação antifraude.

## Worker de lembretes

Em outro terminal, a partir da raiz do repositório, execute `& .\php-backend\run-reminders.ps1`. O processo busca lembretes vencidos a cada 60 segundos. Para processar uma única leva e encerrar, use `& .\php-backend\run-reminders.ps1 --once`. Configure SMTP para e-mail e `WHATSAPP_API_URL`/`WHATSAPP_API_TOKEN` para WhatsApp no mesmo `backend/.env` usado pela API. O worker não envia mensagens sem consentimento registrado e a clínica com lembretes ativos.

## Provisionar o primeiro administrador da plataforma

O comando PHP de provisionamento exige confirmação explícita. Defina `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME` e `PLATFORM_ADMIN_PASSWORD` no ambiente do processo; a senha deve ter ao menos 12 caracteres e no máximo 72 bytes em UTF-8. Então execute:

```powershell
$env:PLATFORM_ADMIN_PROVISIONING_CONFIRM = 'CREATE_PLATFORM_ADMIN'
php .\php-backend\bin\provision-platform-admin.php
Remove-Item Env:\PLATFORM_ADMIN_PROVISIONING_CONFIRM
```

## Compatibilidade e segurança

Rotas desconhecidas respondem `404`. A validação integrada não substitui a configuração e a homologação da infraestrutura de produção descritas no runbook.
