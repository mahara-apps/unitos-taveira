# Clicar no aviso abre exatamente o item

Hoje muitos avisos não levam a lugar útil: alguns abrem uma tela genérica (lista de conteúdo), outros usam endereços antigos que o sistema não reconhece mais e simplesmente não fazem nada. A ideia é: todo aviso, ao ser clicado, abre a tela certa **já com o item aberto** — post, tarefa, pauta, briefing, pedido do cliente, agenda — e no cliente correto.

## O que está errado hoje (verificado)

- Avisos de SLA vencido (a maior parte do volume: 445 + 63 registros) apontam só para `/content`, sem abrir o post atrasado — embora o post esteja guardado no aviso.
- Avisos de prazo apontam para `/customers/<cliente>?post=<id>`; a ficha do cliente não entende `post`, então nada abre.
- Avisos de tarefa usam `/tasks?task=<id>`, mas a tela de tarefas espera `taskId` — a tarefa não abre.
- Avisos de pauta liberada apontam para `/content/plans/<id>`, um endereço que não existe.
- Alguns avisos não têm destino nenhum (41 registros do tipo "sistema") e o clique não faz nada.
- O clique monta o link como texto puro, então qualquer endereço com `?` não é interpretado corretamente pelo sistema de navegação.
- Ao abrir um aviso de outro cliente, o cliente ativo não muda, então a tela pode mostrar o contexto errado.

## O que vamos fazer

1. **Um tradutor único de destino de aviso.** Um lugar só decide, para cada aviso, qual tela abrir e qual item destacar. Ele usa primeiro os dados guardados no aviso (post, tarefa, pauta, cliente, pedido) e só depois o endereço salvo — e conserta endereços antigos automaticamente. Assim os 500+ avisos já existentes passam a funcionar sem precisar reescrever o banco.
2. **Aplicar esse tradutor nos três lugares onde o aviso é clicado:** o sininho, a tela de histórico de notificações e a área do cliente.
3. **Garantir que a tela de destino realmente abra o item:**
   - post → tela de Conteúdo com o post aberto;
   - tarefa → tela de Tarefas com a tarefa aberta;
   - pauta → tela da pauta do cliente (item destacado quando houver);
   - briefing → aba de Briefing do cliente;
   - pedido/comentário do cliente → Área do cliente com a conversa aberta;
   - agenda/aprovação → Calendário no período certo.
4. **Trocar o cliente ativo automaticamente** quando o aviso é de outro cliente, antes de abrir a tela.
5. **Nunca deixar um aviso "morto":** quando não há item específico, o clique abre a tela mais próxima daquele assunto em vez de não fazer nada.
6. **Padronizar os novos avisos** para já nascerem com destino completo (item + cliente), em todos os pontos que criam avisos: SLA, prazos, menções, aprovações, pauta, briefing, pedidos do cliente, limites de plano, integrações.
7. **Marcar como lido ao abrir**, mantendo o comportamento atual.

## Detalhes técnicos

- Novo `src/lib/notification-target.ts`: `resolveNotificationTarget(n)` → `{ to, params, search }` tipado para TanStack Router, derivado de `kind` + `payload` + `href` legado; tabela de reescrita para `/content` (com `post_id`), `/customers/:id?post=`, `/tasks?task=`, `/content/plans/:id`, `?tab=` legados.
- Substituir `<Link to={n.href}>` por `<Link {...target}>` em `src/components/notifications/notifications-drawer.tsx`, `src/routes/_authenticated/notifications.tsx` e `src/components/portal/portal-notifications.tsx` (variante de portal restrita a rotas `/area/*`).
- Adicionar `post` (uuid) ao `validateSearch` da ficha do cliente ou redirecionar `?post=` para `/content?post=`; aceitar `task` como alias de `taskId` em `src/components/tasks/task-views.ts`; aceitar destaque de item na pauta.
- Trocar cliente ativo via `useActiveContext()` no handler de clique quando `payload.client_id` difere do ativo, antes de navegar.
- Atualizar produtores para gravar `payload` completo e `href` canônico: `sla-check.ts`, `enqueue_deadline_notifications`, `mention-notify.server.ts`, `monthly-plan-decision-notify.server.ts`, `schedule-notify.server.ts`, `client-comms.server.ts`, `plan-overage-notify.server.ts`, `briefing-tokens.functions.ts`, `ai-model-health.server.ts`, `monthly-plan-public.functions.ts`.
- Testes: `tests/notification-target.unit.test.ts` cobrindo cada `kind`, hrefs legados, ausência de payload e restrição do portal. Rodar typecheck + build.
- Sem alteração de RBAC/RLS: o destino é apenas navegação; as telas continuam validando permissão e escopo.
- Regenerar deltas e subir a versão de release para propagar às instalações derivadas.
