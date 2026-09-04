# Calendário: filtrar sem sair do calendário + datas para as peças antigas

## Problema

1. Ao escolher o filtro "Rascunhos", a tela troca automaticamente para lista — você perde a visão de mês.
2. Peças sem data (rascunhos) não têm onde aparecer numa grade de calendário.
3. As 119 pautas e 181 peças já existentes foram criadas antes da agenda inteligente: nenhuma tem dia/hora sugeridos, então nada aparece no calendário mesmo com o filtro certo.

## O que muda

### 1. Filtros nunca trocam a visão

O filtro "Rascunhos" (e qualquer outro) passa a apenas filtrar. Mês continua mês, semana continua semana, lista só quando você escolher lista. Peças com data (sugerida, reservada, agendada ou publicada) aparecem como chips nos dias.

### 2. Faixa "Sem data" dentro do calendário

Abaixo do cabeçalho da grade aparece uma faixa horizontal com as peças do filtro atual que ainda não têm data (ex.: "Sem data ainda — 42"), com rolagem lateral.

- Selecionar uma peça na faixa e clicar num dia do calendário define a data proposta (horário padrão sugerido pelo melhor horário do cliente, editável).
- A peça sai da faixa e passa a aparecer no dia, como "Agenda sugerida", entrando no fluxo já existente: aprovação interna → confirmação do cliente → data reservada.
- Nada é publicado nem agendado na fila real.

### 3. Sugerir datas em massa para o que já existe

Ação "Sugerir datas com IA" que roda uma vez para as peças do cliente que estão sem data, usando a mesma lógica das pautas novas: persona/briefing + histórico real de publicação do cliente, dias e horários no fuso de Brasília, sem colisões de horário no mesmo dia.

- Só toca em peças sem data e não publicadas; peças já datadas ficam intactas.
- Resultado entra como "Agenda sugerida", ou seja, você revisa, edita e aprova antes de qualquer confirmação com o cliente.
- Confirmação antes de executar, com o número exato de peças afetadas, e resumo depois ("X peças receberam data sugerida").

## Detalhes técnicos

- `src/routes/_authenticated/calendar.tsx`: remover o `if (v === "drafts") setView("list")`; incluir no `filtered`/`byDay` os itens com `proposedAt`; derivar a lista `undated` (itens do filtro atual sem `when`/`proposedAt` + rascunhos) e renderizar a nova faixa; estado de "peça selecionada para datar" consumido pelo `onNewOnDay` de `MonthView`/`WeekView`.
- Nova faixa: `src/components/calendar/board/undated-tray.tsx` (apresentação + seleção), gravando via `updateScheduleSlotFn` já existente (`proposed_at` + `schedule_status: "proposed"`).
- Sugestão em massa: nova server function `suggestSchedulesForClientFn` em `src/lib/schedule-approval.functions.ts`, com núcleo em `src/lib/schedule-approval.server.ts` reutilizando `resolveMonthlySchedule` (`monthly-plan-schedule.server.ts`) e `loadBestTimesContext` (`client-best-times.server.ts`); escopo `brandId`/`clientId` e RBAC pelo `requireSupabaseAuth` atual. Sem migration: as colunas `proposed_at`/`schedule_status` já existem.
- Peças antigas com `monthly_plan_topic_id` também recebem `suggested_at` no tópico, para a pauta refletir a mesma data.
- Testes: unitário da derivação `undated`/`byDay` com o filtro de rascunhos e da distribuição de slots em massa (sem colisão, sem datas passadas, não sobrescreve datas existentes).
- Sem mudanças de RLS, RBAC, portal ou fluxo de publicação; `ScheduleWizard` intocado.
