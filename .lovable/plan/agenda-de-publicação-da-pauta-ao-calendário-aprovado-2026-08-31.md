# Agenda de publicação: da pauta ao calendário aprovado

## O problema real hoje

O sistema já faz tudo o que uma operação de social media precisa, mas a data/hora nasce fora do fluxo e isso multiplica trabalho manual:

- A pauta gera tema, canal, formato, ângulo e público — **nunca dia e hora**.
- Quando a pauta é aprovada, os cards de conteúdo são criados **sem data**. Eles não existem no calendário.
- Para cada peça, alguém precisa abrir o assistente de publicação e agendar uma por uma.
- O calendário só mostra o que já tem data; rascunhos ficam numa lista lateral separada.
- Não existe o conceito de "aprovar a agenda" — o que existe é aprovação de conteúdo (legenda/criativo).

Resultado: a agenda do mês é reconstruída à mão, item por item, todo mês.

## O que passa a existir

Um novo estágio explícito entre pauta e produção: **Agenda proposta → Agenda aprovada → Publicação agendada**.

```text
Pauta gerada (IA)            Agenda proposta            Agenda aprovada        Publicação
tema + canal + formato   →   dia + hora + destino   →   interna e cliente  →   entra na fila
   + público + ângulo        (sugerido pela IA)         (fixa a data)          quando pronta
```

### 1. A IA passa a sugerir dia e hora

Na geração da pauta, cada item ganha um horário sugerido, calculado a partir de:

- persona, nicho e hábitos do público do briefing do cliente;
- desempenho real: posts já publicados do próprio cliente (dia da semana e faixa horária com melhor resultado) e insights das contas conectadas quando disponíveis;
- o formato (Reels, Stories, Carrossel, etc.) e o canal;
- fuso America/Sao_Paulo, distribuição equilibrada no mês, sem dois posts colidindo no mesmo horário.

Cada sugestão vem com uma justificativa curta ("terça 19h — maior engajamento do público nesse horário nos últimos 60 dias"), visível na revisão.

Quando não houver histórico, a IA usa só persona/briefing e sinaliza isso como sugestão de baixa confiança.

### 2. O calendário do cliente vira o centro de decisão

`/calendar`, com um cliente selecionado, ganha:

- **Mês real** como visão padrão (semana continua disponível), com grade do mês inteiro.
- Itens propostos aparecem no dia sugerido como **chips fantasma** (tracejados), diferenciados dos agendados e dos publicados.
- **Arrastar** um chip muda o dia; clicar abre edição rápida de data, hora, canal e formato/posicionamento (Feed, Reels, Stories).
- Painel "Agenda para aprovar" ao lado: lista dos propostos do mês, com **aprovar um a um**, **aprovar selecionados** e **aprovar o mês todo**.
- Sazonalidades e compromissos já existentes continuam no mesmo calendário, servindo de contexto na decisão.

### 3. Aprovar reserva a data

Aprovar fixa dia, hora e destino no calendário e nada mais. A publicação só entra na fila de envio quando legenda e criativo estiverem prontos e aprovados — o chip mostra "data reservada, conteúdo pendente" até lá. Nenhum post é publicado por causa de uma aprovação de agenda.

### 4. Cliente aprova a grade no Portal

Depois da aprovação interna, a agenda do mês fica visível no Portal do cliente (aba Calendário), com:

- visão de mês somente leitura dos itens com data reservada;
- aprovar tudo, aprovar item a item ou pedir ajuste com comentário;
- pedido de ajuste devolve o item para "proposto" internamente, com o comentário anexado — nunca apaga nada.

### 5. Estados sempre claros

Cada item mostra um único status compreensível: Proposto · Aguardando cliente · Ajuste pedido · Data reservada · Conteúdo pendente · Agendado · Publicado · Falhou.

## Detalhes técnicos

**Banco (migration nova)**

- `monthly_plan_topics`: `suggested_at timestamptz`, `suggested_slot_rationale text`, `suggested_confidence text`.
- `posts`: `proposed_at timestamptz`, `schedule_status text` (`none|proposed|internal_approved|client_pending|client_changes|reserved`), `schedule_approved_at/by`, `schedule_client_decision_at`, `schedule_client_comment`. Índice por `(brand_id, client_id, proposed_at)`. GRANTs e RLS seguindo o padrão já usado em `posts` (nada novo em RLS global).

**Geração da pauta** — `monthly-plan-generate.server.ts` + `monthly-plan-agent.server.ts`: schema do tópico ganha `suggested_weekday`, `suggested_time`, `slot_rationale`. Novo módulo `monthly-plan-schedule.server.ts` converte (weekday, hora) em data concreta do mês do plano, resolve colisões de forma determinística e respeita a volumetria já alocada por `monthly-plan-distribution.ts`. Novo módulo `client-best-times.server.ts` agrega desempenho de `posts`/`post_placements` publicados e insights disponíveis, e injeta esse resumo no prompt (pt-BR, conforme `ai-language.ts`).

**Materialização** — `monthly-plan-kanban.server.ts` passa a gravar `proposed_at` e `schedule_status = 'proposed'` nos posts criados, mantendo idempotência atual.

**Calendário** — `calendar-board.functions.ts` inclui itens com `proposed_at` na janela consultada (novo `overall: "proposed"`); nova `schedule-approval.functions.ts` com `approveScheduleFn` (lote e individual), `updateProposedSlotFn` e `requestScheduleChangeFn`, todas com `requireSupabaseAuth` e RBAC por workspace/cliente. A grade de mês em `src/routes/_authenticated/calendar.tsx` é reestruturada (mês padrão, chips fantasma, drag & drop, painel de aprovação); o `ScheduleWizard` continua responsável pela publicação real e não é duplicado.

**Portal** — `portal-pauta.functions.ts`/`CalendarTab` ganham leitura da agenda reservada e decisão do cliente via token, reusando o isolamento de portal já existente (`is_portal_client_of`).

**Fases sugeridas de entrega**

1. Migration + IA sugerindo dia/hora + materialização gravando a proposta.
2. Calendário mensal com chips propostos, edição rápida e aprovação em lote.
3. Aprovação do cliente no Portal e pedido de ajuste.
4. Melhor horário com histórico real e justificativas por item.

Nada de dados fictícios; typecheck, testes e build validados a cada fase.
