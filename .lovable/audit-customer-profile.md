# Auditoria — Perfil do Cliente (somente leitura)

Rota base: `src/routes/_authenticated/customers.$customerId.tsx` (431 linhas, shell com `Tabs` + `usePageHeader` + `ScrollArea`).
Rotas filhas legadas coexistem: `customers.$customerId.brain.tsx` (22), `.briefing.tsx` (16), `.pauta.tsx` (17) — apenas redirecionam/embutem; `.media-plan.tsx` (952) é uma tela grande **fora** das tabs.
Nenhuma alteração foi feita neste levantamento.

---

## 1. Mapa completo das abas

| Aba | Componente | Finalidade | Dados / server fns | Tabelas | Ações | UX atual |
|---|---|---|---|---|---|---|
| Visão geral | `customer/overview/*` (9 arquivos, ~880 l.) | Centro de comando | `customer-dashboard.functions`, `brand-hub.functions`, `tasks.functions`, `calendar.functions` | clients, tasks, posts, post_approvals, ai_jobs/ai_usage, activity_events, brain_* | navegar p/ outras abas | **Boa** (referência) |
| Briefing | `brand-hub/briefing-workspace.tsx` (1650 l.) | Briefing + volumetria + gerar inteligência | `brand-hub.functions`, `briefing-progress`, `monthly-plan-fields` | clients.brand_hub, brand_briefings, brand_voice_cards, brand_personas | salvar campos, gerar IA | Média — arquivo monolítico, muitos formulários empilhados |
| Estratégia IA | `ai-agents/strategy-results.tsx` + `strategy-panel` + `strategy-history` | Ver saídas dos agentes | `ai-agents.functions`, `brand_ai_content/versions` | brand_ai_content, brand_ai_versions, ai_jobs | restaurar versão, gerar | Média/ruim — sub-tabs dentro de tab, header cinza sem hierarquia |
| Pauta | `monthly-plan/monthly-plan-view.tsx` (1376 l.) + `volumetry-cards`, `context-sources-row`, `generate-plan-wizard` | Pauta mensal, aprovação, kanban | `monthly-plans.functions`, `plan-overage.functions`, `monthly-plan-status` | monthly_plans, monthly_plan_topics, monthly_plan_tokens, plan_overage_requests, projects, tasks | gerar, aprovar/aprovar todos, link cliente | **Excelente** (referência) |
| Produção | `customer/production/*` (3 arquivos, 476 l.) | Realizado vs. contratado + excedentes | `production-report.functions`, `plan-overage.functions`, `monthly-plans.functions` | posts, tasks, plan_overage_requests, monthly_plans | aprovar/negar excedente, filtrar | Média — `DashboardPanelSurface` (outro dialeto de card) |
| Canais | `customer/channels-tab.tsx` (382 l.) | Canais vinculados ao cliente | `client-channels.functions` | social_connections, client_social_accounts | vincular/desvincular, abrir /connections | Média/ruim — `Card` cru + lista densa, título `text-sm font-medium` |
| Gestão da conta | `customer/account-management-tab.tsx` (735 l.) + `portal-link-card` | Jornada, contrato, responsável, portal, templates | `client-journey.functions`, `team.functions`, `project-templates.functions` | clients, client_journey_events, brand_journey_stage_templates, portal_tokens, project_templates | mudar estágio, editar contrato, gerar portal | **Ruim** — 9 raios de borda diferentes, formulário longo sem seções claras |
| Cadastro | `customer/basic-info-tab.tsx` (254 l.) | Registro da empresa | `workspace.functions` (listClients/updateClient), `permissions` | clients | salvar campos | **Ruim** — formulário em coluna única, sem máscaras, sem agrupamento, sem feedback de dirty state |

Órfãos/legados encontrados (não remover agora, apenas registrar):
- `customer/customer-dashboard.tsx` (646 l.) — substituído por `overview/*`, ainda importa `customer-queries`.
- `brand-hub/brand-hub.tsx`, `briefing-tab.tsx`, `visual-identity-tab.tsx`, `competitors-tab.tsx`, `documents-tab.tsx` — não alcançáveis pelas tabs atuais.
- `customer/monthly-plan-dialog.tsx`, `quick-create-customer-drawer.tsx`, `portal-access-section.tsx`, `portal-theme-form.tsx` — sem entrada visível no perfil.
- `customers.$customerId.media-plan.tsx` (952 l.) — rota sem link no shell de tabs.
- Aba `brain` ainda existe no schema de search e é redirecionada para `briefing` via `useEffect`.

---

## 2. O que Visão Geral faz bem
- Grid rígido 2 col. (`lg:grid-cols-2`), cards `h-full min-h-[16rem]` → linhas alinhadas.
- Primitiva única `OverviewCard` (header com ícone + título 13/14px semibold + subtítulo 11px, corpo, footer com borda).
- `OverviewLink` para ação secundária (texto + seta), `OverviewEmpty` padronizado (ícone em círculo + título + hint + ação).
- Superfície consistente: `rounded-2xl border-border/50 bg-card`, padding `px-5 py-4`.
- Cor usada apenas semanticamente (health, alertas amber, pipeline por estágio).
- Nunca mostra tela branca: `OverviewSkeleton` com o mesmo grid.

## 3. O que Pauta faz bem
- Header de página com título, contexto do plano, status badge e ações primárias agrupadas à direita.
- Status como fonte única (`monthly-plan-status`) → badge/cor consistentes.
- Volumetria em cards de métrica com progresso; excedente destacado em amber.
- Ações em massa ("Aprovar todos") + ações por item; confirmações e toasts em PT-BR.
- Estados vazios com CTA que ensina o próximo passo; histórico ordenável.
- Erros de IA mapeados para PT-BR (`lib/errors`).

---

## 4. Inconsistências (classificadas)

**CRÍTICO**
1. Três dialetos de card no mesmo perfil: `OverviewCard` (rounded-2xl), `Card` shadcn (rounded-lg), `DashboardPanelSurface` (Produção). Parece sistemas diferentes.
2. Cadastro e Gestão da conta não têm header de página (título/descrição/ações) — quebra a leitura ao trocar de aba.
3. Ausência de padrão de loading: Visão geral/Pauta têm skeleton; Cadastro/Canais/Gestão mostram vazio ou `Skeleton` solto.

**ALTO**
4. Tipografia de seção divergente: `text-sm font-medium` (Canais), `h3 text-sm font-semibold` (Overview), sem heading (Cadastro).
5. Sub-tabs dentro de tab em Estratégia IA (navegação de 2 níveis não repetida em nenhuma outra aba).
6. Estados vazios ad-hoc (texto cinza) em Canais/Estratégia/Gestão vs. `OverviewEmpty`.
7. Formulários sem agrupamento nem barra de salvar fixa (Cadastro, Gestão) — botão salvar perdido no fim do scroll.
8. Excesso de cinza: Gestão e Cadastro praticamente monocromáticos; status de contrato/jornada sem cor.

**MÉDIO**
9. Badges com variantes diferentes por tela (status de canal via `StatusDot`, jornada via `Badge` neutro, pauta via mapa de status).
10. Densidade: Cadastro tem coluna única em tela de 1456px (largura útil desperdiçada); Gestão tem blocos muito largos.
11. Duplicação de informação: contato/nicho aparecem em Visão geral (`OverviewClientInfo`), Cadastro e header do cliente.
12. Ações destrutivas (desvincular canal) sem diálogo de confirmação consistente.

**BAIXO**
13. Bordas `border-border/60` vs `/50` vs default.
14. Ícones de tamanhos variados (3.5 / 4 / 5).
15. Mistura de `window.dispatchEvent("nx:switch-customer-tab")` com `goToTab` para navegação interna.

---

## 5. Auditoria funcional (resumo por aba)
- **Cadastro**: dono = gestor de conta; ação principal = manter dados fiscais/contato. Deveria ser 2 colunas com blocos (Empresa / Contato / Redes). Redes sociais aqui duplicam Canais → confusão sobre o que publica.
- **Gestão da conta**: dono = owner/manager; ação principal = mover estágio da jornada e manter contrato. Portal + templates de projeto misturados no mesmo scroll; templates parecem função semiabandonada.
- **Canais**: ação principal = vincular canal existente. Correto arquiteturalmente; falta clareza de "por que está vazio" e do caminho para /connections.
- **Estratégia IA**: consumo/leitura de saídas; ação principal = restaurar versão. Sub-tabs deveriam ser seções.
- **Produção**: ação principal = aprovar excedentes. Relatório e fila competem por atenção; a fila deveria ser destaque com badge de pendência.
- **Briefing**: fonte do cérebro; ação principal = completar e gerar inteligência. Monolito difícil de escanear.

## 6. Dados / IA — dependências a não quebrar
- `clients.brand_hub` (jsonb) + `brand_briefings`, `brand_voice_cards`, `brand_personas`, `brand_swot`, `brand_competitors` alimentam agentes (`ai-agents.functions`, `post-agents.server`, `monthly-plans.functions`).
- `computeBriefingCompletion` governa onboarding e o badge amber da aba Briefing.
- Volumetria do briefing (`monthly-plan-fields`) é contrato para Pauta e excedentes (`plan_overage_requests`).
- `client_social_accounts` restringe canais no editor de peça.
- Qualquer refatoração visual deve preservar os nomes de campo e as chaves de query (`brand-hub`, `customer-dashboard`, `client-journey`, `client-linked-channels`).

## 7. Design system recomendado (extraído de Visão Geral + Pauta)
- Promover `overview-shared` para `components/customer/ui/`: `ProfileCard`, `ProfileLink`, `ProfileEmpty`, + novos `ProfilePageHeader`, `ProfileStat`, `ProfileFormSection`, `ProfileSaveBar`, `ProfileStatusBadge`.
- Superfície: `rounded-2xl border border-border/50 bg-card`, header `px-5 pt-4`, corpo `px-5 py-4`, footer com `border-t border-border/40`.
- Tipografia: título de aba 16/600, título de card 14/600, subtítulo 11–12 muted, valor de métrica 24/600 tabular.
- Grid: `grid-cols-1 lg:grid-cols-2 gap-4`; formulários em `md:grid-cols-2` dentro de seções.
- Cor semântica: emerald = ok/publicado, amber = pendência/excedente, sky = agendado, violet = IA, destructive = atraso/erro; neutro para o resto.
- Toda aba: header (título, descrição, ações) → filtros → conteúdo → empty state com CTA; skeleton no mesmo grid.

## 8. Arquitetura visual proposta
- **Header do cliente**: logo/avatar, nome, segmento, badge de status/jornada, responsável (avatar), 3 métricas rápidas (saúde, pauta do mês, pendências) e ações primárias (Completar onboarding / Gerar pauta / Portal).
- **Navegação**: manter 8 abas, agrupadas visualmente: Operação (Visão geral, Pauta, Produção) · Inteligência (Briefing, Estratégia IA) · Conta (Canais, Gestão, Cadastro). Remover `brain` do enum futuramente.
- **Padrão de página** conforme item 7; Estratégia IA vira seções âncora; Cadastro e Gestão viram 2 colunas com save bar fixa.

## 9. Priorização
- **FASE 1 (visual/UX alto)**: Cadastro, Gestão da conta, Canais.
- **FASE 2 (funcional alto)**: Produção (fila de excedentes em destaque), Estratégia IA (sub-tabs → seções), header do cliente.
- **FASE 3**: Briefing (quebrar o monolito em seções sem mudar campos).
- **FASE 4**: limpeza dos órfãos (customer-dashboard, brand-hub/*, media-plan, rotas filhas legadas, enum `brain`).

## 10. Riscos por área
- Briefing: **alto** — mexer em campos quebra IA/volumetria. Só recasing visual.
- Pauta/Visão geral: não tocar (referência).
- Gestão: médio — mutações de jornada disparam eventos/brain.
- Canais: médio — vínculo afeta publicação.
- Cadastro: baixo/médio — `updateClient` também alimenta header e Visão geral.
- Produção: baixo.

## 11. Arquivos que provavelmente mudarão numa refatoração futura
`customers.$customerId.tsx`; `customer/basic-info-tab.tsx`; `customer/account-management-tab.tsx`; `customer/channels-tab.tsx`; `customer/production/{production-tab,production-report,production-overages}.tsx`; `ai-agents/{strategy-results,strategy-panel,strategy-history}.tsx`; `brand-hub/briefing-workspace.tsx`; novo `customer/ui/*` (promoção de `overview/overview-shared.tsx`); `customer/portal-link-card.tsx`.
