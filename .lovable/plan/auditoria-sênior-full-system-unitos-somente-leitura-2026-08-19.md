# Auditoria Sênior Full-System — Unitos (somente leitura)

Estado verificado agora: build OK, typecheck limpo (0 erros), 150 casos de teste, 515 arquivos em `src`, 52 clientes no banco.

## 1. Diagnóstico por severidade

### CRÍTICO
1. **48 de 52 clientes sem `owner_user_id`** (verificado por query). Com a matriz nova, `USER` só vê cliente próprio ou vinculado (`can_access_client_row` sem fallback) — logo 92% da base fica invisível para operadores. É o maior bloqueio funcional atual.
2. **Tabelas públicas com RLS habilitado e ZERO policies**: `portal_rate_limit`, `meta_compliance_events`, `brain_events_default`, `brain_events_202605..202611`. Não vazam pela API (nenhuma policy = nega tudo), mas todo acesso depende de service role; qualquer leitura futura via cliente autenticado falha silenciosamente e as partições de `brain_events` divergem da tabela-mãe (regra de partição nova nasce sem policy).

### ALTO
3. **Ausência de policy por partição = risco de regressão no Cérebro**: `brain_ensure_event_partitions` cria partições novas sem policies/grants; o comportamento de leitura muda conforme o mês.
4. **Fragmentação arquitetural do domínio "monthly plan/pauta"**: 20+ módulos (`monthly-plan-*.server.ts`, `monthly-plans.functions.ts` 49KB, `monthly-plan-public.functions.ts`, `media-plans*.functions.ts` x4, `agency-content.functions.ts`) com responsabilidades sobrepostas. Custo de manutenção alto e risco de regra divergente entre painel interno e link público.
5. **Duplicidade de camada de dashboard/portal**: `dashboard.functions.ts`, `client-dashboard.{functions,server,types,labels}`, `customer-dashboard.functions.ts`, `social-analytics/brand-dashboard.functions.ts` — quatro fontes para KPIs de cliente. `portal-*` tem 12 módulos com fronteira difusa entre `.functions` e `.server`.
6. **Componentes gigantes monolíticos**: `schedule-wizard/index.tsx` (73KB), `content/task-dialog.tsx` (71KB), `channels-center.tsx` (59KB), `briefing-workspace.tsx` (58KB), `strategy-panel.tsx` (50KB). Concentram estado, IO e apresentação — principal fonte histórica de bugs de hooks/estado.

### MÉDIO
7. **Lint em estado inutilizável como gate**: 5.775 problemas, sendo 5.586 `prettier/prettier` (formatação) — o ruído esconde os 62 `no-explicit-any`, 40 `react-hooks/exhaustive-deps` e 75 `react-refresh/only-export-components`.
8. **`react-hooks/exhaustive-deps` (40 ocorrências)**, incluindo `pauta.$planId.tsx:141` (expressão lógica em dependência de `useMemo` → recomputa a cada render em tela pública de aprovação).
9. **Dead code residual**: 4 abas antigas do brand-hub (`briefing-tab`, `competitors-tab`, `visual-identity-tab`), `brain/knowledge-graph.tsx`, `calendar/social-icons-row.tsx`, `ui/activity-timeline-item.tsx`, `lib/scheduling.ts`, `integrations/supabase/auth-attacher.ts` (substituído por middleware próprio) — nunca importados. Mais ~15 componentes shadcn não usados (esses são baratos, manter).
10. **Enum `app_role` ainda expõe `editor`/`designer`** no banco (tipos gerados confirmam). A UI já não usa e triggers normalizam, mas o enum aceita valor legado em qualquer INSERT direto/SQL.
11. **`.functions.ts` com helpers em escopo de módulo** (`brand-dashboard` 8, `team-admin` 7, `dashboard` 7, `team` 6, `portal-briefing` 6, `ai-agents` 6). Risco conhecido de `ReferenceError` em produção pelo splitting de server functions, mesmo com typecheck verde.
12. **SEO/metadados**: 40+ rotas sem `head()` — incluindo `src/routes/index.tsx` e as rotas públicas do Portal/aprovação, que são as que realmente são compartilhadas por link.

### BAIXO
13. 7 `console.log/debug` em código de servidor (`src/lib`, `src/routes/api`).
14. 6 `TODO/FIXME` remanescentes.
15. `no-useless-escape` (2), `no-empty` (2), `no-restricted-syntax` (1).

## 2. Itens já corretos (não regredir)
- **Sem policies para `anon`** em todo o schema público (0 ocorrências) — isolamento do Data API está correto.
- **Nenhuma função `SECURITY DEFINER` sem `search_path`** fixado.
- **Nenhum import de `client.server` em escopo de módulo** dentro de `*.functions.ts` — fronteira cliente/servidor respeitada.
- **Papéis legados eliminados do código de aplicação** (só aparecem em `types.ts` gerado).
- Cron/webhooks com gate `CRON_SECRET` timing-safe; rota de seed pública removida.
- `can_access_client_row` estritamente interno + `is_portal_client_of` para o Portal.
- Typecheck 0 erros, build OK, 150 testes cobrindo RBAC, Portal, Settings, hierarquia de tarefas e notificações.

## 3. Top 10 (ordem de ataque)
1. Backfill de `owner_user_id`/vínculos para os 48 clientes órfãos (+ obrigar responsável na criação).
2. Policies + grants para as 10 tabelas com RLS sem policy, e criação automática de policy em cada nova partição de `brain_events`.
3. Restringir escrita do enum `app_role` aos 4 papéis oficiais (constraint/validação), mantendo o enum por compatibilidade.
4. Corrigir os 40 `exhaustive-deps`, começando pelas telas públicas (`pauta.$planId`).
5. Normalizar formatação (prettier) e tornar o lint um gate real.
6. Consolidar domínio monthly-plan/pauta em um núcleo único de regras compartilhado por painel e link público.
7. Consolidar dashboards de cliente em uma fonte só.
8. Mover helpers de escopo de módulo dos 6 `.functions.ts` de risco para `*.server.ts`.
9. Quebrar os 5 componentes >50KB em subcomponentes + hooks.
10. Adicionar `head()` nas rotas públicas e em `index.tsx`; remover dead code listado.

## 4. Mapa de riscos

```text
                 IMPACTO ALTO                 IMPACTO MÉDIO
PROB. ALTA   [1] clientes órfãos           [7] lint sem gate
             [3] partições sem policy      [8] deps de hooks
PROB. MÉDIA  [4][5] duplicidade domínio    [11] helpers em .functions
             [6] componentes monolíticos   [10] enum legado
PROB. BAIXA  [2] tabelas sem policy        [12] SEO / [9] dead code
```

## 5. Plano por fases (sem infra/control plane)
- **Fase A — Desbloqueio funcional**: backfill de responsáveis, obrigatoriedade na criação, teste de regressão do escopo `USER`.
- **Fase B — Blindagem de dados**: policies/grants nas tabelas faltantes, policy automática em novas partições, restrição de escrita do enum de papéis.
- **Fase C — Estabilidade de UI**: `exhaustive-deps`, prettier em base inteira, lint como gate, remoção do dead code confirmado.
- **Fase D — Consolidação arquitetural**: núcleo único de pauta/monthly-plan; fonte única de dashboard do cliente; helpers para `*.server.ts`.
- **Fase E — Decomposição e polimento**: quebrar os componentes >50KB, `head()` nas rotas, remover `console.log` de servidor, zerar `any` crítico.

## 6. Nota geral: **7,8 / 10**
Segurança de perímetro e fronteiras servidor/cliente estão sólidas (sem `anon`, sem `search_path` mutável, cron protegido, testes cobrindo RBAC). O que puxa a nota para baixo é operacional e estrutural: 92% dos clientes inacessíveis para `USER`, RLS incompleta em 10 tabelas, forte duplicidade de domínio e componentes monolíticos.

Nada foi alterado nesta auditoria. Aprove para eu executar as fases (posso começar pela Fase A + B).
