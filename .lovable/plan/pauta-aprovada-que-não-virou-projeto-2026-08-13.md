# Pauta aprovada que não virou projeto

## Diagnóstico (confirmado no banco)

A pauta "Mês dos Pais Café Aurora" está com `status = pending_client` e aprovação interna registrada em 13/08 às 11:23, mas `project_id` está vazio e não existe nenhum projeto com `monthly_plan_id` apontando para ela.

Motivo: a criação automática do projeto (`ensurePlanProject`) só passou a rodar na aprovação interna depois dessa aprovação. Pautas aprovadas antes disso ficaram sem projeto e nada no sistema hoje as reconcilia — a criação só acontece no momento do envio ao cliente.

## O que fazer

1. **Backfill** das pautas já aprovadas internamente sem projeto (hoje: 1 registro) — cria o projeto ativo vinculado, com nome "Pauta — <título>", período do mês corrente, e grava `project_id` na pauta.
2. **Auto-cura**: ao abrir a tela da pauta, se ela já tem aprovação interna (`internal_approved_at` preenchido, status `pending_client`/`approved`) e não tem projeto vinculado, o projeto é criado/vinculado na hora (mesma função idempotente já existente).
3. **Ação manual de segurança**: no cabeçalho da pauta, quando aprovada internamente, mostrar "Ver projeto" quando existir e "Criar projeto" quando não existir, para o gestor resolver sem depender de reenvio ao cliente.

## Detalhes técnicos

- Migração de backfill: `INSERT` em `public.projects` a partir de `monthly_plans` com `internal_approved_at IS NOT NULL`, `project_id IS NULL` e sem projeto existente; em seguida `UPDATE monthly_plans.project_id`. Nomeação, status (`active`), cor e datas iguais aos de `ensurePlanProject`.
- Reuso de `ensurePlanProject` em `src/lib/monthly-plan-project.server.ts` (já idempotente) em uma nova server fn `ensurePlanProjectFn` em `src/lib/monthly-plans.functions.ts`, protegida por `requireSupabaseAuth`, chamada pela view da pauta quando detecta a inconsistência e pelo botão manual.
- `getMonthlyPlanFn` passa a retornar `project_id` para a UI decidir entre "Ver projeto" / "Criar projeto".
- Nenhuma mudança nas regras de aprovação, volumetria ou geração de conteúdo.
