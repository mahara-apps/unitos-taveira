# Calendário de Conteúdo — filtros por canal e apenas conteúdo confirmado

## O que muda

### 1. Calendário mostra só o que está agendado ou publicado
Hoje qualquer conteúdo que receba uma data no Kanban aparece no calendário, mesmo quando ainda é rascunho. Passa a aparecer somente o que foi efetivamente agendado ou publicado; rascunhos com data continuam visíveis nos painéis de pendências ("Prontos para agendar" / "Rascunhos") e no Kanban, mas não poluem o calendário.

O contador do topo, a volumetria por formato e a lista "Próximas publicações" passam a refletir a mesma regra.

Cada item do calendário ganha um indicador visual discreto entre **Agendado** e **Publicado**, para o time saber o que já saiu no ar.

### 2. Filtros dinâmicos por canal/rede social
Nova barra de filtros acima da grade, montada dinamicamente a partir dos canais realmente presentes no mês (nada de lista fixa):

- Chips com ícone da rede, nome e contagem de publicações no mês.
- **Múltipla seleção**: dá para marcar Instagram + TikTok ao mesmo tempo.
- Botão "Limpar" quando há seleção ativa.
- O filtro de canal combina com o filtro de formato já existente (Feed/Stories/Reels/Carrossel) e afeta grade, volumetria e lista lateral.
- A seleção fica na URL, então o recorte pode ser compartilhado/recarregado sem perder o filtro.

## Detalhes técnicos

**`src/lib/calendar.functions.ts`**
- Em `listScheduledPostsFn`, filtrar `post_placements.status` para `scheduled` e `published` (hoje traz `draft` também).
- Incluir `status` e `published_at` no select e no tipo `CalendarPost`.

**`src/routes/_authenticated/calendar.tsx`**
- Adicionar `validateSearch` com `zodValidator` + `fallback` para `channels: string[]` e `format: string | null`, substituindo o `useState` de `formatFilter` por estado de URL.
- Derivar a lista de canais disponíveis dos posts retornados (`channels[]`), com contagem, e renderizar chips multi-select reaproveitando `SocialIconsRow`/tokens de `@/lib/calendar-tokens`.
- Aplicar o filtro de canal no mesmo `useMemo` de `filteredPosts`, antes de `byDay` e da volumetria.
- Passar o status do placement ao `EventChip` para o selo Agendado/Publicado.

**`src/components/calendar/event-chip.tsx`**
- Selo de status usando tokens semânticos existentes (sem cores hardcoded).

Sem mudanças de schema, RLS ou lógica de aprovação.
