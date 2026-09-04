# Auditoria READ-ONLY — Workspace/Instalação vs. Brand/Agência

Data: 2026-08-29 · Nenhuma alteração executada (sem DDL, DML, migration, código ou RLS).

## 1. ESTADO ATUAL

### 1.1 Números do banco

| Métrica | Valor |
|---|---|
| Colunas `brand_id` no schema `public` | 69 |
| FKs apontando para `brands` | **65** |
| Tabelas/colunas com nome `workspace_id` / `tenant_id` / `installation_id` / `org_id` | **0** (o único `account_id` é `social_connections.account_id` = ID da conta na Meta, conceito D) |
| Tabelas com nome `%workspace%`, `%tenant%`, `%install%`, `%organization%` | **nenhuma** |
| Policies em `public` | 198, das quais **134 referenciam `brand`** |
| Funções SQL que consultam `brand_members` | 14 |
| `brands` | 595 (595 ativas) — a esmagadora maioria é resíduo efêmero de testes |
| `clients` | 720, distribuídos em 358 brands |
| `brand_members` | 988; **184 usuários pertencem a mais de uma brand** |
| Brands com `app_url` | **2** |
| Brands com qualquer logo (`logo_url`/`login_logo_url`/`logo_dark_url`) | **1** |
| Brands com dados cadastrais (`cnpj`/`razao_social`) | **1** |
| Brands com credenciais de integração (`brand_api_credentials`) | **1** |

Leitura direta: existe **uma** instalação real com identidade, domínio, credenciais e dados cadastrais; todo o resto é escopo criado por suíte de integração.

### 1.2 `brands` — colunas e o que cada grupo significa

```
identidade técnica ..... id, slug, created_by, created_at, updated_at
estado da instalação ... is_active, inactivated_at
domínio/URL ............ app_url                       ← instalação
identidade visual ...... logo_url, logo_dark_url, icon_url, login_logo_url, color
dados cadastrais ....... cpf, cnpj, nome_fantasia, razao_social
endereço ............... cep, rua, numero, complemento, bairro, cidade, estado
rótulo ................. name
```

Ou seja: **uma única tabela carrega, ao mesmo tempo, o limite de isolamento (id/slug/is_active), o endereço público da instalação (app_url) e a identidade comercial da agência (razão social, CNPJ, endereço, logos)**.

### 1.3 `brands.id` funcionando como `workspace_id`

Evidências no código (não é interpretação — está escrito):

- `src/lib/workspace-admin.ts` — cabeçalho: *"Ações administrativas do WORKSPACE (= `brands`, identidade da instalação)"*. Matriz super_admin/owner/admin/manager/user aplicada sobre `brand_members.role`.
- `src/lib/workspace.functions.ts` — `listMyBrands`, `createBrand`, `updateBrand`, `setBrandActive`, `deleteBrand`: são as operações de ciclo de vida do workspace. Na mesma função, `updateBrandCompany`/`getBrandCompany` tratam a MESMA linha como cadastro da agência.
- `src/lib/active-workspace.ts` — fonte canônica do "workspace ativo" armazena um `brandId`.
- `src/lib/access-guard.ts` — `assertBrandAdmin`, `assertBrandMember`, `assertClientScope`: mensagens de erro em termos de workspace (*"você não pertence a este workspace"*, *"cliente não pertence a este workspace"*); `brandId` é obrigatório porque *"não existe autoridade administrativa fora de um workspace"*.
- `src/lib/installation-url.server.ts` — grava/consulta `brands.app_url` e loga *"URL da instalação desconhecida para o workspace `<brandId>`"*. **O domínio da instalação é uma coluna de `brands`.**
- `src/lib/meta/installation.server.ts` / `provider.server.ts` / `signed-request.server.ts` — multi-instalação Meta: *"cada instalação tem seu próprio domínio"*, segredo de state por instalação, replay de webhook para instalações irmãs. A unidade de instalação nessas rotinas é a brand.
- `src/lib/evolution/scope.server.ts` — *"garantindo que ela pertence ao workspace informado"* (`brand_id`); `config.server.ts` resolve config com `source: { baseUrl: "workspace" | "instalação" }`.
- `src/lib/login-branding.functions.ts` — resolve a logo de login por `LOGIN_BRAND_ID`/`LOGIN_BRAND_SLUG`, e sem isso só aceita *"instalação de marca única"*. **Premissa explícita de 1 brand = 1 instalação**, em contradição com os 184 usuários multi-brand e com o seletor de workspace.
- `src/lib/social-analytics/cache.ts` — *"`scope` deve identificar workspace/usuário para evitar cross-workspace leak"*.

### 1.4 Classificação de cada uso de `brand_id`

**A — Workspace/tenant/instalação (isolamento puro).** `brand_id` só existe para delimitar o inquilino; o objeto não fala da agência.
`activity_events`, `notifications`, `brand_features`, `brand_invites`, `brand_members`, `feature/entitlement`, `ai_jobs`, `ai_usage_limits`, `agent_prompt_overrides`, `brain_events`, `brain_embeddings`, `brain_memory`, `brain_insights`, `brain_recommendations`, `brain_relationships`, `brain_metrics_snapshots`, `chat_conversations`, `message_logs`, `message_templates`, `sla_rules`, `evolution_instances`, `evolution_events`, `meta_oauth_sessions`, `social_connections`, `social_posts`, `post_placements`, `posts`, `projects`, `project_jobs`, `project_templates`, `tasks`, `task_comments`, `task_subtasks`, `task_time_entries`, `calendar_events`, `content_pipelines`, `media_plans`, `monthly_plans`, `monthly_plan_tokens`, `plan_overage_requests`, `card_approval_tokens`, `card_approval_events`, `client_briefing_tokens`, `client_journey_events`, `client_members`, `client_documents`, `client_social_accounts`, `brand_cohorts`, `brand_journey_stage_templates`, `brand_api_credentials`, `brand_connections`, `brand_ai_usage`, `brand_ai_content`, `brand_ai_versions`, `brand_briefing_requests`, `brand_briefing_versions`, `brand_briefing_proposals`, `whatsapp_recipients`, `clients`.

Observação relevante: as tabelas com prefixo `brand_` **que também têm `client_id`** — `brand_briefings`, `brand_personas`, `brand_swot`, `brand_competitors`, `brand_voice_cards`, `brand_pautas`, `brand_media_assets` — descrevem a marca **do cliente**, não a da agência. O prefixo `brand_` é histórico e enganoso: nelas `brand_id` é puramente tenant (A) e a identidade comercial mora em `client_id`.

**B — Marca/agência/identidade comercial.** Apenas as colunas de identidade dentro de `brands` e quem as consome: `branding.functions.ts`, `login-branding.functions.ts`, `admin-environment.functions.ts`, `branding-slots.tsx`, `settings.identity.tsx`, `getBrandCompany`/`updateBrandCompany`, remetente de e-mail em `email/resend.server.ts`, variáveis de template em `message-templates/context.server.ts`. Nenhuma tabela separada.

**C — Ambos misturados.** A própria tabela `brands` e sua linha: `brands.id` é o tenant, `brands.app_url` é a instalação, `brands.razao_social/cnpj/endereço/logos` é a agência. `settings.identity.tsx` (área "Agência") expõe as três dimensões na mesma tela. `deleteBrand` apaga simultaneamente o tenant, a instalação e a identidade.

**D — Outro conceito.** `social_connections.account_id` (conta externa Meta); `LOGIN_BRAND_ID`/`LOGIN_BRAND_SLUG` usados como "esta instalação" em vez de "este tenant".

## 2. RESPOSTAS DIRETAS

**`brands` é atualmente o workspace do sistema?** Sim, sem ambiguidade. É o único limite de isolamento: 65 FKs, 134 policies, 14 funções de autoridade, o seletor lateral, o cache de escopo e todos os guards giram em torno de `brand_id`. O código nomeia isso explicitamente como workspace.

**Existe algum conceito de workspace oculto ou equivalente?** Não no banco — zero colunas `workspace_id`/`tenant_id`/`installation_id` e zero tabelas equivalentes. Existe um **conceito paralelo semi-oculto de "instalação"** em três lugares: `brands.app_url`, os envs `LOGIN_BRAND_ID`/`LOGIN_BRAND_SLUG` e as rotinas multi-instalação da Meta. Ele não é uma entidade; é um punhado de atributos pendurados em `brands`.

**Há mistura entre identidade da agência e isolamento da instalação?** Sim, e ela é real, não estética. Três sintomas concretos:
1. `login-branding` assume "instalação de marca única" enquanto o produto oferece seletor de workspace e tem 184 usuários multi-brand — o login pode não ter logo determinística quando há mais de uma brand com `login_logo_url`.
2. Identidade visual é exclusiva de Super Admin (`canAccessVisualIdentity`) porque na prática ela é da **instalação**, não da brand; mas fica na mesma linha que Owner/Admin podem editar via `updateBrand`/`updateBrandCompany`. Duas autoridades diferentes sobre uma única linha.
3. `app_url` é por brand, então duas brands na mesma instalação podem produzir links canônicos divergentes — ou nenhum, quando `app_url` é nulo (593 de 595 casos).

**Criar uma tabela `workspaces` resolveria um problema real?** **Não.** Seria uma migração de altíssimo custo (65 FKs, 134 policies, 14 funções, 69 colunas, RLS inteira, seletor, cache de escopo, guards, Brain, Portal) para reconstruir exatamente a semântica que `brands` já tem. O problema real medido **não é a falta de uma entidade workspace** — é o **excesso de responsabilidades dentro de `brands`**. Renomear ou duplicar a tabela não resolve isso; separar atributos resolve.

**Existem conceitualmente dois objetos diferentes?** Sim — mas o segundo objeto **não é "Workspace"**, é **"Instalação/Deployment"**, e ele é **1 por banco de dados**, não 1 por brand. O recorte correto é:

- **Workspace/Tenant** = `brands` (já existe, é correto, tem membership, RBAC e RLS maduros).
- **Brand/Agência (identidade comercial)** = atributos cadastrais + visuais, hoje colados em `brands`; conceitualmente um perfil 1:1 do workspace.
- **Instalação** = domínio, logo de login, remetente de e-mail, branding institucional. **Singleton da instância**, hoje inferido de `brands.app_url` + envs.

O erro arquitetural, portanto, é o inverso do que a pergunta supõe: não falta um workspace acima de `brands`; falta extrair de `brands` um **singleton de instalação** abaixo/ao lado dele.

## 3. PROBLEMAS

1. `brands` acumula tenant + instalação + identidade comercial (violação de responsabilidade única, com autoridades RBAC distintas sobre a mesma linha).
2. `app_url` por brand: multi-brand na mesma instalação gera links canônicos divergentes; 593 brands sem `app_url` dependem do host da requisição (que funciona, mas deixa cron/worker sem URL).
3. `login-branding` pressupõe brand única — premissa quebrada pelo próprio produto.
4. Prefixo `brand_` em tabelas que descrevem a marca **do cliente** (`brand_personas`, `brand_swot`, `brand_voice_cards`, `brand_briefings`, `brand_pautas`, `brand_competitors`, `brand_media_assets`) — confusão de leitura permanente para quem audita RLS.
5. 595 brands para 1 instalação real: o resíduo de testes polui contagens, o seletor e qualquer heurística de "instalação de marca única".
6. `deleteBrand` é uma operação que apaga tenant + identidade + configuração de instalação de uma vez, sem separação de gravidade.

## 4. ARQUITETURA RECOMENDADA

**Manter `brands` como workspace/tenant. Não criar `workspaces`.** Extrair o singleton de instalação.

```text
installation (singleton, PK id, CHECK singleton)   ← NOVA, ~8 colunas
  ├─ app_url            (domínio canônico da instância)
  ├─ login_logo_url, icon_url, logo_url, logo_dark_url  (branding institucional)
  ├─ email_from, email_from_name
  └─ autoridade: SUPER ADMIN apenas

brands  = WORKSPACE/TENANT  (inalterado como limite de isolamento)
  ├─ id, slug, name, is_active, inactivated_at, created_by
  ├─ perfil comercial: razao_social, nome_fantasia, cnpj, cpf, endereço, color
  │    autoridade: Owner/Admin (já é o caso via updateBrandCompany)
  ├─ brand_members  → RBAC (super_admin/owner/admin/manager/user)
  └─ 65 FKs `brand_id` → PERMANECEM COMO ESTÃO

clients = marca/identidade comercial DO CLIENTE (logos, brand_hub, portal_theme)
```

Nada de `workspace_id`: **nenhuma tabela deveria migrar de `brand_id` para `workspace_id`.** As 65 FKs já estão semanticamente corretas.

O que muda de dono:
- `brands.app_url`, `login_logo_url`, `icon_url`, `logo_url`, `logo_dark_url` → `installation` (leitura pública restrita; escrita Super Admin).
- `brands.razao_social/nome_fantasia/cnpj/cpf/cep/rua/numero/complemento/bairro/cidade/estado/color` → **continuam em `brands`** (são da agência-tenant, editáveis por Owner/Admin).
- `LOGIN_BRAND_ID`/`LOGIN_BRAND_SLUG` → deixam de existir; a logo de login vem do singleton.

Impacto em RBAC/RLS: **zero** nas 134 policies escopadas por `brand_id`. Só entra uma policy nova em `installation` (SELECT das colunas públicas; escrita apenas Super Admin), e `updateBrandBranding` passa a escrever no singleton — o gate `canAccessVisualIdentity` já está no lugar correto e não muda.

Impacto no frontend/seletor: nenhuma mudança de comportamento. O seletor continua listando `brands`. `settings.identity.tsx` se separa em "Agência" (dados do workspace, Owner/Admin) e "Instalação" (branding + domínio, Super Admin) — o que já é o comportamento efetivo hoje, só passa a bater com o modelo de dados.

## 5. PLANO DE MIGRAÇÃO (proposta — nada executado)

1. **Higiene de dados**: expurgar brands residuais de testes (595 → real), com aprovação explícita. Pré-requisito de qualquer heurística de instalação.
2. **Criar `installation`** (singleton, com GRANTs e RLS: SELECT das colunas de branding, escrita só Super Admin) e semear a partir da única brand que hoje tem `app_url`/logos.
3. **Redirecionar leituras**: `installation-url.server.ts`, `app-url.server.ts` (fallback fora de request), `login-branding.functions.ts`, `email/resend.server.ts`, `message-templates/context.server.ts`, `branding.functions.ts`, `admin-environment.functions.ts` passam a ler o singleton; manter fallback para `brands` durante uma release.
4. **Redirecionar escritas**: `updateBrandBranding` → `installation`. `updateBrand`/`updateBrandCompany` ficam só com identidade comercial do tenant.
5. **Separar a UI** de `settings.identity.tsx` em Agência (tenant) × Instalação (Super Admin).
6. **Remover colunas migradas de `brands`** e os envs `LOGIN_BRAND_ID`/`LOGIN_BRAND_SLUG` só após uma release inteira sem leitura de fallback.
7. **Opcional/independente**: renomear as tabelas `brand_*` que carregam `client_id` para prefixo `client_*` (correção de legibilidade, alto custo de churn — recomendo tratar como item separado, não junto).

## 6. RISCOS

| Risco | Gravidade | Mitigação |
|---|---|---|
| Perder a URL canônica no meio da migração → convites/links quebrados | **alta** | manter `app-url.server.ts` derivando do host da requisição (já é a fonte primária) e só depois trocar o fallback |
| Logo de login sumir na tela pública | média | fallback institucional já existe em `brand-logo.tsx`/`unitos-wordmark.tsx` |
| Remetente de e-mail perder configuração | média | migrar `installation` antes de tocar em `resend.server.ts`, com fallback duplo |
| Tentar criar `workspaces` e migrar 69 colunas | **crítica** | não fazer: 65 FKs + 134 policies + 14 funções + Brain + Portal, sem ganho funcional |
| Expurgo de brands de teste atingir dado real | alta | seleção por critério explícito, revisão manual dos IDs e aprovação antes de qualquer DELETE |
| Divergência temporária entre `brands.logo_url` e `installation.logo_url` | baixa | ordem de leitura única e determinística (singleton primeiro), sem merge |

**Conclusão em uma linha:** `brands` **é** o workspace do Unitos e deve continuar sendo; criar `workspaces` seria migração pura sem ganho. O objeto que realmente falta é um **singleton de Instalação** (domínio + branding institucional + remetente), hoje indevidamente hospedado em `brands`.
