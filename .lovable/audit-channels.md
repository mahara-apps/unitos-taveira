# Auditoria — Arquitetura de Canais e Integrações (somente leitura)

## 1. Estrutura atual

- `social_connections` (owner = `brand_id`) guarda a conexão OAuth **e** o canal no mesmo registro. Tem também `client_id` (nullable) — um segundo caminho de vínculo cliente↔canal.
- `client_social_accounts` (brand_id, client_id, connection_id, unique(client_id, connection_id)) — vínculo N:N canal↔cliente. Hoje: **1 vínculo** (`cab7da1e… → cliente 475a42c5…`).
- `meta_oauth_sessions` — sessão OAuth temporária + portfólio (pages, threads_accounts, ad_accounts) descoberto.
- `post_placements` — destino real da peça; **connection_id vive dentro de `copy_override` (jsonb)**, não em coluna. `posts.target_connection_ids` (array) duplica essa informação.
- `social_posts` — fila de publicação com `connection_id` real (coluna).
- `brand_connections` — nada a ver com social (é config de provedores de IA). Não mexer.

## 2. Tabelas envolvidas

social_connections · client_social_accounts · meta_oauth_sessions · posts (`target_connection_ids`, `channels`) · post_placements (`copy_override.connection_id`) · social_posts · clients · brands · brand_members.

## 3. Fluxo atual

1. `Perfil do Cliente > Canais` (`src/components/customer/channels-tab.tsx`) **inicia OAuth Meta** (`startMetaOAuth`) e abre o `MetaPortfolioDialog` — conexão criada dentro do contexto operacional do cliente.
2. A mesma tela lista **todos** os canais da marca ("Disponíveis no workspace") com switch de vínculo (`listClientChannelAssignmentsFn` / `toggleClientChannelFn`).
3. `/connections` (1.593 linhas) mostra grid grande com TikTok/YouTube/LinkedIn/X/Threads não implementados.
4. Editor da peça e wizard de agendamento leem `client_social_accounts` → OK conceitualmente.
5. Worker (`api/public/meta/publish-scheduled.ts`) lê `social_connections` por `connection_id` de `social_posts`.

## 4. Problemas encontrados

1. **OAuth no contexto do cliente** (channels-tab) — viola a separação workspace/cliente.
2. **Lista global de canais exposta no perfil do cliente** (seção "Disponíveis no workspace").
3. **Dois modelos de vínculo concorrentes**: `social_connections.client_id` vs `client_social_accounts`. `resolveBrandChannelFn`, `checkBrandChannelExistsFn` e `social-core/resolver.server.ts` filtram por `client_id` da conexão (hoje NULL) → retornam "nenhuma conta conectada" mesmo com vínculo válido em `client_social_accounts`. **Esta é a causa do "nenhum canal social vinculado"**.
4. **IDs Meta trocados**: `publishing.server.ts` documenta `external_id = Page ID`, `account_id = IG Business Account ID`. A conexão real tem `external_id = account_id = 17841405663769537` (IG Business) e o Page ID (`639370953126346`) só em `metadata.page_id`. Instagram funciona (usa `account_id`); **facebook_feed publicaria contra o ID errado**. `meta.server.ts` também usa `external_id` como Page ID em profile/insights.
5. **`connection_id` dentro de jsonb** em `post_placements` — sem FK, sem índice, sem integridade; conversões improvisadas entre `copy_override.connection_id`, `posts.target_connection_ids` e `social_posts.connection_id`.
6. **RBAC**: RLS de `social_connections` e `client_social_accounts` concede INSERT/UPDATE/DELETE a **qualquer brand_member** (inclui editor/designer/client). `/connections` está na sidebar só de admin, mas o gate é cosmético.
7. Canais futuros ocupando protagonismo na UI; nenhuma reconciliação por ID externo oficial ao reconectar (risco de conexão duplicada).

## 5. Arquitetura recomendada (sem tabela nova)

- `social_connections` = **canal/ativo** pertencente ao workspace (`brand_id`). `client_id` passa a ser **deprecado** (parar de ler; manter coluna por compatibilidade).
- `client_social_accounts` = **única** fonte de vínculo canal↔cliente.
- Identificação Meta explícita em colunas/metadata canônicos: `provider`, `channel`, `external_id` (ID do ativo do canal: Page ID p/ facebook, IG Business ID p/ instagram), `account_id` (IG Business ID quando houver), `metadata.page_id`, `metadata.instagram_business_id`, `account_username`, `external_name`. Publisher passa a ler `page_id`/`instagram_business_id` explícitos, não adivinhar por `external_id`.
- `post_placements` ganha coluna `connection_id` (FK) + backfill do jsonb; `copy_override` continua para copy.
- Reconciliação por (`brand_id`, `provider`, `channel`, ID externo) → upsert, nunca nova conexão duplicada.
- Permissões: helper único `canManageIntegrations` (owner/manager/super_admin) + RLS restrita a esses papéis para INSERT/UPDATE/DELETE em `social_connections` e `client_social_accounts`.

## 6. Impacto

- Publicação Instagram: sem impacto (mesmo `account_id`).
- Facebook Feed: passa a usar Page ID correto (correção real).
- Peças/calendário: `resolveBrandChannelFn` e resolver do social-core passam a resolver via `client_social_accounts` → destino volta a aparecer.
- Telas `/connections` e `Perfil > Canais` refeitas; sidebar e demais telas intactas.
- Nenhum dado apagado; conexão `cab7da1e…` preservada com IDs externos.

## 7. Plano de implementação

1. **Migração**: `post_placements.connection_id` (FK + backfill do jsonb); backfill `metadata.instagram_business_id`/`page_id`; RLS de gestão restrita a owner/manager/super_admin; índice único de reconciliação.
2. **Meta IDs**: publisher e provider leem page_id/ig_id explícitos.
3. **Resolvers**: `client_social_accounts` como única fonte (`resolveBrandChannelFn`, `checkBrandChannelExistsFn`, `social-core/resolver.server.ts`).
4. **Permissões**: server fns de conectar/desconectar/vincular exigem admin/gestor.
5. **UI Integrações**: cards "Integrações conectadas" + "Canais disponíveis" + seção discreta "Em breve".
6. **UI Perfil > Canais**: só canais vinculados; botão "Vincular canal existente" (sem OAuth) para autorizados.
7. **Testes**: leitura + funcional (Café Aurora vê só @leodaacademia_; cliente B não vê; operacional não conecta; reexecução não duplica).
