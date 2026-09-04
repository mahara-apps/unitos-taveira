# Volumetria: escolher entre volume semanal ou mensal

Hoje a volumetria do briefing é sempre **por semana** (campo "Volume semanal por canal") e a cota mensal é derivada multiplicando pelas semanas reais do mês. A proposta é permitir que o gestor defina o volume direto em **mensal**, por cliente.

## Como vai funcionar

- No card "Volumetria & Metas" (Briefing) entra um seletor no topo: **Semanal** | **Mensal**.
  - **Semanal** (padrão, comportamento atual): valor por canal = posts/semana; a cota do mês = valor × semanas reais do mês (4 ou 5).
  - **Mensal**: valor por canal = posts/mês; é a cota do mês, sem multiplicação. O equivalente semanal aparece apenas como texto informativo (ex.: "16/mês ≈ 4/sem").
- Trocar de modo **não reescreve** os números digitados; mostra ao lado a conversão para o usuário conferir e ajustar.
- Onde a volumetria aparece hoje, o rótulo passa a refletir o modo escolhido:
  - Cards de volumetria da Pauta (`4/semana · 16/mês` → `16/mês` quando o modo é mensal)
  - Aba Produção (cotas por canal e totais)
  - Diálogo "Gerar Plano do Mês": no modo mensal o seletor de semanas (Auto/4/5) deixa de afetar a cota — a quantidade vem direto do valor mensal; o seletor continua servindo só para distribuir as peças no calendário.
- Enforcement de excedentes, autorizações e geração continuam usando a mesma `monthlyQuota`, agora calculada conforme o modo.

## Detalhes técnicos

- Novo campo em `clients.brand_hub`: `volumetry_basis: "weekly" | "monthly"` (default `"weekly"`), sem migração de schema (é jsonb). Adicionar ao Zod de `HubPatch` em `src/lib/brand-hub.functions.ts`.
- `src/lib/monthly-plan-fields.ts`: helper único `resolveQuota(weeklyOrMonthlyValue, basis, weeksInMonth)` retornando `{ perWeek, perMonth }`, usado por UI e servidor.
- `src/lib/monthly-plan-context.server.ts`: ler `volumetry_basis` do hub e derivar `weekly` / `monthlyQuota` pelo helper, em vez de sempre multiplicar por `weeksPerMonth`.
- `src/components/brand-hub/briefing-workspace.tsx`: seletor de modo + rótulo e hint dinâmicos no `VolumetriaTab`; máximo do stepper sobe no modo mensal (até ~60/mês).
- `src/components/monthly-plan/volumetry-cards.tsx`, `src/components/customer/production/*`, `src/components/customer/monthly-plan-dialog.tsx`: exibição e cálculo conforme o modo.
- `src/routes/api/jobs/generate-ideas.ts` e `src/routes/api/jobs/customer-pipeline.ts` leem a volumetria bruta — passam a usar o mesmo helper para não subestimar/superestimar.
- Aproveitando a passada: o Zod de `volumetry`/`formats` ainda não aceita os canais `x` e `threads` já suportados na UI — incluir para não perder esses valores ao salvar.
