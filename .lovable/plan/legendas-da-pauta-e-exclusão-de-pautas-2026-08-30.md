# Legendas da pauta e exclusão de pautas

## Como funciona hoje o fluxo de legendas (nada a mudar)

Depois que a pauta é aprovada pelo cliente (link do portal) ou enviada para produção internamente:

1. Cada item aprovado da pauta vira uma **peça (card) no Kanban de Conteúdo**, dentro do projeto escolhido na criação da pauta.
2. Para cada peça também é criada uma **tarefa "Produzir: ..."** no projeto.
3. A **legenda é gerada automaticamente** logo em seguida, em segundo plano, pelos agentes de IA (roteiro, direção visual e copy/legenda). Isso é idempotente: peça que já tem legenda nunca é regravada, e peças que ficaram sem legenda são completadas na próxima execução.

Onde você vê e controla:

- **Conteúdo (Kanban)** → abrir a peça: legenda, roteiro, direção visual, referências e agendamento.
- Na peça existem as ações de **regerar conteúdo** (roda os agentes de novo) e **retrabalhar com instrução** (você diz o ajuste desejado).
- A legenda é sempre editável à mão; a IA nunca publica nada — a peça segue o fluxo do Kanban até aprovação.
- Se a geração falhar (provider fora, quota), a peça continua no Kanban sem legenda e pode ser regerada; há também a retomada de peças pendentes.

Resumo: criação da peça e primeira legenda são automáticas; revisão, ajuste, aprovação e agendamento são manuais.

## O que falta: excluir pauta

Hoje só existe **arquivar / restaurar** (a pauta sai da lista ativa, mas continua no banco). Não há exclusão definitiva.

### Regras aprovadas

- Podem excluir: **Owner, Admin e Super Admin** do workspace. Manager e User continuam apenas arquivando.
- Se a pauta **já tem peças de conteúdo geradas** (posts vinculados aos itens), a exclusão é **bloqueada** com mensagem clara indicando arquivar em vez de excluir.
- Pauta aprovada sem peças materializadas pode ser excluída.
- Exclusão sempre com **confirmação explícita** (digitar/confirmar), avisando que é irreversível.

### O que é apagado

Ao excluir: os itens da pauta (`monthly_plan_topics`), os tokens de aprovação do cliente da pauta e a própria pauta. O **projeto vinculado não é apagado** — apenas o vínculo com a pauta é desfeito, para não destruir tarefas e histórico do projeto.

## Detalhes técnicos

- Nova server fn `deleteMonthlyPlanFn` em `src/lib/monthly-plans.functions.ts`:
  - valida escopo (`brand_id`/`client_id`) da pauta;
  - autoridade via `app_access_role` (aceita `admin` e `super_admin`), reusando o padrão já usado em `plan-overage.server.ts`;
  - conta posts com `monthly_plan_topic_id` nos itens da pauta → se > 0, lança `plan_has_content`;
  - limpa `projects.monthly_plan_id` (FK sem cascade) da pauta;
  - deleta a pauta; `monthly_plan_topics` e `monthly_plan_tokens` caem por cascade já existente no banco.
- UI em `src/components/monthly-plan/pauta-board.tsx`: item "Excluir definitivamente" no menu, visível só para quem tem autoridade, com `AlertDialog` de confirmação e invalidação das queries `plan-board` / `monthly-plans`. Mesma ação no cabeçalho de `monthly-plan-view.tsx`.
- Mensagens de erro traduzidas: `plan_has_content` → "Esta pauta já gerou peças de conteúdo. Arquive-a para preservar o histórico."; `forbidden` → aviso de permissão.
- Teste unitário novo cobrindo: bloqueio por peças existentes, bloqueio por papel (manager/user), sucesso para admin, desvínculo do projeto.
- Sem migration, sem mudança em RBAC/RLS/auth, tenants/workspaces ou instalação.
