# Redesenho da tela Analytics (somente esta tela)

Transformar a página de Análises numa central de performance em grid, escaneável, seguindo o
layout de referência enviado. Nenhuma outra tela, menu, cabeçalho ou tema é alterado.

## Decisões já confirmadas

- Dados reais (Meta) continuam alimentando a tela — nada de números de exemplo.
- A linha tracejada de comparação com o período anterior só é buscada quando a comparação
  for ligada no topo.
- O mapa de calor "Melhor horário" passa a usar a matriz completa dia × faixa do dia,
  calculada no servidor.

## Alerta de conflito

O anexo pede dados de exemplo da conta "use do avesso". Como a tela hoje mostra números reais
da conta conectada, os exemplos não serão usados — o layout é reproduzido, os números são os
reais. Nada que existe hoje deixa de existir: a aba Clientes (quando não há cliente ativo),
o painel de SLA, os insights e o Timesheet permanecem.

## O que o usuário verá

1. **Barra de contexto** no topo da tela: cliente ativo, seletor de período ("Últimos 30 dias"),
   botão de comparação "vs. período anterior", frescor dos dados ("em cache HH:MM" + Atualizar,
   reaproveitando o comportamento atual) e botão Filtros.
2. **Abas** Social, Produção, Equipe, Timesheet (+ Clientes na visão de workspace).
3. **Aviso de reconexão compacto**: faixa fina com a contagem de contas e o botão
   "Abrir Integrações", substituindo o painel grande atual.
4. **Linha de 6 indicadores**: Seguidores, Alcance, Impressões, Engajamento, Publicações,
   Crescimento — cada um com valor, variação vs. período anterior e mini-gráfico de tendência.
5. **Gráfico "Evolução"** em destaque, por dia, com alternador Alcance / Impressões /
   Engajamento, eixo único, legenda "Período atual / Período anterior" e a linha tracejada
   do período anterior quando a comparação estiver ligada.
6. **Grid de duas colunas**: "Engajamento por canal" e "Engajamento por formato", em barras
   horizontais com cor da categoria, rótulo e valor.
7. **Linha final**: "Top publicações" (lista ranqueada com miniatura, título, canal·formato e
   valor) e "Melhor horário" (mapa de calor dias × períodos do dia, azul do claro ao escuro,
   com o pico destacado).
8. Estados vazios curtos, layout responsivo (indicadores empilham no celular) e navegação
   por teclado nos alternadores.

## Detalhes técnicos

- `src/routes/_authenticated/analytics.tsx`: nova barra de contexto (período, comparação,
  frescor, filtros) acima das abas; conteúdo das abas Produção/Equipe/Timesheet/Clientes
  intacto.
- `src/components/analytics/social-analytics-dashboard.tsx`: reescrita da composição visual
  em grid (KPI row → Evolução → 2 colunas → Top posts + heatmap); mantém as duas queries
  atuais (`getBrandSocialDashboardFn` + payload de top posts), o cache/cooldown do
  `FreshnessBar` e o tratamento de warnings.
- Novos componentes locais em `src/components/analytics/`: `kpi-sparkline-tile.tsx`,
  `evolution-chart.tsx`, `horizontal-bar-breakdown.tsx`, `best-time-heatmap.tsx`,
  `reconnect-notice.tsx`. Reutilizam Card, Badge, Button, Tabs e tokens existentes.
- Sparklines derivadas de `series` (2px, sem eixos). Comparação: segunda chamada de
  `getBrandSocialDashboardFn` com `since`/`until` do intervalo anterior, habilitada só com a
  comparação ligada, cache próprio na query key.
- Heatmap: adicionar `bestSlotsMatrix: { weekday, bucket, score, posts }[]` (buckets manhã /
  tarde / noite / madrugada) ao payload de top posts, agregado no mesmo laço que já produz
  `bestHours` em `src/lib/social-analytics/brand-dashboard.functions.ts`. Sem migration;
  `bestHours`/`bestDays` continuam no payload.
- Paleta categórica fixa (#0072B2, #E69F00, #009E73, #CC79A7) e escala do heatmap
  registradas como tokens de analytics em `src/styles.css`, sem alterar tokens globais.
- Textos sempre em tons de tinta; um eixo por gráfico; legenda com 2+ séries.

## MASTER-first

Como há mudança de servidor (matriz do heatmap), o pacote MASTER é regenerado, com
`delta_version.txt` e `MASTER_RELEASE_VERSION` elevados a 1.2.9 e `bun run master:check`,
typecheck e build verificados antes de concluir.
