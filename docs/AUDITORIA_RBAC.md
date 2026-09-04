# Auditoria técnica — Usuários, Roles, Permissões e Escopos (read-only)

Snapshot: 18/08/2026. Nenhum código, banco, RLS ou dado foi alterado.

Papéis oficiais de referência: **SUPER ADMIN**, **ADMIN** (dono da agência), **MANAGER** (gerente de contas), **USER** (operação), **CLIENTE** (portal).

---

## 1. Modelo atual (como o sistema funciona hoje)

### 1.1 Fontes de role existentes (são 6, não 1)

| # | Fonte | Onde vive | Usada por | Observação |
|---|-------|-----------|-----------|------------|
| 1 | `brand_members.role` (enum `app_role`: owner, manager, editor, designer, client) | banco | RLS (`has_brand_role`), server fns, UI | fonte principal de autoridade por marca |
| 2 | `brand_members.permissions` (JSONB) | banco | `src/lib/permissions.ts` (`hasPermission`) | gating cosmético; **nenhuma RLS lê** |
| 3 | `user_profiles.is_super_admin` (bool) | banco | `is_super_admin(uuid)` | bypass total |
| 4 | `user_profiles.role` (texto livre: `admin`, `super_admin`, `editor`…) | banco | `is_super_admin(uuid)` (`role='super_admin'`), `handle_new_user` | paralelo ao `brand_members.role`; sem enum |
| 5 | `is_super_admin()` sem args — allowlist de e-mails hardcoded (`apitadadigital@gmail.com`, `jose@mahara.marketing`) | função SQL | policies antigas + `resolveIsSuperAdmin` | hardcode incompatível com white-label |
| 6 | `client_members.role` (texto: `portal_client` e valores internos) | banco | `can_access_client`, gate do portal | mistura papel de cliente final com escopo interno |

Escopos existentes: `client_members` (escopo interno por cliente **e** vínculo de portal), `clients.owner_user_id` (responsável pela conta), `brand_features`/`feature_catalog` (módulos por marca), `ai_usage_limits` (orçamento por marca/cliente/usuário).

Derivação na UI: `resolveAccessRole()` colapsa tudo em **admin | user** (`owner|manager|admin → admin`; resto → `user`), consumido por `useAccessRole` + `SIDEBAR_ALLOWED_URLS`. Portanto **MANAGER e ADMIN são indistinguíveis no frontend**.

### 1.2 Escopo por cliente (regra real, no banco)

`can_access_client(client_id, user)`:
1. super admin → true;
2. se existir **qualquer** vínculo interno em `client_members` para aquele cliente (role ≠ `portal_client`), então só quem estiver listado acessa;
3. caso contrário → qualquer membro da marca acessa.

Consequência: o escopo é **opt-in por cliente**, não por papel. Um USER vê todos os clientes sem vínculo interno. `clients.owner_user_id` **não** participa da RLS.

`useAccessRole` faz o oposto no frontend: para role `user`, restringe a lista aos clientes onde `owner_user_id = eu` — regra que o banco ignora (4 de 8 clientes hoje estão sem responsável).

### 1.3 Quem cria/edita/remove/convida usuários

| Ação | UI | Server fn | RLS |
|------|----|-----------|-----|
| Convidar membro | aba Equipe visível a `admin` (owner+manager) | `inviteBrandMembers` exige owner **ou** manager | `brand_invites`: owner ou manager |
| Aceitar convite | pública | `accept_brand_invite` (SECURITY DEFINER, valida e-mail/expiração/revogação) | escreve `brand_members` ignorando policy |
| Editar papel/permissões de membro | `admin` | `updateBrandMember` — **sem checagem explícita de papel** | `brand_members`: **somente owner** |
| Remover membro | `admin` | `removeBrandMember` — sem checagem | somente owner |
| Criar conta de portal (cliente) | Equipe/Contas | `portal-accounts.functions.ts` via `supabaseAdmin` (bypassa RLS) | — |
| Criar cliente | qualquer membro | `createClient` | `clients` ALL para **qualquer** `is_brand_member` |
| Editar dados básicos do cliente | `admin` | `updateClient` exige owner/manager | qualquer membro da marca |
| Excluir cliente | `admin` na UI | `deleteClient` | qualquer membro da marca |
| Criar marca | qualquer autenticado | `createBrand` | `brands` INSERT livre; trigger `add_brand_owner` dá owner |

### 1.4 Acesso por domínio (estado atual)

- **Projetos/Tarefas/Conteúdo/Pauta/Posts**: policy única `ALL` por `can_access_client` (ou `is_brand_member` quando `client_id` é nulo). Não há distinção leitura/escrita, nem papel: um designer pode apagar projeto.
- **Canais (`social_connections`, `client_social_accounts`)**: leitura para membros; escrita só owner/manager/super — **o único domínio com RBAC correto**.
- **IA**: `ai_usage_limits` restrito por `can_manage_brand_ai_limits`; chaves BYOK em `brand_api_credentials`; consumo aplicado por `check_ai_usage_budget`.
- **Configurações**: `brands` UPDATE só owner (⚠️ manager edita via server fn `updateBrandCompany`, que aceita manager → conflito direto com a RLS); `sla_rules` write owner/manager; `brand_features`/`feature_catalog` write só super admin.
- **Portal do cliente**: gate em `_authenticated/route.tsx` redireciona quem é `portal_client` sem `brand_members` para `/area/inicio`; rotas `/portal/$token` seguem por token.

---

## 2. Conflitos encontrados

1. **Role sem fonte única**: 6 fontes concorrentes (1.1). `user_profiles.role` e `brand_members.role` podem divergir (hoje: 2 owners em brand_members × 2 `admin` + 1 `super_admin` em user_profiles).
2. **Super admin por e-mail hardcoded** em função SQL — impede white-label e cria caminho de privilégio fora do banco de dados de papéis.
3. **MANAGER não existe como nível**: `resolveAccessRole` funde owner+manager em `admin`; toda a UI trata gerente como dono.
4. **Manager × RLS de `brand_members`**: UI e server fn permitem manager convidar/editar membros, mas a policy só autoriza owner → operação falha ou depende de caminho DEFINER. Mesmo padrão em `brands` (server aceita manager, RLS exige owner).
5. **`updateBrandMember` / `removeBrandMember` sem autorização no servidor** — dependem exclusivamente da RLS; qualquer regressão de policy abre escalonamento de papel.
6. **Escopo divergente frontend × banco**: frontend usa `owner_user_id`; banco usa `client_members`. Resultado: usuário vê lista curta na tela de clientes mas consegue ler/escrever dados de outros clientes por rotas diretas e server fns.
7. **`clients` com `ALL` para qualquer membro da marca**: designer pode criar e excluir cliente; contradiz a UI e o papel USER.
8. **Sem separação leitura/escrita** em projetos, tarefas, conteúdo, pauta.
9. **`brand_members.permissions` é decorativo**: granularidade exibida em Configurações → Permissões sem enforcement em RLS/server.
10. **`client_members` acumula dois conceitos** (escopo interno + identidade de cliente final) diferenciados por string mágica `portal_client`, sem enum nem constraint.
11. **Papel `client` no enum `app_role`** nunca é usado em `brand_members` — cliente final vive em `client_members`. Ambiguidade semântica.
12. **`handle_new_user`** aceita `role` vindo de `raw_user_meta_data` (`admin`, `manager`, `sdr_operator`…), permitindo autoatribuição de papel global no signup.
13. **Políticas com `roles:{public}`** (clients, posts, tasks, projects, activity_events, monthly_plans, client_members) — funcionam pelo `auth.uid()`, mas expõem superfície ao role `anon` caso algum GRANT mude.

---

## 3. Fonte de verdade recomendada para role

**Papel = `brand_members.role`** (enum `app_role`), único por (brand, user). Exceção: **SUPER ADMIN = `user_profiles.is_super_admin`** apenas (coluna booleana), removendo allowlist de e-mail e `user_profiles.role` do caminho de decisão.

Mapeamento oficial:

| Papel oficial | Fonte | Enum sugerido |
|---|---|---|
| SUPER ADMIN | `user_profiles.is_super_admin = true` | — |
| ADMIN | `brand_members.role` | `owner` (renomeável para `admin` em fase posterior) |
| MANAGER | `brand_members.role` | `manager` |
| USER | `brand_members.role` | `editor` / `designer` (especialidade = metadado, não autoridade) |
| CLIENTE | `client_members.role = 'portal_client'` | tabela dedicada de portal |

`user_profiles.role` passa a ser **rótulo de especialidade** (Designer, Social Media, Tráfego) sem efeito de autoridade; `brand_members.permissions` torna-se opcional (refinamento **dentro** do papel, nunca elevação).

---

## 4. Escopo recomendado por papel

| Papel | Escopo (onde exerce autoridade) | Mecanismo |
|---|---|---|
| SUPER ADMIN | plataforma inteira | `is_super_admin(uuid)` |
| ADMIN | toda a marca | `brand_members` (owner) |
| MANAGER | clientes sob responsabilidade | união de `clients.owner_user_id = uid` **+** `client_members` interno; fallback: toda a marca só se explicitamente marcado |
| USER | clientes/projetos atribuídos | `client_members` interno + atribuição de tarefa/projeto |
| CLIENTE | um cliente | `client_members.role='portal_client'` ou token de portal |

Regra: **role** decide o verbo (ler/editar/administrar); **escopo** decide as linhas. Nenhum papel deve depender de "ausência de vínculo" para ampliar acesso — hoje é o oposto (1.2).

---

## 5. Matriz resumida de acesso (alvo)

| Domínio | SUPER ADMIN | ADMIN | MANAGER | USER | CLIENTE |
|---|---|---|---|---|---|
| Marcas (criar/editar) | total | editar própria | ler | ler | — |
| Membros/convites | total | CRUD | convidar/editar USER apenas | ler equipe | — |
| Clientes | total | CRUD | CRUD nos seus | ler atribuídos | próprio (portal) |
| Projetos | total | CRUD | CRUD no escopo | criar/editar atribuídos, sem excluir | ler aprovado |
| Tarefas/Subtarefas | total | CRUD | CRUD no escopo | editar atribuídas | — |
| Conteúdo/Pauta | total | CRUD + aprovar | CRUD + aprovar no escopo | criar/editar, sem aprovar | aprovar próprio |
| Canais/Integrações | total | conectar/remover | vincular a seus clientes | ler | — |
| IA (chaves, limites) | total | configurar | ver consumo, usar | usar dentro do limite | — |
| Configurações da marca | total | total | SLA e notificações | perfil próprio | — |
| Feature flags | total | ler | ler | — | — |
| Auditoria/Logs | total | marca | escopo | próprias ações | — |

---

## 6. Manter / corrigir / remover

**Manter**
- `brand_members` como tabela de papel + `has_brand_role` / `is_brand_member`.
- Padrão RBAC de `social_connections` e `client_social_accounts` (modelo a replicar).
- `ai_usage_limits` + `check_ai_usage_budget`; `brand_features` restrito a super admin.
- Gate de portal em `_authenticated/route.tsx` e fluxo `accept_brand_invite`.

**Corrigir**
- `resolveAccessRole` → três níveis (`admin | manager | user`) + escopo separado.
- Unificar escopo por cliente em uma função só (`can_access_client`) que considere `owner_user_id` e vínculos, e usar a **mesma** verdade no frontend.
- Alinhar manager: `brand_members` policy (owner→owner/manager com restrição de não editar owner), `brands` update, `updateBrandCompany`.
- Adicionar autorização explícita em `updateBrandMember`, `removeBrandMember`, `deleteClient`, `createClient`.
- Separar SELECT de INSERT/UPDATE/DELETE em `clients`, `projects`, `tasks`, `posts`.
- Restringir `handle_new_user` para sempre criar perfil sem autoridade.
- Trocar policies `roles:{public}` por `TO authenticated`.

**Remover**
- `is_super_admin()` com allowlist de e-mails (hardcode).
- `user_profiles.role` como fonte de autoridade (mantém-se como especialidade).
- Papel `client` do uso em `brand_members`.
- Tela/aba de permissões granulares fictícias enquanto não houver enforcement (ou implementá-las de fato).

---

## 7. Plano de implementação e testes (proposta, para aprovação)

**Fase 1 — Fonte única (sem mudança de comportamento visível)**
1. `resolveRole()` central em `src/lib/permissions.ts` retornando `super_admin | admin | manager | user | client` + `scope`.
2. Server fn única `getMyAccessFn` (role + brandIds + clientIds) consumida por `useAccessRole`.
3. Congelar `user_profiles.role` como especialidade.

**Fase 2 — Escopo determinístico**
4. Nova função SQL de escopo consolidada; frontend passa a ler o mesmo cálculo.
5. Backfill: garantir `owner_user_id` e/ou `client_members` para todo cliente antes de fechar a regra (hoje 4 clientes sem responsável).

**Fase 3 — RLS por verbo**
6. Split SELECT/WRITE nas tabelas operacionais; escrita destrutiva só admin/manager.
7. `brand_members` gerenciável por manager com guarda anti-escalonamento.
8. Remoção da allowlist de e-mail.

**Fase 4 — Servidor e UI**
9. Guardas explícitas em todas as server fns de mutação sensível.
10. Sidebar/rotas por três níveis; Permissões granulares implementadas ou retiradas.

**Testes**
- Matriz automatizada: para cada papel × domínio × verbo, um teste de integração autenticado esperando permitir/negar (extensão de `tests/*.integration.test.ts`).
- Anti-escalonamento: manager não promove ninguém a owner; USER não altera `brand_members`.
- Escopo: USER sem vínculo recebe 0 linhas em clients/projects/tasks/posts (hoje falha).
- Portal: `portal_client` nunca alcança rotas internas nem lê outro cliente.
- Regressão: super admin mantém bypass após remoção da allowlist.
