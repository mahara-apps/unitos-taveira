# Unitos — Documentação Técnica Completa

> Snapshot: 20 de julho de 2026  
> Stack: TanStack Start v1 + React 19 + Vite 7 + Tailwind v4 + Supabase (Lovable Cloud) + Cloudflare Workers  
> Runtime servidor: server functions (`createServerFn`) e server routes (`src/routes/api/*`)

---

## 1. Visão Geral

**Unitos** é uma plataforma SaaS multi-tenant de gestão de agências de marketing digital, organizada em três eixos:

1. **Operação** — pipeline de conteúdo, tarefas, calendário editorial, planos de mídia, projetos, publicação social.
2. **Inteligência (Brain)** — memória, aprendizado, raciocínio e chat, encapsulada por uma API única (`src/lib/brain/api.ts`).
3. **Gestão & Configurações** — marcas, clientes, times, permissões granulares, integrações, feature flags de super admin.

Hierarquia multi-tenant: **Workspace (Brand) → Cliente (Client) → Conteúdo/Tarefas/Publicações**. Contexto ativo resolvido pelo hook `useActiveContext`.

---

## 2. Papéis, Acesso e Feature Flags

### 2.1 Enum `app_role`
`owner`, `manager`, `editor`, `designer`, `client`.

### 2.2 Super Admin
Reconhecido por qualquer condição:
- `user_profiles.is_super_admin = true`
- `user_profiles.role = 'super_admin'`
- E-mail no allowlist (`resolveIsSuperAdmin` em `src/lib/feature-flags.functions.ts`)

Super admin **bypassa RLS, permissões granulares e feature flags** (helpers `public.is_brand_member`, `public.has_brand_role`, política `super_admin_full_access`). Auditoria continua registrando as ações.

### 2.3 Permissões granulares
Armazenadas em `brand_members.permissions` (JSONB). Regras centralizadas em `src/lib/permissions.ts`.

### 2.4 Feature Flags (`/super-admin/features`)
- `feature_catalog` — catálogo global (`brain`, `chat`, `mídia paga`, `blog_post`…).
- `brand_features` — habilitação por marca.
- Guardas: `beforeLoad: () => ensureFeatureEnabled("...")` em `src/lib/feature-flags.gate.ts`; rota bloqueada redireciona para `/dashboard?blocked=…`.

---

## 3. Rotas

### 3.1 Rotas públicas
| Rota | Arquivo |
|------|---------|
| `/` | `index.tsx` |
| `/login` | `login.tsx` |
| `/forgot-password` | `forgot-password.tsx` |
| `/reset-password` | `reset-password.tsx` |
| `/invite/$token` | `invite.$token.tsx` |
| `/approval/$token` | `approval.$token.tsx` |
| `/portal/$token` | `portal.$token.tsx` |
| `/p/briefing/$token` | `p.briefing.$token.tsx` |
| `/plano/$planId` | `plano.$planId.tsx` |

### 3.2 Rotas autenticadas (`src/routes/_authenticated/*`)
Sidebar em 4 grupos:

- **VISÃO GERAL** — `/dashboard`, `/analytics`
- **OPERAÇÃO** — `/customers`, `/projects`, `/tasks`, `/content`, `/calendar`, `/media-plans`, `/connections`
- **INTELIGÊNCIA** — `/brain`, `/brain/graph`, `/brain/diagnostics`, `/chat`, `/agents`
- **GESTÃO & CONFIGURAÇÕES** — `/settings/*` (profile, team, permissions, notifications, branding, ai, logs), `/notifications`, `/super-admin/features`

Cliente (single-page com tabs): `/customers/:customerId`, `/customers/:customerId/brain`, `/customers/:customerId/briefing`, `/customers/:customerId/media-plan`.

### 3.3 Server routes (`src/routes/api/*`)
- `api/chat.stream.ts` — SSE do chat.
- `api/jobs/*` — jobs assíncronos: `analyze-document`, `copilot`, `customer-pipeline`, `generate-ideas`, `monthly-plan`, `post-phase2`.
- `api/social/*` — dashboard e analytics por conexão/post.
- `api/public/*` — endpoints externos (auth bypass; validar assinatura no handler): `approval.$token`, `cron/sla-check`, `hooks/brain-consolidate`, `media/prune`, `meta/callback`, `meta/publish-scheduled`, `seed-superadmins`.

---

## 4. Backend (`src/lib/*.functions.ts`)

| Domínio | Arquivos principais |
|---------|--------------------|
| Workspace | `workspace.functions.ts` |
| Content | `content.functions.ts`, `placements.functions.ts`, `publications.functions.ts` |
| Tasks / Projects | `tasks.functions.ts`, `projects.functions.ts` |
| Calendar | `calendar.functions.ts` |
| Media Plans | `media-plans.functions.ts`, `media-plans-ai.functions.ts`, `media-plans-index.functions.ts`, `media-plan-public.functions.ts` |
| Brand Hub | `brand-hub.functions.ts`, `brand-media.functions.ts`, `branding.functions.ts` |
| AI Agents | `ai-agents.functions.ts`, `agents.functions.ts`, `agent-variables.functions.ts`, `ai-jobs.functions.ts` |
| Copilot | `copilot-inline.functions.ts` |
| Chat | `chat.functions.ts` |
| Analytics | `analytics.functions.ts`, `dashboard.functions.ts`, `channels-kpis.functions.ts`, `messaging-kpis.functions.ts`, `customer-dashboard.functions.ts` |
| Social Core | `social-core/*` (facade única) |
| Social Analytics | `social-analytics/*` |
| Meta | `meta/*` (provider + publisher) |
| Connections | `connections.functions.ts`, `social-connections.functions.ts` |
| Approval | `approval.functions.ts` |
| Documents AI | `documents-ai.functions.ts` |
| Notifications | `notifications.functions.ts`, `notifications-format.ts` |
| Team | `team.functions.ts` |
| Profile | `profile.functions.ts`, `password.functions.ts` |
| Feature Flags | `feature-flags.functions.ts`, `feature-flags.gate.ts` |
| Logs | `logs.functions.ts` |
| Portal público | `portal-public.functions.ts`, `briefing-tokens.functions.ts` |
| Messaging | `message-templates.functions.ts`, `message-templates.catalog.ts` |

### 4.1 Brain (`src/lib/brain/`)
API única em `api.ts` (nenhum módulo acessa tabelas `brain_*` diretamente).

Submódulos: `core/`, `memory/` (WMA + versionamento + decay), `event-bus/` (`waitUntil`), `query/`, `context-engine/` (intent, scoring, assemble, provenance), `reasoning/` (orchestrator, planner, decision, tools, logger), `learning/` (snapshots, relacionamentos), `insights/`, `recommendations/`, `graph/`, `chat-gateway/` (Brain-first + fallback `google/gemini-1.5-flash` com tools e vision), `stream/` (SSE + hook), `cache.ts` (LRU + `brain_stats_mv`), `diagnostics.functions.ts`, `legacy/` (ver `DEPRECATION.md`).

---

## 5. Schema Supabase (67 tabelas)

### 5.1 Enums
| Enum | Valores |
|------|---------|
| `app_role` | owner, manager, editor, designer, client |
| `post_stage` | idea, production, review, approved, scheduled, published |
| `post_channel` | instagram, tiktok, linkedin, x, youtube, blog |
| `task_status` | todo, in_progress, review, done |
| `task_priority` | low, medium, high, urgent |
| `project_status` | planning, in_progress, active, paused, done, archived |
| `approval_status` | pending, approved, changes_requested, adjust, rejected |
| `notification_kind` | mention, assignment, approval_requested, approval_decision, deadline, system, sla_overdue, sla_overdue_manager |
| `alert_severity` | info, warning, critical |

### 5.2 Tabelas por domínio (colunas)

**Identidade & Acesso**  
`user_profiles` (16), `brand_members` (6), `client_members` (7), `brand_invites` (15)

**Multi-tenant**  
`brands` (21), `clients` (22)

**Feature Flags**  
`feature_catalog` (8), `brand_features` (9)

**Brand Hub / Estratégia**  
`brand_briefings` (9), `brand_personas` (8), `brand_swot` (8), `brand_competitors` (11), `brand_voice_cards` (8), `brand_cohorts` (8), `brand_pautas` (16), `brand_ai_content` (11), `brand_ai_versions` (8), `brand_ai_usage` (11), `brand_media_assets` (14), `brand_api_credentials` (9), `brand_connections` (8)

**Clientes**  
`client_briefings` (10), `client_briefing_tokens` (12), `client_documents` (17)

**Conteúdo & Publicação**  
`content_pipelines` (13), `content_pipeline_stages` (12), `posts` (38), `post_placements` (14), `post_approvals` (9), `card_approval_tokens` (8), `card_approval_events` (9)

**Projetos & Tarefas**  
`projects` (14), `tasks` (15), `task_comments` (8)

**Planos de Mídia**  
`media_plans` (13), `media_plan_items` (17)

**Sociais**  
`social_connections` (22), `social_posts` (23)

**Mensageria & Chat**  
`chat_conversations` (8), `chat_messages` (13), `message_templates` (11), `message_logs` (12)

**Agentes de IA**  
`agent_prompts` (8), `ai_jobs` (18)

**Notificações & Auditoria**  
`notifications` (10), `activity_events` (9), `portal_tokens` (9)

**Brain**  
`brain_events` (16, particionada mensalmente: `_202604`…`_202610`, `_default`, `_archive`), `brain_embeddings` (6), `brain_memory` (31), `brain_memory_versions` (18), `brain_insights` (8), `brain_recommendations` (17), `brain_relationships` (15), `brain_reasoning_logs` (17), `brain_learning_queue` (11), `brain_metrics_snapshots` (8), `brain_retention_config` (4). MV: `brain_stats_mv`.

### 5.3 RLS & Segurança
- Todas as tabelas `public` com RLS.
- Helpers SQL: `is_brand_member`, `has_brand_role`, `is_super_admin(uuid)`, `has_role(uuid, app_role)`.
- Isolamento por `client_id` em `social_connections`, `social_posts`, `posts`, `post_placements` (índices parciais: 1 conta ativa por canal por cliente).
- Concorrência: RPCs `SECURITY DEFINER` (`claim_scheduled_social_posts`…) para claim atômico do worker.
- GRANTs explícitos por tabela (anon só quando política prevê).
- Trigger `handle_new_user`: default `editor` + sanitização.

---

## 6. Fluxos Críticos

### 6.1 One-Click AI Pipeline (2 fases)
Estratégia (`ai-agents.functions.ts`, 8 agentes) → Review Gate (AgentDrawer) → Ideias (`api/jobs/generate-ideas.ts`).

### 6.2 Publicação Meta agendada
`pg_cron` → `api/public/meta/publish-scheduled.ts` → `claim_scheduled_social_posts` → `MetaPublishingService` (Signed URL dinâmica) → retry + atualização em `social_posts`.

### 6.3 SLA de Colunas
`content_pipeline_stages.sla_hours` + `stage_entered_at` → scanner cron gera `notifications` (`sla_overdue`, `sla_overdue_manager`) + badge "atrasado".

### 6.4 Chat / Brain
`api/chat.stream.ts` → `brain/chat-gateway`; tenta responder via memória; fallback `google/gemini-1.5-flash` com tools (`clients`, `tasks`) e vision. Consolidação assíncrona via `hooks/brain-consolidate`.

---

## 7. UI/UX & Design System

- Estética "Geek Sleek" (Vercel/Stripe).
- Tailwind v4 + tokens OKLCH em `src/styles.css`, primária lime, light/dark suaves.
- shadcn/ui; sidebar em 4 grupos; `PageHeaderProvider` para título/ações por rota.
- `/content` com toolbar de filtros (criação, postagem, rede, formato, mídia), toggle Kanban/Lista, ordenação por coluna, DnD, multi-placement e SLA visual.
- Guia vivo em `DESIGN_SYSTEM.md`.

---

## 8. Infra & Runtime

- Cloudflare Workers (workerd) com `nodejs_compat`; bundling total.
- SSR via TanStack Start (Vite plugin); root em `src/routes/__root.tsx`; entries `src/server.ts` + `src/start.ts`.
- Clientes Supabase: `@/integrations/supabase/client` (browser), `client.server` (`supabaseAdmin`, service role, import dentro do handler), `requireSupabaseAuth` middleware + `auth-attacher`.
- 96 migrations em `supabase/migrations/` (últimas 2026-07-20).

---

## 9. Convenções

- Rotas flat-dot (`customers.$customerId.brain.tsx`).
- Server functions em `*.functions.ts`; helpers server-only em `*.server.ts` (jamais importar `client.server` no topo de rota/function).
- Metadata SEO em `head()` por rota (title, description, og:*, twitter:card).
- Leitura padrão: `useSuspenseQuery` + `ensureQueryData` no loader.
- Brain só via `src/lib/brain/api.ts`.
- UI em PT-BR.

---

## 10. Próximos Passos Sugeridos

1. Continuar consolidação Brain (fases além de Performance/Escalabilidade).
2. Centralizar RBAC (fragmentação apontada em auditoria).
3. Reduzir schema 67 → ~51 tabelas (`audit-tables-full.md`).
4. Expandir Social Core (TikTok, LinkedIn, X).
5. Fluxo formal de aprovações (tab `/content/approvals`).
