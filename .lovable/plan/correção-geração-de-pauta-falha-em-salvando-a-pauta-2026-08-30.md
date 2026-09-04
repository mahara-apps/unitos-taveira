# Correção — geração de pauta falha em "Salvando a pauta"

## O que os dados mostram (verificado agora)

Consultei os jobs e a telemetria reais dos últimos 30 minutos:

- Os 4 últimos jobs (`03:36`, `03:37`, `03:41`, `03:43`) falharam todos com `step_label = "Salvando a pauta"` e `error = "[object Object]"`.
- A etapa de IA teve sucesso em todas elas (`plan_step_ok`, `gemini/gemini-flash-latest#1:success`) — o problema **não é mais o provedor**. As falhas por cota 429 do Gemini são anteriores (`03:28`).
- Nenhuma linha nova em `monthly_plans` nem em `monthly_plan_topics` (0 e 0). Ou seja: a escrita no banco falha e nada parcial é salvo.
- A causa exata da escrita **ainda não está confirmada**, e o motivo é justamente o `[object Object]`: erros do PostgREST não são `Error`, são objeto simples, e o código atual os converte com `String(err)`, destruindo a mensagem antes de gravar no job, na notificação e no toast.

Descartei por consulta direta: constraints de `status`/`content_format`, colunas gravadas (todas existem), FKs, grants de tabela, triggers (só `updated_at` em UPDATE) e as policies de INSERT (`can_access_client` + `is_agency_operator`, com EXECUTE concedido a `authenticated`).

## Plano

### 1. Tornar o erro real visível (pré-requisito, já iniciado)
- `src/lib/error-message.ts` (novo): extrai `message`/`code`/`details`/`hint` de erros PostgREST, `Error`, string e `cause`. Nunca produz `[object Object]`.
- `src/lib/errors.ts`: `describeError` passa a usar esse extrator.
- `src/lib/monthly-plans.functions.ts`: o job grava a mensagem serializada, não `String(err)`.
- `src/lib/monthly-plan-generate.server.ts`: cada escrita (`monthly_plans.insert`, `monthly_plans.update`, `monthly_plan_topics.insert`) registra a falha em `activity_events` com o ponto exato e a mensagem do Postgres antes de propagar.
- `src/components/ai-jobs/ai-jobs-provider.tsx`: o toast do job passa por `describeError`, em vez de imprimir `job.error` cru.

### 2. Reproduzir e confirmar a causa
Rodar uma geração real autenticada no preview com o código acima e ler o evento `plan_step_failed` gravado. A partir da mensagem verdadeira do Postgres, corrigir a causa (payload, escopo ou policy) — sem `catch` genérico e sem mascarar.

### 3. Correção da causa raiz
Aplicar o ajuste mínimo indicado pela mensagem, mantendo a regra de nunca salvar pauta parcial e a retomada por checkpoint. Se for RLS/escopo, corrijo o caminho de chamada — não afrouxo policy.

### 4. Mensagens honestas na UI
- Falha de escrita: "Não foi possível salvar a pauta" com o detalhe técnico curto, em vez de "Ocorreu um erro inesperado".
- Falha de cota do provedor continua distinta, com ação "Abrir Conexões".

### 5. Pendências já mapeadas que entram nesta rodada
- Cohorts/personas em inglês: ligar `assertPtBrPayload` ao pipeline `customer-pipeline.ts` e retentar uma vez quando a saída vier predominantemente em inglês.
- "Barreira principal" vazia em Personas & Público IA: usar `objecoes_comuns[0]`/`dores[0]` como fallback no card.

### 6. Fuso horário oficial (Brasília, GMT-3)
- `src/lib/timezone.ts` (novo) com `APP_TIMEZONE = "America/Sao_Paulo"` e helpers de fronteira de dia/mês via `Intl.DateTimeFormat`.
- `src/lib/date-range.ts` e `plan-overage.server.ts` (mês corrente) passam a usar essas fronteiras; armazenamento continua em UTC/`timestamptz`.

## Fora de escopo
Sem alterações em RBAC/RLS, autenticação, tenants/workspaces, Instalação × Workspace, migrations históricas ou provedores de IA (nada de Cloud AI/Gateway).

## Validação
Geração real de pauta autenticada, testes, typecheck e build.
