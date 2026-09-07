# Relatório completo de Timesheet em Análises

Hoje o tempo é registrado nas tarefas (cronômetro e lançamento manual), mas não existe nenhuma tela que some e cruze esses apontamentos. Em Análises só há uma soma de horas por pessoa dentro da aba Equipe. O plano cria um relatório de timesheet de verdade, com custo por pessoa, fechamento por cliente, mapa de calor e exportação.

## Onde aparece

1. **Análises → nova aba "Timesheet"** (ao lado de Social, Produção, Equipe, Clientes). É o lugar principal: já tem seletor de período, filtros de cliente, projeto e responsável, e respeita o cliente ativo.
2. **Ficha do cliente → aba "Horas"**: o mesmo relatório já filtrado naquele cliente, para fechamento de mês.
3. **Projeto → bloco "Horas do projeto"**: resumo compacto (total, por pessoa, previsto vs. realizado) com link para a aba Timesheet já filtrada.
4. **Meu tempo**: quando a pessoa só pode ver o próprio tempo, a aba abre direto na visão pessoal (semana atual, dia a dia).

## O que a aba Timesheet mostra

**Faixa de indicadores (padrão PageKpi)**
- Total de horas no período (e variação vs. período anterior)
- Custo total das horas
- Horas por pessoa/dia (média de dedicação)
- % de retrabalho
- Realizado vs. previsto (soma das estimativas das tarefas apontadas)

**Mapa de calor** — dias no eixo horizontal, pessoas no vertical; intensidade = horas. Mostra buracos, picos e fins de semana. Alternável para visão semanal quando o período é longo.

**Explorador agrupável** — uma tabela única com botões de agrupamento: por Pessoa, Cliente, Projeto ou Tarefa. Cada linha traz horas, custo, % do total, nº de apontamentos, retrabalho, previsto vs. realizado (barra com verde/âmbar/vermelho) e expande para o nível seguinte (Pessoa → Cliente → Projeto → Tarefa → apontamentos individuais com data, duração, origem cronômetro/manual e descrição).

**Fechamento mensal por cliente** — visão de fechamento: mês, cliente, horas, custo, comparativo com o mês anterior, pessoas envolvidas; pronta para exportar.

**Filtros** (além do período e dos filtros já existentes): pessoa, cliente, projeto, origem (cronômetro/manual), somente retrabalho, e apontamentos em aberto (cronômetro rodando agora aparece destacado, sem contar como tempo fechado).

**Exportar CSV** — exporta exatamente o recorte filtrado, em dois formatos: linha por apontamento (detalhado) ou linha por agrupamento atual (resumo).

## Custo por pessoa

Cada membro do workspace ganha um **valor/hora** editável em Configurações → Equipe (só Owner/Admin). O custo do relatório é horas × valor/hora vigente da pessoa. Quem não tem valor definido entra com custo zero e é sinalizado ("sem valor/hora definido") para não parecer que o número está errado.

## Quem vê o quê

- Owner/Admin: todo o workspace, todas as pessoas e clientes.
- Manager: apenas clientes que lhe são atribuídos, e as pessoas que apontaram nesses clientes.
- Usuário: apenas os próprios apontamentos; sem colunas de custo de terceiros.
- Custo em dinheiro: visível para Owner/Admin; Manager vê horas (e custo apenas dos seus clientes); usuário comum não vê custo.
- Portal do cliente: nada muda, timesheet não aparece lá.

## Detalhes técnicos

- **Migration**: `brand_members.hourly_cost_cents integer not null default 0` (custo por workspace, não no perfil global) + índices em `task_time_entries (brand_id, started_at desc)` e `(brand_id, user_id, started_at desc)` para agregação rápida.
- **Leitura server-side**: novo `src/lib/timesheet-report.functions.ts` com `getTimesheetReportFn` (agregados + série diária + heatmap) e `listTimesheetEntriesFn` (paginado, para o nível folha e o CSV detalhado), ambos com `requireSupabaseAuth`. Agregação em SQL via RPC `timesheet_report` (security definer, filtra escopo com as funções de acesso já existentes: `can_access_client`, `app_access_role`, `brand_member_role`) para não trazer milhares de linhas ao cliente.
- **Escopo fail-closed**: a RPC resolve o papel do usuário e restringe clientes/usuários antes de agregar; sem papel válido no workspace retorna vazio. Custo só é retornado quando o papel autoriza.
- **Duração**: usa `seconds` com fallback para `minutes * 60` (compatível com registros antigos), como já faz `entryDurationSeconds`.
- **Previsto vs. realizado**: soma `tasks.estimated_minutes` das tarefas presentes no recorte; tarefas sem estimativa ficam fora do comparativo e são contadas separadamente.
- **Fuso**: agrupamento por dia/semana/mês em `America/Sao_Paulo` via `src/lib/timezone.ts`; armazenamento continua UTC.
- **UI**: nova aba em `src/routes/_authenticated/analytics.tsx` + componentes em `src/components/analytics/timesheet/` (KPIs com `PageKpi`, heatmap, tabela agrupável, painel de fechamento). Sem cores fora dos tokens.
- **Permissões**: reutiliza o módulo `reports` (`/analytics`); custo protegido por papel, checado no servidor e refletido na UI.
- **Testes**: unitários da agregação (duração mista segundos/minutos, retrabalho, previsto vs. realizado, custo) e de escopo por papel (Owner/Manager/Usuário).
- **Propagação**: regenerar os deltas de instalação e subir `MASTER_RELEASE_VERSION` para levar a mudança à Taveira e às próximas instalações.
