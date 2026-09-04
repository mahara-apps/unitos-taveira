# Pauta aprovada internamente vira Projeto ativo

Quando o time interno aprova uma pauta (o momento em que ela sai de "Rascunho" e segue para o cliente), o sistema cria automaticamente um **projeto ativo** vinculado àquela pauta. O projeto passa a exibir o **mesmo badge de status da pauta** (Rascunho, No cliente, Ajustes pedidos, Cliente aprovou, Em produção, etc.), tanto na lista de projetos quanto na tela do projeto.

## Comportamento

- Aprovação interna da pauta:
  - cria um projeto com status **Ativo**, nome baseado no título da pauta (ex. "Pauta — Setembro/2026"), cliente da pauta, responsável = quem aprovou, e datas de início/fim conforme o mês da pauta quando disponível.
  - é idempotente: se aquela pauta já tem projeto, nada é duplicado — apenas reaproveita o existente.
- O projeto guarda o vínculo com a pauta, permitindo:
  - mostrar o badge de status da pauta ao lado do status do projeto;
  - um link "Ver pauta" no cabeçalho do projeto.
- O badge da pauta é apenas informativo (reflete o estado atual da pauta). O status do projeto continua editável normalmente.
- Nenhuma alteração no fluxo de materialização em cards do Kanban (que continua na aprovação do cliente / envio para produção).

## Onde aparece

- **Lista de projetos**: cada card com pauta vinculada ganha o badge da pauta ao lado do badge de status do projeto.
- **Detalhe do projeto**: badge da pauta no cabeçalho, com link para a pauta.

## Detalhes técnicos

1. **Migração**: adicionar `monthly_plan_id uuid` (nullable, FK → `monthly_plans(id)` ON DELETE SET NULL) em `public.projects`, com índice único parcial para garantir um projeto por pauta.
2. **Backend**:
   - `src/lib/monthly-plans.functions.ts` → em `submitPlanToClientFn`, após marcar `status = pending_client`, criar o projeto (upsert por `monthly_plan_id`) usando os dados da pauta.
   - `src/lib/projects.functions.ts` → `listProjects` e `getProject` passam a selecionar `monthly_plan_id` e fazer join leve em `monthly_plans (id, title, status)` para devolver `plan: { id, title, status } | null`.
3. **Frontend**:
   - Extrair `PLAN_STATUS_META` de `src/components/monthly-plan/monthly-plan-view.tsx` para um módulo compartilhado (`src/lib/monthly-plan-status.ts`) e criar `PlanStatusBadge` reutilizável, sem mudar o visual atual da pauta.
   - Usar esse badge em `projects.index.tsx` (card) e `projects.$projectId.tsx` (cabeçalho + link `/monthly-plan?planId=...`).
4. Sem mudanças em RLS: `projects` já é filtrado por marca/membro; o join respeita as políticas existentes de `monthly_plans`.
