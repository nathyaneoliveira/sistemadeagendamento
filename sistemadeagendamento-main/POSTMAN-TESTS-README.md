# Testes da API com Postman

Os arquivos `Sistema-de-Agendamentos.postman_collection.json` e `Sistema-de-Agendamentos.postman_environment.json` contêm requests preparados a partir das rotas existentes no backend. **Nenhuma requisição desta coleção foi executada como parte da criação destes arquivos.**

## Importar coleção e ambiente

1. Abra o Postman e use **Import** para selecionar a coleção JSON e o ambiente JSON.
2. Selecione o ambiente **Sistema de Agendamentos - Local de teste** no seletor de ambientes.
3. Confirme `baseUrl`. O valor inicial é `http://127.0.0.1:4000/api`; ele apenas identifica o destino local esperado, não indica que a API esteja em execução.

## Preparar um destino local

Consulte o `README.md` da raiz antes de iniciar dependências. Ele documenta a instalação, configuração local e execução do backend. O backend é iniciado pela raiz com:

```bash
npm run dev:backend
```

O servidor exige configuração explícita de `NODE_ENV` e `JWT_SECRET` e acesso a um PostgreSQL adequadamente configurado. A coleção não cria nem configura banco, não executa migrations e não inicia serviços. Use apenas um banco de desenvolvimento/teste cujo destino tenha sido confirmado. Não use produção.

Antes de enviar requests, confirme a URL e o ambiente selecionado. O endereço local padrão não é um mecanismo de proteção se você substituir a variável por outro host.

## Login e tokens

1. Informe `loginEmail` e `loginPassword` localmente no ambiente importado. Não salve ou compartilhe o environment exportado com credenciais.
2. Execute **Autenticação clínica → Login clínico**. Quando a API retornar token em `data.token`, o script de teste o guarda em `token` e `tokenClinicA`.
3. Se o fluxo de login retornar seleção assinada de clínica, informe `clinicSelectionToken` e `clinicId` e execute **Selecionar clínica no login**; token retornado é salvo do mesmo modo.
4. Para testar Clinic B, autentique outra conta pertencente a essa clínica e preencha `tokenClinicB` manualmente. Não reutilize token de Clinic A.
   Alternativamente, informe `clinicBLoginEmail` e `clinicBLoginPassword` e execute **Login Clinic B**; o script grava o token separado sem substituir a sessão de Clinic A.
5. Para o teste de autorização por papel, autentique um usuário de papel paciente e informe seu token em `tokenPatient`.
6. O token administrativo global é separado: execute **Administração global → Login administrativo global** com credenciais sintéticas locais. Ele é guardado em `platformToken` e não substitui token clínico.

Tokens e senhas não estão predefinidos nos arquivos distribuídos. Os campos de segredo do environment ficam vazios.

## Ordem recomendada

Execute requests individuais, de preferência em banco descartável ou ambiente de teste confirmado:

1. **Saúde:** `Health - liveness` não consulta o banco; readiness consulta PostgreSQL.
2. **Autenticação clínica:** login, sessão atual; teste de ausência de token; logout somente ao final do uso do token.
3. **Clínica e assinatura:** consulte clínica, usuários e assinatura para confirmar papel/plano e permissões.
4. **Configurações e especialidades:** liste dados; se autorizado e necessário, crie uma especialidade sintética para preencher `specialtyId`. A atualização de configurações e criação de especialidade são escritas.
5. **Pacientes, profissionais e serviços:** use os requests de criação apenas em ambiente de teste autorizado. Scripts guardam os IDs de sucesso para requests seguintes.
6. **Agenda e agendamentos:** cadastre horário de trabalho sintético, confira disponibilidade e use horários livres reservados exclusivamente para o teste. Crie primeiro um agendamento; em seguida teste o conflito repetindo exatamente o horário, reagende e cancele quando apropriado.
7. **Pagamentos e auditoria:** pagamentos são registros internos; esta API não realiza cobrança por esses endpoints. Use apenas valor sintético e agendamento de teste.
8. **Reserva pública:** requer slug, serviço, profissional, agenda e plano público válidos. O teste negativo tem payload inválido e não cria agendamento.
9. **Isolamento:** autentique duas clínicas distintas, preserve o ID de um registro da Clinic A e tente consultá-lo com `tokenClinicB`. O request está preparado para conferir 404.
10. **Administração global:** use somente conta global de teste e token administrativo. Faça logout ao terminar.

Requests marcados como **(escrita)** criam ou alteram dados. Não execute a coleção inteira indiscriminadamente: o Postman Runner repete requests e registros com nomes/dados estáticos podem gerar duplicidades ou afetar limites do plano. Revise cada request e selecione apenas os necessários.

## Como interpretar os resultados

Cada request possui scripts que verificam o código HTTP e a forma geral do JSON. Alguns aceitam 400, 403, 404 ou 409 como resultado válido quando o request depende de permissões, dados cadastrados, plano, conflito ou referência existente. Leia a resposta individual para distinguir o comportamento esperado de um cenário não preparado. Um script aprovado não comprova que a operação de negócio foi bem-sucedida se o status representa um pré-requisito ausente.

O Postman mostra os resultados na aba **Test Results**. Requests não enviados não têm resultado; preparar a coleção não equivale a executar ou aprovar os testes.

## Dependências de PostgreSQL e dados prévios

- `/health/ready`, login, sessão, logout e endpoints protegidos dependem da configuração operacional do backend; muitos também consultam ou alteram o PostgreSQL.
- Criação/consulta de pacientes, especialidades, profissionais, serviços, agenda, agendamentos, configurações, pagamentos e auditoria dependem de PostgreSQL, assinatura ativa e permissões conforme o endpoint.
- Agendamentos exigem paciente, profissional ativo, serviço associado, especialidade compatível quando aplicável, horário de trabalho e intervalo ISO coerente. Use `testDate`, `scheduledStart`, `scheduledEnd`, `rescheduledStart` e `rescheduledEnd` compatíveis com o fuso e com a disponibilidade.
- O teste de conflito requer um agendamento anterior ativo para o mesmo profissional e intervalo. Reagendamento e cancelamento precisam de `appointmentId` criado/preparado.
- Registros de pagamento requerem agendamento existente e capability do plano.
- A reserva pública precisa de slug público, clínica ativa, plano elegível, serviço/profissional associados e slots disponíveis.
- As duas clínicas do teste de isolamento, contas/roles, assinatura e dados das referências devem ser previamente provisionados de forma autorizada. Este conjunto não executa migrations/seeds nem provisiona dados.
- A coleção contém cenários de duas clínicas e requests de conflito, mas **não contém teste concorrente simultâneo**: o Postman sequencial não comprova a proteção para duas requisições concorrentes. Isso requer teste de integração dedicado contra PostgreSQL isolado.

## Evitar escrita em produção

Esta coleção inclui requests `POST` e `PATCH` que criam ou alteram dados. Antes de enviar qualquer um:

- confira visualmente o environment ativo e `baseUrl`;
- mantenha o destino em loopback/desenvolvimento ou use ambiente de teste descartável confirmado;
- não configure URL de produção, staging compartilhado, nem host desconhecido;
- não exporte/compartilhe ambiente preenchido com tokens, senhas ou dados pessoais;
- não use dados reais de pacientes, profissionais ou clínicas.

Não há requests de exclusão, migration, seed, cobrança ou deploy nesta coleção.
