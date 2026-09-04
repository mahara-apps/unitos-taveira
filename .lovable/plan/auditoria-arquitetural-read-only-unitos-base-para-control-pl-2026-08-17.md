# Auditoria Arquitetural Read-Only — Unitos (base para Control Plane white-label)

Data: 2026-08-17. Nenhum arquivo de aplicação alterado, nenhuma migration criada, nenhuma escrita no banco. Leituras: código do repositório + consultas SQL somente-leitura em produção.

Legenda: **[F]** fato comprovado em código/schema/SQL · **[I]** inferência.

---

## 1. Stack, entrypoints, roteamento, auth/RBAC e contexto ativo

- **[F]** TanStack Start v1 + React 19 + Vite 7 + Tailwind v4, target Cloudflare Workers via nitro (`vite.config.ts` usa `@lovable.dev/vite-tanstack-config`, `server: { entry: "server" }`).
- **[F]** Entrypoints: `src/router.tsx`, `src/routes/__root.tsx`, `src/start.ts` (middleware de função client que anexa e renova o bearer Supabase), `src/server.ts` (wrapper de erro SSR), `src/routeTree.gen.ts` gerado.
- **[F]** Três árvores de rota: `_authenticated/*` (app interno, gate `route.tsx`), `_portal/*` + `portal.$token.*` (portal do cliente, token ou login), rotas públicas (`login`, `invite.$token`, `approval.$token`, `pauta.$planId`, `plano.$planId`, `p.briefing.$token`).
- **[F]** RBAC: enum `app_role` (`owner|manager|editor|designer|client`); membresia em `brand_members` (com `permissions` JSONB) e `client_members`; permissões declaradas em `src/lib/permissions.ts`; super admin via RPC `is_super_admin` (duas sobrecargas: allowlist por JWT e `user_profiles.is_super_admin`) — usado como bypass em RLS, permissões e feature flags.
- **[F]** Feature flags: `feature_catalog` (global) + `brand_features` (por marca), guard `ensureFeatureEnabled` em `src/lib/feature-flags.gate.ts`.
- **[F]** Contexto ativo: `src/hooks/use-active-context.tsx` guarda `brandId`/`clientId` em `localStorage` (`nx.brand`, `nx.client`) e passa esses IDs como argumento para praticamente toda server function.

## 2. Frontend, server functions e fronteira client/server

- **[F]** Padrão dominante: `*.functions.ts` (client-reachable, `createServerFn` + `requireSupabaseAuth`) chamando helpers `*.server.ts`. `src/lib/server-fn-registry.server.ts` existe para contornar problemas de resolução sob `ssr: false`.
- **[F]** Server routes em `src/routes/api/`: `api/jobs/*` (pipeline de cliente, copiloto, análise de documento), `api/chat.stream.ts`, `api/social/*`, e `api/public/*` (webhooks/cron/meta/aprovação/seed).
- **[F]** Subárvore autenticada é `ssr: false`; guards e leitura de contexto rodam no cliente.
- **[I]** A fronteira está consistente, mas o volume (≈120 módulos em `src/lib`) faz de qualquer mudança transversal de tenancy um refactor amplo.

## 3. Modelo de dados (domínios e centralidade)

**[F]** 88 tabelas em `public`. Tabela raiz: `brands` (1 linha em produção). `clients` (8 linhas). `auth.users`: 3.

- **Tenancy/identidade**: `brands`, `brand_members`, `brand_invites`, `clients`, `client_members`, `user_profiles` (`is_super_admin`), `brand_features`, `feature_catalog`.
- **Conteúdo/produção**: `posts` (41 colunas, 8 FKs — tabela mais central), `post_placements`, `post_approvals`, `content_pipelines`, `content_pipeline_stages`, `projects`, `tasks`, `task_subtasks`, `task_time_entries`, `task_comments`, `project_templates` e jobs/tasks de template.
- **Pauta/planejamento**: `monthly_plans`, `monthly_plan_topics`, `monthly_plan_tokens`, `plan_overage_requests`, `brand_pautas` (legado), `media_plans`, `media_plan_items`.
- **Social/publicação**: `social_connections` (nível workspace), `client_social_accounts` (N:N cliente↔conexão, com unicidade por `connection_id`), `social_posts`, `meta_oauth_sessions`, `meta_compliance_events`.
- **Portal/aprovações**: `portal_tokens`, `portal_rate_limit`, `card_approval_tokens`, `card_approval_events`, `client_briefings`, `client_briefing_tokens`, `client_documents`.
- **IA**: `ai_jobs`, `brand_ai_content`, `brand_ai_versions`, `brand_ai_usage`, `ai_usage_limits`, `agent_prompts` (global) + `agent_prompt_overrides` (por marca), `ai_model_catalog_overrides`, `ai_model_health`, `brand_api_credentials` (BYOK cifrado).
- **Brain**: `brain_events` (particionada por mês, com partições 202605–202611 + default + archive), `brain_memory`, `brain_memory_versions`, `brain_embeddings`, `brain_insights`, `brain_recommendations`, `brain_relationships`, `brain_reasoning_logs`, `brain_learning_queue`, `brain_worker_runs`, `brain_metrics_snapshots`, `brain_retention_config`.
- **[F]** 71 tabelas possuem `brand_id`; 17 não têm `brand_id` nem `client_id`: `agent_prompts`, `ai_model_catalog_overrides`, `ai_model_health`, `brain_retention_config`, `brain_worker_runs`, `brands`, `chat_messages`, `content_pipeline_stages`, `feature_catalog`, `media_plan_items`, `meta_compliance_events`, `monthly_plan_topics`, `portal_rate_limit`, `post_approvals`, `project_template_jobs`, `project_template_tasks`, `user_profiles`. Dessas, algumas herdam tenancy do pai (`monthly_plan_topics`, `media_plan_items`, `content_pipeline_stages`, `post_approvals`, `chat_messages`); as restantes são efetivamente **globais da instalação** (catálogo de IA, prompts, saúde de modelos, retenção, worker runs, compliance, rate limit).

## 4. Como o Supabase é consumido hoje

- **[F]** `src/integrations/supabase/client.ts` tem **URL e anon key hardcoded** (`https://tkjbhttylouamqxnbfgv.supabase.co` + JWT anon literal). Não lê `import.meta.env`. Isso é o acoplamento nº 1 a "um único Supabase".
- **[F]** `auth-middleware.ts` (server) usa `process.env.SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` e valida o bearer com `getClaims`.
- **[F]** `client.server.ts` usa `SUPABASE_URL` + (`SUPABASE_SERVICE_ROLE_KEY` ou `SB_SERVICE_ROLE_KEY`), com patch de header para chaves opacas `sb_*`.
- **[F]** `supabase/config.toml` fixa `project_id = "tkjbhttylouamqxnbfgv"`. `src/integrations/supabase/types.ts` é o tipo `Database` gerado deste projeto e é importado por praticamente todo o backend.
- **[I]** Servidor já é 100% env-driven; o cliente do browser não é. Trocar de Supabase por instalação exige apenas tornar `client.ts` env-driven (`VITE_*`) — mas o arquivo é marcado como gerado, então isso precisa de decisão explícita.

## 5. Integrações externas, secrets e BYOK

- **[F]** Secrets referenciados no código: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SB_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_ID`, `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_WEBHOOK_VERIFY_TOKEN`, `BRAND_CREDENTIALS_SECRET`, `LOVABLE_API_KEY`, `RESEND_API_KEY`, `INVITE_FROM_EMAIL`, `APIFY_TOKEN`, `APP_URL`, `PUBLIC_APP_URL`, `SUPERADMIN_APITADA_PASSWORD`, `SUPERADMIN_JOSE_PASSWORD`.
- **[F]** BYOK de IA: chaves por marca em `brand_api_credentials`, cifradas AES-256-GCM em `src/lib/credentials-crypto.server.ts` com chave derivada de `BRAND_CREDENTIALS_SECRET`. Resolução em `ai-provider.server.ts` (OpenAI/Anthropic/Google/Groq + fallback e catálogo auto-curativo).
- **[F]** Meta: `src/lib/meta/*` (provider, portfólio, escopos granulares, publicação, signed request) + `api/public/meta/{callback,webhook,deauthorize,data-deletion,deletion-status,publish-scheduled}`. App Meta é **um único app da instalação** (`META_APP_ID`/`SECRET` em env, não por marca).
- **[F]** E-mail transacional via Resend (`api.resend.com`) em `team.functions.ts` e `message-templates`.
- **[F]** `ai.gateway.lovable.dev` e `connector-gateway.lovable.dev` aparecem no código (gateway Lovable) — acoplamento à plataforma Lovable.
- **[F]** Não há integração WhatsApp real: `message-templates.catalog.ts` traz apenas exemplos (`https://wa.me`, `https://evo.dominio.com`, `https://app.nexusflow/...` como sample).

## 6. Crons, workers, webhooks e URLs dependentes de ambiente

**[F]** 14 jobs ativos em `cron.job`. Sete são SQL puro (`reap_stuck_ai_jobs`, `enqueue_deadline_notifications`, `process_brain_learning_queue`, `reap_brain_learning_queue`, `refresh_brain_stats`, `brain_retention_run`, `brain_run_mining_safe`). Sete usam `net.http_post` com **URL hardcoded** `https://project--3f33732a-cb8b-43ae-84fb-01d9e367fb0c.lovable.app/...` e **anon key literal embutida no comando do cron**: `media/prune`, `hooks/brain-consolidate`, `cron/sla-check`, `meta/publish-scheduled`, `hooks/brain-synthesis`, `hooks/social-metrics-sync`, `hooks/ai-models-health`.

- **[F]** `resolveMetaRedirectUri` (`meta/provider.server.ts`) confia em hosts `*.lovable.app` / `*.lovableproject.com` além do host de `META_REDIRECT_URI`.
- **[F]** Hosts fixos em código: `https://unitos.sejaumpartner.com` (fallback de `PUBLIC_APP_URL` em `signed-request.server.ts`, além de comentários de deauthorize/data-deletion) e `https://unitos.lovable.app` (comentário do webhook).
- **[F]** `api/public/seed-superadmins.ts` cria dois super admins com e-mails fixos (`apitadadigital@gmail.com`, `jose@mahara.marketing`), protegido apenas por header comparado a `SUPERADMIN_APITADA_PASSWORD`. Rota descrita no próprio código como "descartável", mas ainda presente.
- **[I]** Cada instalação nova exigirá recriar todos os 7 crons HTTP com URL e anon key próprios — hoje isso vive em migrations, não em configuração.

## 7. Brain: boundaries, escopos e dependências

- **[F]** Fachada única `src/lib/brain/api.ts` + `services.ts`, com submódulos `core`, `memory`, `learning`, `insights`, `graph`, `query`, `reasoning`, `recommendations`, `event-bus`, `chat-gateway`, `stream`, `observability`, `legacy` (+ `DEPRECATION.md`).
- **[F]** Escopo é por `brand_id` em todas as tabelas `brain_*` de conteúdo; ingestão via triggers `brain_trg_*` em `posts`, `tasks`, `projects`, `clients`, `client_documents`, `post_approvals`, `task_comments`, e função `emit_brain_event`.
- **[F]** Dependências de banco: `pgvector` (`brain_embeddings`, tipos halfvec/sparsevec), particionamento por mês (`brain_ensure_event_partitions`), views materializadas de stats (`refresh_brain_stats`), `pg_cron` + `pg_net`.
- **[F]** Fora do escopo de marca: `brain_worker_runs`, `brain_retention_config` (globais da instalação).
- **[I]** O Brain é o subsistema mais dependente de extensões e de jobs de banco; é o maior custo de replicação por instalação (cada Supabase precisa de pgvector, partições e crons próprios).

## 8. Como o cliente é identificado e isolado hoje

- **[F]** Isolamento é **lógico**, dentro de um único banco: `brand_id` (workspace) + `client_id` (cliente da agência), aplicado via RLS com helpers security definer (`can_access_client`, `can_access_task`, `is_brand_member`, `has_brand_role`, `_portal_session*`).
- **[F]** No app, o escopo vem de `localStorage` e é enviado como parâmetro; a autoridade final é RLS no banco (com `requireSupabaseAuth`) — não o parâmetro do cliente.
- **[F]** Portal público resolve cliente por token (`portal_tokens`, RPCs `portal_*`) ou por `client_members.role = 'portal_client'` quando logado.

## 9. Partes que assumem UMA instalação / UMA marca / UM Supabase

1. **[F]** `src/integrations/supabase/client.ts` — URL + anon key hardcoded.
2. **[F]** `supabase/config.toml` — `project_id` fixo.
3. **[F]** 7 crons com URL de projeto Lovable e anon key literais.
4. **[F]** App Meta único por env (`META_APP_ID`/`META_APP_SECRET`/`META_REDIRECT_URI`), com hosts `*.lovable.app` confiados por padrão.
5. **[F]** `seed-superadmins` com e-mails fixos + allowlist de super admin por e-mail.
6. **[F]** Metadados/branding de produto fixos em `__root.tsx` ("Unitos — Gerenciador de Conteúdos…") e logo `mark-unitos.png` em `src/assets/brand`.
7. **[F]** Tabelas globais sem tenancy (catálogo de IA, `agent_prompts`, `ai_model_health`, `feature_catalog`, `brain_retention_config`) — hoje "uma configuração para todo mundo".
8. **[F]** `BRAND_CREDENTIALS_SECRET` único: chaves BYOK cifradas com ele não são portáveis entre instalações sem re-cifrar.
9. **[I]** `brands` com 1 linha: embora o schema seja multi-brand, todo o comportamento em produção foi exercido com uma marca só — o multi-brand é "correto por leitura", não validado por dados.

## 10. Compartilhável vs. configurável por instalação

Compartilhável (código único, mesmo build): rotas e UI, server functions, `src/lib/**` (Brain, IA, Meta, pauta, produção), schema/migrations, prompts de agentes como *defaults*, catálogo de features e de modelos como *seed*.

Configurável por instalação: URL/anon key do Supabase, service role, `BRAND_CREDENTIALS_SECRET`, app Meta (id/secret/redirect/verify token), Resend + remetente, `APP_URL`/`PUBLIC_APP_URL`, domínio próprio, branding (nome, logo, favicon, paleta, título/OG), módulos habilitados (`feature_catalog`/`brand_features`), limites de IA (`ai_usage_limits`), retenção do Brain, conjunto de crons e seus destinos, super admins da instalação.

## 11. Áreas impactadas por um Control Plane externo

- `src/integrations/supabase/client.ts` (tornar env-driven) e `supabase/config.toml`.
- `src/start.ts` / `auth-middleware.ts` (resolução de configuração por instalação).
- `src/routes/__root.tsx` + `use-brand-branding.ts` + `src/assets/brand/*` (branding por instalação).
- Todos os `api/public/*` (autenticação de chamadas de cron/webhook por instalação, hoje via anon key literal) e a criação dos crons.
- `src/lib/meta/provider.server.ts` (allowlist de hosts, redirect URI por domínio).
- `feature-flags.functions.ts` / `feature-flags.gate.ts` + `feature_catalog` (módulos comercializáveis).
- `team.functions.ts` / `message-templates` (origem de links em e-mails).
- `seed-superadmins.ts` (bootstrap de instalação).
- Pipeline de migrations (precisa ser aplicável a N projetos Supabase, versionado).

## 12. Riscos de segurança de credenciais de cliente no frontend/build

- **[F]** Hoje a anon key está literalmente no bundle (aceitável por design do Supabase, desde que RLS cubra tudo) — mas **a anon key também está embutida nos comandos de cron**, o que a espalha para o banco em texto claro.
- **[F]** `api/public/*` bypassa o auth do site publicado; a proteção real é o que cada handler faz. Um único handler sem verificação vira porta de entrada por instalação.
- **[F]** `SB_SERVICE_ROLE_KEY` e `BRAND_CREDENTIALS_SECRET` só existem no servidor — correto; qualquer movimento que os leve a `VITE_*` seria vazamento total (bypass de RLS e decifra de BYOK de todos os clientes).
- **[I]** Riscos do modelo white-label: (a) build por cliente com secret embutido em variável `VITE_*` → exposto a qualquer visitante; (b) Control Plane guardando service role de N clientes → alvo único de altíssimo valor, exige cofre e credenciais de curta duração; (c) reuso do mesmo `BRAND_CREDENTIALS_SECRET` entre instalações elimina o isolamento criptográfico entre clientes.

## 13. Deploy atual e pontos de acoplamento

- **[F]** Projeto é gerado/operado pelo Lovable (`.lovable/project.json`, template `tanstack_start_ts_current`), build Vite → nitro/Cloudflare Workers, Supabase externo conectado (project ref `tkjbhttylouamqxnbfgv`).
- **[F]** URLs de produção/preview em uso: `origin-blossom-kit.lovable.app` (publicado), `project--<id>.lovable.app` (usado pelos crons), `unitos.sejaumpartner.com` (domínio real referenciado no código).
- **[I]** Não encontrei no repositório configuração de Vercel ou workflow de GitHub Actions; portanto "Lovable → GitHub → Vercel" é hoje **hipótese/intenção**, não estado comprovado. Acoplamentos práticos: URL de projeto Lovable nos crons, gateway Lovable de IA/conectores, secrets gerenciados pela plataforma, `SUPABASE_*` como prefixo reservado (daí o `SB_SERVICE_ROLE_KEY`).

## 14. Estratégia recomendada para white-label sem duplicar código

**[I]** Recomendação: **um único código-fonte, N instâncias configuradas em runtime** — nunca fork por cliente.

1. **Config na borda, não no bundle**: expor a configuração pública da instalação (URL Supabase, anon key, branding, módulos) via um endpoint/loader do próprio app ou variáveis `VITE_*` injetadas no build da instância; nada de secret server-side no cliente.
2. **Control Plane = provisionador + registry**: guarda, por instalação, o projeto Supabase, domínio, branding, módulos licenciados e versão do app; executa (a) criação do projeto, (b) aplicação de migrations versionadas, (c) seed de catálogos, (d) criação dos crons com URL/segredo daquela instalação, (e) registro do app Meta/domínio.
3. **Trocar anon key dos crons por um segredo de cron por instalação** (header verificado no handler `api/public/*`), removendo chaves do texto dos jobs.
4. **Migrations como artefato versionado** com "schema version" gravada no banco, para saber qual instalação está em qual release.
5. **Módulos comercializáveis** sobre o que já existe (`feature_catalog` + `brand_features`), com o Control Plane como fonte de verdade da licença e sincronização para cada instalação.
6. **Segredos por instalação em cofre**, com `BRAND_CREDENTIALS_SECRET` distinto por cliente, e credenciais de administração de curta duração (nunca service role de longa vida no Control Plane).
7. **Decidir cedo entre "Supabase por cliente" e "workspace por cliente no mesmo Supabase"**: o schema já suporta multi-brand; Supabase separado é isolamento máximo com custo operacional N× (extensões, crons, partições do Brain, migrations, Meta app/redirect).

## 15. Não mexer agora / pré-requisitos

**Não mexer agora**
- Cadeia de publicação Meta (placements → `social_posts` → sync → Kanban) e suas travas de escopo granular.
- Pipeline de pauta (geração → aprovação → materialização → tarefas) e suas idempotências.
- Brain (partições, `pgvector`, filas, retenção) e seus 7 jobs SQL.
- `auth-middleware.ts`, `client.server.ts`, `auth-attacher`/`start.ts` e o gate `_authenticated/route.tsx` (arquivos gerados/gerenciados).
- RLS e helpers security definer existentes.

**Pré-requisitos antes de construir o Control Plane**
1. Decidir o modelo de isolamento (Supabase por cliente vs. workspace por cliente).
2. Tornar a configuração do cliente Supabase env-driven (hoje hardcoded) — mudança pequena, mas bloqueante.
3. Definir o contrato de identidade de instalação (domínio, `APP_URL`, redirect Meta, remetente de e-mail).
4. Substituir a anon key nos crons por segredo de cron por instalação e padronizar autenticação de todos os `api/public/*`.
5. Definir política de segredos (cofre, rotação, `BRAND_CREDENTIALS_SECRET` por instalação).
6. Estabelecer versionamento de schema + processo repetível de migrations/seed para N projetos.
7. Inventariar o que é global-da-instalação vs. por-marca nas 17 tabelas sem tenancy e decidir onde cada catálogo mora.
8. Remover/isolar `seed-superadmins.ts` e a allowlist fixa de e-mails, trocando por bootstrap parametrizado.
9. Confirmar a arquitetura real de deploy (Vercel/Cloudflare/Lovable) — não há evidência no repositório.
10. Validar o multi-brand com dados reais (hoje 1 marca) antes de assumir que N instalações de 1 marca ≡ 1 instalação de N marcas.

## Confronto com auditorias antigas em `.lovable`

- **[F]** `.lovable/audit-full-system.md` (2026-08-14) aponta P0 de "duas taxonomias de formato", P1 de legado `brand_pautas` (58 linhas) e `post_placements`/`social_posts` com 0 registros. Sessões posteriores tocaram publicação, republicação e placements, e há registros de publicação bem-sucedida — logo **a parte "nunca exercida em produção" está desatualizada**; os achados de taxonomia e do legado `brand_pautas` **não foram verificados nesta auditoria** (fora do escopo pedido) e devem ser tratados como pendências em aberto, não como fatos atuais.
- **[F]** `unitos-project.md` é um snapshot de 20/07/2026 e descreve o Supabase como "Lovable Cloud"; o estado atual é **Supabase externo** (`tkjbhttylouamqxnbfgv`) com `SB_SERVICE_ROLE_KEY` por causa do prefixo reservado. Documento parcialmente desatualizado nesse ponto.
- **[I]** As demais auditorias por módulo (`audit-channels`, `audit-clients`, `audit-brain-2.0`…) descrevem estados anteriores a vários refactors registrados em `.lovable/plan/`; usar como histórico, não como verdade corrente.

---

Nada foi implementado. Próximo passo natural, quando você quiser: desenhar o Control Plane a partir das decisões dos itens 1 a 3 dos pré-requisitos.
