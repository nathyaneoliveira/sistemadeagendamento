# Privacidade e LGPD: situação técnica do sistema

Este documento descreve o que foi encontrado no código e o que ainda precisa ser definido e operado por cada clínica e pela equipe responsável pela plataforma. Não é parecer jurídico, declaração de conformidade nem substitui a avaliação de um profissional qualificado.

## Dados identificados no repositório

- **Clínicas:** nome, nome fantasia, CNPJ, telefone, WhatsApp, e-mail e endereço.
- **Contas:** nome, e-mail, telefone, senha armazenada como hash, perfil, situação e último acesso.
- **Pacientes:** nome, CPF, data de nascimento, telefone, e-mail e vínculo opcional a uma conta.
- **Agendamentos:** paciente, profissional, serviço, horários, estado, código, observações e snapshots de serviço.
- **Operação:** lista de espera com dados de contato, preferências e data de consentimento; lembretes com canal, estado, tentativas e erro; tokens temporários de recuperação e de acesso ao portal; registros de auditoria.
- **Profissionais e serviços:** nome, CRM, contatos, especialidade, dados de serviço e agenda.

As estruturas e os campos de referência estão em `database/schema.sql`. Os dados dos pacientes e dos agendamentos podem revelar informações relacionadas à saúde pelo contexto de uso, mesmo quando não há um campo separado de diagnóstico.

## Controles técnicos encontrados ou implementados

- A API restringe consultas e relações ao identificador da clínica e usa consultas parametrizadas.
- O segredo clínico de sessão é emitido em cookie `HttpOnly`, com `SameSite` configurável e `Secure` em produção; o endpoint de login não devolve esse segredo no JSON.
- Requisições de escrita autenticadas por cookie exigem token CSRF correspondente e `Origin` igual à origem configurada. O frontend obtém o token por `/api/auth/csrf`.
- O token do portal do paciente é enviado em fragmento (`#token=...`) no link novo e no corpo das solicitações de consulta/cancelamento, sem compor o caminho da API. Links antigos com token na query ou caminho continuam aceitos durante a validade original de 24 horas; a query é removida da barra de endereço ao abrir o frontend. A política `no-referrer` evita repassar essa URL como Referer.
- A sessão separada de administração global continua usando bearer token mantido no estado da aplicação; ela não foi migrada para cookie nesta alteração.
- O administrador da clínica pode configurar nome empresarial, CNPJ, e-mail de privacidade e URL HTTPS do aviso. No endpoint público de agendamento é exposto somente o link ao aviso, quando configurado; os demais campos não são incluídos nesse payload. O sistema não redige nem valida juridicamente o aviso.
- Tokens de recuperação e de acesso ao portal são armazenados como hashes; o código também limita sua validade e oferece revogação/uso único conforme o fluxo.
- CORS, TLS PostgreSQL, cabeçalhos, segregação por clínica e rate limits estão parcialmente implementados. A configuração real e o comportamento na hospedagem ainda precisam ser validados.

Esses controles reduzem riscos técnicos específicos, mas não determinam finalidade, base legal, transparência, retenção ou conformidade global.

## Retenção e descarte: o que o código demonstra

- Tokens de recuperação têm validade de 30 minutos; tokens do portal têm validade de 24 horas. Expirar ou revogar um token impede seu uso, mas não significa que o respectivo registro foi apagado do banco.
- Não foi encontrada uma política geral automatizada de retenção e descarte para pacientes, agendamentos, observações, fila de espera, auditoria ou backups.
- Agendamentos referenciam pacientes com restrição de exclusão; a exclusão de uma clínica no modelo pode propagar a exclusão de dados relacionados. Não executar exclusões em lote nem aplicar um prazo de retenção presumido.
- Registros clínicos podem estar sujeitos a deveres específicos de conservação. A clínica deve definir e validar os prazos e as exceções aplicáveis antes de implementar descarte ou anonimização.
- O ciclo de retenção, criptografia e expurgo de backups depende do provedor e ainda não está comprovado pelo repositório.

## Lacunas que exigem decisão e operação

1. **Controlador e transparência por clínica:** há campos configuráveis por clínica para nome empresarial, CNPJ, e-mail de privacidade e URL HTTPS do aviso. O agendamento público mostra somente o link; cada clínica ainda precisa preencher os próprios dados, publicar e revisar o conteúdo do aviso. Os campos são opcionais e não representam validação da existência ou adequação jurídica das informações.
2. **Atendimento aos titulares:** definir o canal de contato e o processo para receber, validar e responder solicitações de acesso, correção, portabilidade, oposição e eliminação, respeitando as obrigações de conservação aplicáveis. Não foi identificado um fluxo completo de exportação/retificação/eliminação de titular.
3. **Finalidades e bases legais:** documentar por clínica e finalidade, incluindo agendamento, execução do serviço, comunicações, lembretes e lista de espera. A opção de consentimento para lembretes e a data de consentimento da lista de espera não substituem o aviso de privacidade nem decidem a base legal.
4. **Retenção:** aprovar uma tabela de prazos por categoria, eventos que iniciam a contagem, suspensões legais, backups e método de descarte/anonimização. Não presumir exclusão imediata de dados de saúde.
5. **Operadores e compartilhamento:** inventariar hospedagem, banco, e-mail, WhatsApp e pagamentos; definir contratos, regiões, acessos e responsabilidades com cada fornecedor.
6. **Incidentes e direitos de acesso:** estabelecer responsáveis, canal de incidente, triagem, registro, comunicação e revisão de acessos. O procedimento organizacional não é criado automaticamente pelo código.
7. **Hospedagem:** verificar HTTPS externo, cabeçalhos do host estático, logs sem dados sensíveis, backups criptografados e testados, acesso mínimo ao banco, monitoramento e rate limit compartilhado entre réplicas. Hoje os limitadores PHP são locais ao processo.
8. **Administração global:** revisar o acesso operacional da plataforma e definir controles organizacionais, segregação, justificativa e trilha de auditoria para suporte que possa acessar dados de clínicas.

## Próximos passos seguros

- Em bancos existentes, revisar o destino e aplicar a migration `017_clinic_privacy_profile.sql` somente quando ela ainda estiver pendente; migrations não são executadas automaticamente. O schema de instalação nova já contém a tabela `settings`.
- Cada clínica preenche os campos de privacidade em **Configurações** e valida o conteúdo do aviso antes de compartilhar o link no agendamento público. A URL configurada precisa usar HTTPS.
- Aprovar retenção e rotinas com responsáveis jurídicos e operacionais antes de automatizar qualquer exclusão.
- Escolher hospedagem e verificar os controles listados no `OPERATIONS-RUNBOOK.md` em um ambiente de homologação sem dados reais.
- Fazer revisão jurídica e testes independentes antes de afirmar conformidade ou prontidão para produção.
