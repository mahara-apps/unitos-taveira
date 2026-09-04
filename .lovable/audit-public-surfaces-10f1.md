# FASE 10F.1 — Auditoria read-only das superfícies públicas

Data: 2026-08-25 (UTC). Escopo: `/api/public/approval/$token`, `media_plans.share_token`, `getLoginLogoFn`.
Nada foi alterado: sem código, banco, migration, RLS, policy, grant, UI, Portal, Storage, RBAC, Brain, message_logs, projects/tasks, activity_events.

Legenda de confiança: **[C]** confirmado por código/banco · **[T]** confirmado por teste · **[I]** inferido · **[N]** não verificável neste ambiente.

## 1. Resumo executivo

- **P0: 0.** **P1: 0.** Nenhuma superfície permite acesso cross-client ou cross-workspace: em todas as três, o recurso é derivado do próprio token (ou não recebe identificador algum). **[C]**
- **P2: 5.** Ausência total de rate limit/anti-brute-force/anti-replay nas três superfícies; CORS `*` com `POST` na rota de aprovação; token de aprovação continua válido e reutilizável após a decisão; payload da aprovação expõe campos internos (`script`, `references`, `reference_media`, `client_id`); `getLoginLogoFn` seleciona a marca "mais recentemente atualizada" entre 337 brands do banco, sem vínculo com host/instância, e emite URL assinada de storage privado a qualquer anônimo, sem limite. **[C]**
- **P3: 3.** `share_token` de plano de mídia sem expiração e sem rotação obrigatória; planos `archived` continuam acessíveis pelo link; tokens de QA com padrão previsível (`brain22-t1-…`) presentes na base. **[C]**
- Entropia dos tokens gerados pelo código é adequada (≈144–160 bits). O risco real está em ausência de limitação de taxa e em ciclo de vida (revogação/expiração), não em previsibilidade. **[C]**

## 2. `/api/public/approval/$token`

Cadeia mapeada (nenhum consumidor fora desta lista): **[C]**

| Camada | Arquivo |
| --- | --- |
| Emissão/listagem/revogação (autenticada) | `src/lib/approval.functions.ts` (`createApprovalTokenFn`, `listApprovalTokensFn`, `revokeApprovalTokenFn`, todas com `requireSupabaseAuth`) |
| Rota pública | `src/routes/api/public/approval.$token.ts` (`GET`, `POST`, `OPTIONS`) |
| UI pública | `src/routes/approval.$token.tsx` (fetch direto na rota acima) |
| Tabelas | `public.card_approval_tokens`, `public.card_approval_events`, `public.posts` |
| Migrations | `20260714145659_…` (DDL/RLS), `20260824115706_…` (RLS por escopo de cliente) |

### 2.1 Token

| Item | Situação |
| --- | --- |
| Criação | `randomToken(40)` com `crypto.getRandomValues` (20 bytes → hex) em `approval.functions.ts:14`. **[C]** |
| Entropia | 160 bits. Não previsível. **[C]** |
| Armazenamento | **texto puro** em `card_approval_tokens.token` (sem hash). `UNIQUE`. **[C]** |
| Expiração | Sim, `expires_at` obrigatório na criação (default 14 dias, máx. 90). Validada em `GET` e `POST`. **[C]** |
| Revogação | Sim, `revoked_at` via `revokeApprovalTokenFn`; validada nas duas rotas. **[C]** |
| Após aprovação | **Continua válido** — nada marca `revoked_at` ao decidir; o mesmo link pode aprovar/pedir ajuste repetidamente e gerar N eventos. **[C]** (P2) |
| Recurso excluído | `posts` com `deleted_at` → `404` no `GET`. Porém o `POST` **não checa `deleted_at`**: grava evento e faz `UPDATE` em post logicamente excluído. **[C]** (P2, sem cross-tenant) |
| Reutilização | Ilimitada dentro da validade. **[C]** |
| Enumeração/brute force | Espaço de 160 bits torna enumeração inviável; porém não há rate limit nem bloqueio por IP, então tentativas são ilimitadas e não observáveis. **[C]** (P2) |
| Dados na base | 3 tokens, todos com `expires_at`, nenhum revogado, **19 chars com prefixo previsível** (`brain22-t1-7cf0ca1a`) — seeds de QA, não gerados pelo código. **[C]** (P3) |

### 2.2 Autorização

O token é a única credencial e resolve `post_id` + `brand_id` do próprio registro. Não há parâmetro de cliente/workspace vindo do requisitante, logo não existe superfície para pivotar entre tenants. **[C]**

| Cenário | Esperado | Atual | Evidência |
| --- | --- | --- | --- |
| Token válido | acesso à peça vinculada | OK | código, `GET`/`POST` filtram por `tok.post_id` **[C]** |
| Token inexistente | negado | `404 invalid token` | **[C]** |
| Token expirado | negado | `410` em ambos os verbos | **[C]** |
| Token revogado | negado | `410` em ambos os verbos | **[C]** |
| Token do cliente A → recurso do cliente B | negado | impossível: `post_id` vem do token | **[C]** |
| Token do workspace A → workspace B | negado | impossível: `brand_id` vem do token | **[C]** |
| Recurso excluído | negado | `GET` nega; **`POST` aceita** | **[C]** (P2) |
| Após mudança de status | idealmente encerrado | continua permitindo nova decisão | **[C]** (P2) |

### 2.3 CORS

`access-control-allow-origin: *`, métodos `GET, POST, OPTIONS`, header `content-type`, sem `credentials`. **[C]**
Necessidade real: nenhuma — a página consumidora é do próprio domínio (`/approval/$token`, fetch relativo). Com `*` + `POST`, qualquer origem pode disparar decisão desde que conheça o token (ex.: página que recebeu o link, extensão, referer vazado). Não há elevação de privilégio nem leitura de dados de terceiros. **P2**. **[C]**

### 2.4 Rate limiting

Nenhuma proteção em nenhuma camada: sem rate limit, sem contador por IP/token, sem nonce/idempotência, sem CAPTCHA. Busca por `rate limit` no repositório retorna apenas o cooldown de UI (`use-refresh-cooldown.ts`), irrelevante aqui. **[C]** → **P2** (replay/flood de eventos de aprovação e enumeração não observável).

### 2.5 Dados retornados (inventário exato)

`GET` devolve `post` com: `id, client_id, title, copy, format, channels, scheduled_at, cover_url, client_briefing, script, references, reference_media, review_status`, mais `client.name` e `token.{id, expires_at}`. **[C]**

- Não expõe: outros clientes, usuários, credenciais, tokens de terceiros, configurações, auditoria, chaves de IA. **[C]**
- Expõe além do necessário para o fluxo público: `client_id` e `token.id` (IDs internos), `script`, `references`, `reference_media` (insumos internos de produção/IA) e `review_status`. A UI pública usa apenas `title, copy, format, channels, scheduled_at, cover_url, client_briefing, review_status`. **[C]** → **P2** (exposição menor, mesmo cliente).

## 3. `media_plans.share_token`

Cadeia completa: **[C]**

`issueMediaPlanShareToken` / `revokeMediaPlanShareToken` (`src/lib/media-plans.functions.ts:250-298`, autenticadas) → coluna `media_plans.share_token` (UNIQUE) → UI interna gera `/plano/{id}?token=…` (`customers.$customerId.media-plan.tsx:936`, `media-plans.tsx:214`) → rota pública `src/routes/plano.$planId.tsx` → server functions `resolveMediaPlanPublic` / `listMediaPlanPublicItems` (`src/lib/media-plan-public.functions.ts`, cliente **publishable/anon**, sem sessão) → RPCs `SECURITY DEFINER` `public.media_plan_public_resolve(text)` / `public.media_plan_public_items(text)` (migration `20260715121635_…`, `EXECUTE` para `anon, authenticated`).

| Item | Situação |
| --- | --- |
| Geração | `crypto.getRandomValues(20 bytes)` → base36 → 40 chars. Registros reais têm 36 chars (geradores anteriores), ainda ≈144 bits. **[C]** |
| Armazenamento | texto puro, coluna UNIQUE do próprio plano. **[C]** |
| Expiração | `share_expires_at` **opcional**; os 2 tokens em produção têm `NULL` → válidos indefinidamente. **[C]** (P3) |
| Revogação | Sim (`share_token = NULL`); resolve/items falham com `invalid_token`. **[C]** |
| Rotação | Reemissão sobrescreve o token ("Gerar novo"), invalidando o anterior. Não é obrigatória nem periódica. **[C]** (P3) |
| Reutilização/replay | Ilimitada; superfície é somente leitura, não há escrita pública nesta cadeia — replay é inócuo além de leitura repetida. **[C]** |
| Enumeração/brute force | Inviável por entropia; sem rate limit no RPC nem na server function. **[C]** (P2) |
| Vínculo estrutural | O token é **coluna do próprio plano**, e o RPC resolve `client_id`/`brand_id` do mesmo registro. Não é chave independente e não aceita `planId` do requisitante (o `$planId` da URL é apenas cosmético; o RPC ignora e usa o token). **[C]** |

Acesso cross-client / cross-workspace: **impossível** — nenhuma consulta pública usa identificador fornecido pelo usuário. **[C]**
Dados retornados: `plan{id,title,status,period_start,period_end,monthly_budget,updated_at}`, `client{id,name}`, `brand{id,name}` e itens (`product_service, campaign_type, funnel_stage, objective, main_kpi, channel, audience, budget_pct, budget_amount, keywords, benchmark, other_refs`). Nada de usuários, credenciais, IA, auditoria. Excedentes leves: `client.id`, `brand.id`, `status` interno. **[C]** (P3)
Planos `archived` (e `draft`) permanecem acessíveis pelo token — o RPC não filtra `status`. Exclusão real remove a linha (cascade), então token morre. **[C]** (P3)

## 4. `getLoginLogoFn`

`src/lib/login-branding.functions.ts` — `createServerFn({ method: "GET" })` **sem middleware de autenticação**, consumido por `src/components/brand/login-logo.tsx` na tela de login (React Query, `staleTime` 60 min, `gcTime` 24 h). **[C]**

| Item | Situação |
| --- | --- |
| Autenticação | Nenhuma — necessária a ausência, pois a tela de login não tem sessão. Uso legítimo de superfície pública. **[C]** |
| `service_role` | Usa `supabaseAdmin` via import dinâmico. Justificado: precisa ler `brands.login_logo_url` (RLS restrita) e assinar objeto do bucket privado `brand-assets`. **[C]** |
| Origem do `brandId` | **Não recebe nenhum parâmetro.** Faz `select … from brands where login_logo_url is not null order by updated_at desc limit 1`. **[C]** |
| Validação de workspace | Nenhuma — o recurso não é solicitado, é escolhido pelo servidor. Consequência: em base multi-tenant (**337 brands**, 1 com logo hoje), a logo exibida é a da marca mais recentemente atualizada, sem vínculo com host/instância; um workspace que suba uma logo passa a "vencer" a tela de login de todos. **[C]** → **P2** (correção funcional + exposição de asset privado de outro workspace; sem PII, sem cross-client de dados operacionais). |
| Enumeração de `brandId` | Impossível: não há entrada. **[C]** |
| Dados retornados | Apenas `{ url }` — URL assinada (6 h) do objeto de logo; nenhum ID, nome ou metadado de marca. **[C]** |
| Abuso automatizado | Cada chamada anônima emite uma URL assinada nova; sem rate limit, sem cache de servidor (cache é só no navegador). Flood barato → geração ilimitada de URLs assinadas e leituras em `brands`. **[C]** → **P2** |
| CORS | Não define cabeçalhos CORS; é server function do mesmo domínio (POST/GET interno do TanStack). Sem exposição cross-origin relevante. **[C]** |
| Falha | `try/catch` devolve `{url:null}` → UI cai no asset padrão; não vaza mensagem de erro. **[C]** |

## 5. Matriz de segurança

| Cenário | Esperado | `/api/public/approval/$token` | `media_plans.share_token` | `getLoginLogoFn` |
| --- | --- | --- | --- | --- |
| ANON acesso legítimo | permitido quando necessário | OK **[C]** | OK **[C]** | OK **[C]** |
| ANON cross-client | negado | negado (recurso vem do token) **[C]** | negado (idem) **[C]** | N/A — sem entrada; recurso escolhido pelo servidor pode ser de outro workspace **[C]** (P2) |
| ANON cross-workspace | negado | negado **[C]** | negado **[C]** | **não garantido** **[C]** (P2) |
| Token inválido | negado | `404` **[C]** | `invalid_token` **[C]** | N/A |
| Token expirado | negado | `410` **[C]** | `token_expired`; tokens reais sem expiração **[C]** (P3) | N/A |
| Token revogado | negado | `410` **[C]** | negado (token = NULL) **[C]** | N/A |
| Brute force | mitigado | **não mitigado** (entropia alta, zero rate limit) **[C]** (P2) | **não mitigado** **[C]** (P2) | **não mitigado** **[C]** (P2) |
| Replay | controlado | **não controlado** — decisão repetível, sem idempotência **[C]** (P2) | inócuo (somente leitura) **[C]** | inócuo, mas gera URLs assinadas **[C]** (P2) |
| Dados excessivos | negado | `script`/`references`/`reference_media`/`client_id`/`token.id` **[C]** (P2) | `client.id`/`brand.id`/`status` **[C]** (P3) | nenhum **[C]** |
| Recurso excluído | negado | `GET` nega; `POST` aceita post com `deleted_at` **[C]** (P2) | linha removida → token morre **[C]** | N/A |
| Recurso arquivado | idealmente negado | N/A | acessível **[C]** (P3) | N/A |

## 6. Classificação

**P0 — nenhum.**

**P1 — nenhum.** Não há acesso cross-client/cross-workspace a dados operacionais, token previsível gerado por código, nem superfície pública gravemente desprotegida.

**P2**
1. Rate limiting / anti-brute-force / anti-replay ausente nas três superfícies (nenhum controle por IP, token ou origem).
2. `/api/public/approval/$token`: token permanece válido e reutilizável após a decisão; `POST` também aceita peça com `deleted_at`.
3. `/api/public/approval/$token`: CORS `*` com `POST` sem necessidade funcional.
4. `/api/public/approval/$token`: payload expõe campos internos (`script`, `references`, `reference_media`, `client_id`, `token.id`).
5. `getLoginLogoFn`: seleção global "última marca atualizada" entre 337 brands, sem vínculo com instância/host, emitindo URL assinada de bucket privado a anônimos sem limite.

**P3**
1. `media_plans.share_token` sem expiração obrigatória (tokens reais com `share_expires_at NULL`) e sem rotação periódica.
2. Planos `archived`/`draft` continuam legíveis pelo link público.
3. Tokens de QA com padrão previsível (`brain22-t1-…`, 19 chars) persistidos em `card_approval_tokens`; tokens de aprovação e de plano guardados em texto puro (aceitável para links de compartilhamento, mas registrado como debt).

## 7. Testes executados

- Consultas **somente leitura** ao banco (`supabase read_query`): contagem/estrutura de `card_approval_tokens` e `media_plans.share_token`, comprimentos e ciclo de vida, grants de `anon` nas tabelas envolvidas (nenhum), contagem de `brands` e de logos de login. **[C]**
- Leitura completa de rota, server functions, RPCs `SECURITY DEFINER`, migrations e componentes consumidores. **[C]**
- **Não executado por limitação do ambiente / por regra da fase:** requisições reais (`GET`/`POST`) contra tokens de produção, teste de expiração/revogação em vivo, brute force, replay real, verificação de cabeçalhos CORS em produção. Nenhum `UPDATE`/`DELETE`, nenhuma alteração de token real.
- Nenhum harness automatizado cobre estas três superfícies (`tests/` não referencia `card_approval_tokens`, `share_token` nem `getLoginLogoFn`) — lacuna de cobertura registrada como P3/debt. **[C]**

## 8. Correção mínima recomendada para eventual 10F.2

1. Rate limit único para superfícies públicas por IP + token (janela curta), aplicável às três rotas.
2. Aprovação: encerrar o token na primeira decisão (ou torná-lo idempotente por `token_id + verb`), e exigir `deleted_at is null` também no `POST`.
3. Aprovação: remover CORS `*` (same-origin) e limitar métodos a `GET, POST` do próprio domínio.
4. Aprovação: reduzir o `select` ao mínimo consumido pela UI pública (remover `script`, `references`, `reference_media`, `client_id`, `token.id`).
5. `getLoginLogoFn`: resolver a marca por host/instância (ou por configuração explícita de instância) em vez de "última atualizada"; cachear a URL assinada no servidor.
6. `share_token`: expiração default obrigatória na emissão e recusa de planos `archived` nos dois RPCs.

## 9. Riscos residuais (após 10F.1, sem alterações)

- Quem obtiver um link de aprovação pode decidir repetidamente até a expiração, inclusive em peça logicamente excluída, e gerar eventos de auditoria em volume.
- Links de plano de mídia em produção são perpétuos até revogação manual.
- Tela de login de qualquer instância pode exibir a logo (URL assinada) da marca mais recentemente atualizada no banco compartilhado.
- Nenhuma das superfícies é observável: não há métrica, alerta ou log de tentativas inválidas.
- Tokens em texto puro: um vazamento de leitura no banco entrega links públicos ativos.
