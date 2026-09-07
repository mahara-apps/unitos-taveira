# Mídia paga: Relatório como aba interna (fora da sidebar)

## Objetivo

Remover "Relatório de anúncios" da navegação lateral e fazer **Mídia paga** ser um hub único com duas abas internas: **Plano de mídia** e **Relatório de anúncios**. O usuário entra em Mídia paga e alterna entre as duas opções sem sair da página — sem item solto na sidebar.

## O que muda (somente organização de UI/navegação)

### 1. Sidebar (`src/components/app-sidebar.tsx`)
- Remove o subitem "Relatório de anúncios" criado sob "Mídia paga".
- "Mídia paga" volta a ser um único item apontando para `/media-plans`.

### 2. `/media-plans` vira hub com abas
- Adiciona parâmetro de URL `?tab=planos|relatorio` (padrão: `planos`), com `validateSearch` na rota — estado compartilhável por link e preservado em refresh.
- Barra de abas no topo do conteúdo (segmented control, seguindo o padrão visual já usado no app — ex.: alternância Cards/Lista de Projetos):
  - **Plano de mídia** → todo o conteúdo atual de `media-plans.tsx` (KPIs, busca, lista de planos, "Novo plano").
  - **Relatório de anúncios** → todo o conteúdo atual de `media-report.tsx` (conta, filtros de período, KPIs, drill-down, criativos).
- Cabeçalho da página continua "Mídia paga"; as ações do header mudam conforme a aba ativa (Novo plano ↔ Buscar contas/Atualizar dados).
- Remove a barra improvisada "Plano de mídia / Relatório" com botões soltos que hoje existe dentro de `media-report.tsx`.

### 3. Compatibilidade de rota
- `/media-report` deixa de ser página própria e vira **redirect permanente** para `/media-plans?tab=relatorio` — nenhum link existente quebra.
- A lógica do relatório vive em componente extraído (`src/components/media-plans/ads-report-panel.tsx`), renderizado pela aba; a rota `/media-report` fica só com o redirect.

### 4. MASTER-first
- Sem mudança de banco/RLS — apenas código. Mesmo assim: regenerar delta, atualizar `delta_version.txt` e `MASTER_RELEASE_VERSION` (1.3.0 → 1.3.1), rodar `bun run master:check`, typecheck e build.

## Não muda
- Nenhum dado, permissão, server function, hook ou rota de API.
- Nenhuma outra página, header global ou tema.

## Validação
- `tsgo` + build + `master:check` verdes.
- Preview: `/media-plans` abre na aba Planos; aba Relatório funciona com filtros; `/media-report` redireciona; sidebar sem subitem.
