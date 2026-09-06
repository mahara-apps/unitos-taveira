# Comunicador interno: Mensagens (equipe, clientes e portal)

Um espaço de conversa de verdade, com histórico completo, separado do assistente de IA (que continua em Chat). Nada de cruzamento: cada conversa pertence a um workspace e, quando é de cliente, só quem tem acesso àquele cliente entra.

## O que você vai ver

**1. Nova área "Mensagens" no menu**
- Duas abas: **Clientes** e **Equipe**.
- Contador no menu com o total de mensagens não lidas suas, atualizado em tempo real.
- O item Chat (assistente de IA) continua exatamente como está.

**2. Aba Clientes — uma tela por cliente**
- Lista de clientes à esquerda, com prévia da última mensagem, autor, data e não lidas.
- Ao abrir um cliente: todas as conversas dele, por assunto (ex.: "Campanha de setembro", "Financeiro"), cada uma com histórico próprio e prévia da última mensagem.
- Botão para abrir um novo assunto, escolher quais contatos do cliente participam e quem da equipe acompanha.
- Menções com @ usando os nomes reais já padronizados no sistema; quem é mencionado recebe notificação que abre direto na conversa.
- Links de referência (Drive etc.) nas mensagens, como já fazemos nos pedidos — sem anexo novo, para não pesar o banco.

**3. Aba Chat dentro do portal do cliente**
- Novo item "Mensagens" na área do cliente, com o mesmo visual do portal.
- O cliente vê só os assuntos em que foi incluído, do próprio cliente dele, e nunca conversas internas.
- Respostas aparecem na hora, sem recarregar e sem depender do painel; quem está no painel também vê chegar na hora.
- Novo controle nas permissões do portal: "Mensagens" em Nenhum / Somente ver / Ver e responder.
- Avisos por e-mail quando o cliente recebe mensagem e está fora do portal (mesma régua dos avisos atuais).

**4. Aba Equipe**
- Conversa direta entre duas pessoas e conversa por projeto/cliente (interna, invisível ao cliente).
- Painel lateral da pessoa selecionada: em quais clientes e tarefas ela atuou no período, com atalho para cada item.
- Bloco "Tempo registrado" com as horas dela no período, vindas do mesmo relatório de Timesheet, e link "Ver no Timesheet" já com os filtros aplicados (pessoa + período).
- No relatório de Timesheet, cada pessoa ganha atalho "Abrir conversa".

## Regras de acesso

- Conversa de cliente: só entra quem já pode ver aquele cliente. Dono e Administrador cobrem o workspace; Gerente e Usuário só clientes atribuídos.
- Conversa interna de equipe/projeto: nunca visível a cliente do portal, em nenhuma rota.
- Cliente do portal: só o próprio cliente, só assuntos em que foi incluído, e só responde se a permissão permitir.
- Mensagem enviada não é editada nem apagada: histórico completo preservado. Autor pode marcar como "removida" (o registro permanece para auditoria).

## Detalhes técnicos

Banco (migration nova):
- `message_threads`: `brand_id`, `scope` (`client` | `team_dm` | `project`), `client_id`, `project_id`, `subject`, `created_by`, `visibility` (`internal` | `shared_with_client`), `last_message_at`, `archived_at`.
- `message_thread_participants`: `thread_id`, `user_id`, `role_in_thread` (`team` | `portal_client`), `last_read_at`, `notify`.
- `messages`: `thread_id`, `author_id`, `body`, `links` JSONB `[]`, `mentions` UUID[], `removed_at`, `created_at`.
- GRANTs para `authenticated`/`service_role`, RLS habilitada, políticas via funções `SECURITY DEFINER` (`can_access_message_thread`) que reaproveitam `can_access_client` / `is_portal_client_of` — sem recursão e fail-closed. Índices por `thread_id, created_at` e `brand_id, last_message_at`.
- `ALTER PUBLICATION supabase_realtime ADD TABLE public.messages, public.message_threads` para o tempo real, com RLS mantida.
- Novo valor `message` no enum `notification_kind`.
- Cron de limpeza não se aplica: histórico é permanente por decisão do produto.

Código:
- `src/lib/messaging.ts` (puro: agrupamento, prévia, não lidas, ordenação) e `src/lib/messaging.functions.ts` (`listThreadsFn`, `listMessagesFn`, `sendMessageFn`, `createThreadFn`, `markThreadReadFn`, `countUnreadFn`) com `requireSupabaseAuth`, `resolveModulePermissions` e escopo por cliente.
- `src/lib/messaging-portal.functions.ts` para o portal, validando `portal-scope.server.ts` + nova permissão `messages`.
- Realtime em `useEffect` com `supabase.removeChannel` na limpeza, um canal por conversa.
- Rotas: `src/routes/_authenticated/messages.tsx` (+ `messages.index.tsx`, `messages.$threadId.tsx`, `messages.team.tsx`) e `src/routes/_portal/area.mensagens.tsx`.
- Menu: novo módulo `messages` em `module-permissions.ts` e `permissions.ts`, badge `messages-unread` em `app-sidebar.tsx`.
- Deep-link: `notification-target.ts` passa a resolver `message` para a conversa (equipe) ou `/area/mensagens` (portal).
- Timesheet: reuso de `getTimesheetReportFn` no painel da pessoa, sem duplicar cálculo.
- KPIs da tela de equipe via `PageKpi`/`PageKpiGrid`.
- Testes: escopo/isolamento (cliente A não vê cliente B, portal não vê interno), não lidas, agrupamento por assunto, deep-link de notificação, permissões do portal.
- Propagação: regenerar o snapshot de deltas e subir `MASTER_RELEASE_VERSION` para `1.1.0`.
