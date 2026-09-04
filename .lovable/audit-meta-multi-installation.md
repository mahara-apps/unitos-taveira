# Auditoria READ-ONLY — Arquitetura da integração Meta (múltiplas instalações do Unitos)

Data: 2026-08-26 · Escopo: somente leitura. Nenhum arquivo de código, migration, RLS, secret ou configuração foi alterado.

---

## 1. Resumo executivo

A integração Meta do Unitos é **inteiramente por instalação**: app id/secret, redirect URI, verify token do webhook e banco vêm de variáveis de ambiente da própria instância, e todo estado (tokens, contas, eventos) é gravado no Supabase daquela instância. **Não existe nenhum componente central, tabela compartilhada, gateway ou serviço externo** no caminho do OAuth, dos webhooks ou da publicação.

Consequência para o cenário "um único Meta App servindo instalação A (domínio A + Supabase A) e instalação B (domínio B + Supabase B)":

> **CENÁRIO A/B — 🟡 Pequena alteração (na prática, quase só configuração).**
> Funciona compartilhando as mesmas credenciais do App, registrando os redirect URIs e webhooks de cada domínio no App Dashboard. Um único ponto exige atenção real: **o webhook da Meta aceita apenas uma Callback URL por produto (Page/Instagram)**, então os eventos de webhook chegariam a uma instalação só. Também há **um fallback de domínio hardcoded** e **o segredo do `state` OAuth reusa o `META_APP_SECRET`** (compartilhado entre instalações) — dois ajustes localizados.

---

## 2. Arquitetura atual

Runtime: TanStack Start (SSR/Workers) da própria instalação. Sem Edge Functions da Meta.

| Componente | Arquivo |
| --- | --- |
| Cliente Graph + OAuth + state assinado | `src/lib/meta/provider.server.ts` |
| Início do OAuth (server fn autenticada) | `src/lib/meta/meta.functions.ts` (`startMetaOAuth`) |
| Alternativa via registry de providers | `src/lib/social/providers/meta.server.ts`, `src/lib/social/registry.server.ts` |
| Callback OAuth (público) | `src/routes/api/public/meta/callback.ts` |
| Webhook (público) | `src/routes/api/public/meta/webhook.ts` |
| Deauthorize / Data deletion / status | `src/routes/api/public/meta/{deauthorize,data-deletion,deletion-status}.ts` |
| `signed_request` HMAC + URL de confirmação | `src/lib/meta/signed-request.server.ts` |
| Descoberta de contas / portfólio | `src/lib/meta/{discovery,portfolio}.*.ts` |
| Capacidade de publicar / escopos | `src/lib/meta/{publish-capability,granular-scopes}.server.ts` |
| Publicação + cron | `src/lib/meta/publishing.server.ts`, `src/routes/api/public/meta/publish-scheduled.ts` |
| Criptografia de credenciais (AES-GCM) | `src/lib/credentials-crypto.server.ts` |
| Analytics Meta | `src/lib/social-analytics/providers/meta.server.ts` + `registry.server.ts` |

### Env vars usadas
`META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_WEBHOOK_VERIFY_TOKEN`, `PUBLIC_APP_URL` (fallback nas URLs de confirmação), `BRAND_CREDENTIALS_SECRET` (chave de cifra dos tokens), `CRON_SECRET` (cron de publicação), `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

**Resposta 1:** o Meta App é **configurado por instalação** (env vars lidas dentro dos handlers via `requireEnv`). Não é global nem implícito — nada no código pressupõe um app id único compartilhado.

---

## 3. OAuth atual

Fluxo real:

1. **Início** — `startMetaOAuth` (`src/lib/meta/meta.functions.ts`), server fn autenticada (`requireSupabaseAuth`). Lê o `origin` da request (`getRequest().url`).
2. **Redirect URI** — `resolveMetaRedirectUri(origin)` em `provider.server.ts`: usa `${origin}/api/public/meta/callback` **se** o host for igual ao host de `META_REDIRECT_URI` ou terminar em `.lovable.app` / `.lovableproject.com` e for https; senão cai para `META_REDIRECT_URI`. Path canônico: `META_CALLBACK_PATH = "/api/public/meta/callback"`.
3. **URL de autorização** — `buildAuthorizeUrl` (dialog OAuth da Meta) com `client_id`, `redirect_uri`, `state`, `scope` (ou `config_id`), `response_type=code`, `display=popup`, `auth_type=rerequest|reauthenticate`.
4. **State** — `signOAuthState` / `verifyOAuthState`: token `base64url(payload).hmacSha256Hex(payload)`, payload `{ brandId, userId, redirectTo, channel, nonce, exp(10min) }`. **Sem tabela de state.** O segredo do HMAC é **o próprio `META_APP_SECRET`** (`stateSecret()`).
5. **Callback** — `GET /api/public/meta/callback`: verifica o state, troca `code` → token curto → **token longo** (`exchangeForLongLivedUserToken`), lê `/me` e `/me/permissions`, cifra o user token e grava uma **sessão curta** em `meta_oauth_sessions` (`brand_id`, `user_id` vindos do state). Devolve HTML que faz `postMessage` para o opener com `sessionId` e redireciona para `redirectTo` (default `/connections`).
6. **Seleção de contas** — o usuário escolhe páginas/IG no dialog (`src/components/connections/meta-portfolio-dialog.tsx` + `portfolio.functions.ts`), que grava `social_connections` (nível workspace/brand).
7. **Vínculo com cliente** — separado, via `client_social_accounts` (`connection_id + client_id + brand_id`), em `src/lib/client-channels.functions.ts` / `channels-center.functions.ts`.

Vínculo: **workspace/brand vem do state** (não do domínio, não da Meta). **Cliente nunca vem da Meta** — é vínculo interno explícito.

---

## 4. Tokens atuais

| Tabela | Colunas relevantes | Brand? | Client? | Token? | Lê | Escreve |
| --- | --- | --- | --- | --- | --- | --- |
| `social_connections` | `access_token_ciphertext`, `refresh_token_ciphertext`, `token_expires_at`, `scopes`, `external_id` (Page ID), `page_id`, `instagram_business_id`, `account_id`, `account_username`, `meta_user_id`, `owner_external_id`, `status`, `provider`, `channel` | sim (`brand_id`) | legado `client_id` (não usado no cron) | sim, cifrado (page token) | publishing, analytics, discovery, reconnect, capability, cron | portfolio.functions, reconnect, deauthorize, cron (status) |
| `meta_oauth_sessions` | `user_token_ciphertext`, `user_token_expires_at`, `scopes`, `requested_scopes`, `pages`, `threads_accounts`, `ad_accounts`, `meta_user_id/name/email`, `expires_at`, `consumed_at` | sim | não | sim, cifrado (user token longo) | `getActiveMetaSession`, portfolio/discovery | callback OAuth, portfolio loader; apagada por deauthorize/data-deletion |
| `client_social_accounts` | `connection_id`, `client_id`, `brand_id` | sim | sim | não | cron, painéis de cliente | channels center / client-channels |
| `meta_compliance_events` | `event_type`, `meta_user_id`, `confirmation_code`, `status`, `affected_connections`, `payload` | não | não | não | `deletion-status` | deauthorize, data-deletion |

Cifra: AES-256-GCM com chave derivada de `BRAND_CREDENTIALS_SECRET` (`credentials-crypto.server.ts`) — **por instalação**. Meta não emite refresh token; "refresh" = reemitir long-lived. Nenhum token real foi lido/exposto nesta auditoria.

---

## 5. Webhooks atuais

| Endpoint | Método | GET verify | POST | Assinatura | Identifica página | Workspace | Cliente | Persistência |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/public/meta/webhook` | GET+POST | sim (`hub.verify_token` = `META_WEBHOOK_VERIFY_TOKEN`) | sim | `X-Hub-Signature-256` HMAC-SHA256 do raw body com `META_APP_SECRET`, compare em tempo ~constante | `entry[].id` (Page ID ou IG Business ID) | via `social_connections` (`provider=meta`, `channel`, `external_id IN (...)`) → `brand_id` | não identifica direto (só pelo vínculo posterior) | `brain.events.publish` (Event Bus, `brain_events`) com contexto de sistema |
| `/api/public/meta/deauthorize` | POST | — | sim | `signed_request` HMAC | `user_id` do payload | todas as conexões daquele `owner_external_id` | — | revoga conexões + apaga sessões + `meta_compliance_events` |
| `/api/public/meta/data-deletion` | POST | — | sim | `signed_request` HMAC | `user_id` | idem | — | deleta conexões + sessões + evento de compliance |
| `/api/public/meta/deletion-status` | GET | — | — | código de confirmação | — | — | — | leitura |
| `/api/public/meta/publish-scheduled` | POST | — | sim | `x-cron-secret` = `CRON_SECRET` | `social_posts.connection_id` | RPC revalida brand + `client_social_accounts` | sim | `social_posts`, `post_placements`, Kanban |

**Como o Unitos sabe qual instalação recebe o evento?** Ele **não sabe**. A Meta entrega o webhook na URL configurada no App Dashboard; a instalação que recebe procura o `external_id` no *seu próprio* Supabase e, se não achar, apenas loga `no matching connection` e responde 200. Com duas instalações e um App, os webhooks vão todos para o domínio configurado — eventos das páginas da outra instalação são silenciosamente descartados. O OAuth não sofre disso (o redirect URI é por request/origin e a Meta aceita múltiplos URIs).

---

## 6. Dependências de domínio

- `META_REDIRECT_URI` — env, por instalação. Base do allowlist do redirect.
- `resolveMetaRedirectUri` — aceita o origin da request quando bate com o host configurado **ou** termina em `.lovable.app` / `.lovableproject.com` (allowlist genérica do Lovable, um pouco mais larga que o ideal em multi-instalação).
- `PUBLIC_APP_URL` em `signed-request.server.ts` linha 53 com **fallback hardcoded `https://unitos.sejaumpartner.com`** — único domínio fixo em código (só afeta a URL de confirmação de exclusão).
- Comentários com URLs de exemplo (`unitos.lovable.app`, `unitos.sejaumpartner.com`) em `webhook.ts`, `deauthorize.ts`, `data-deletion.ts` — documentação, não runtime.
- `APP_URL` usado em `src/lib/team.functions.ts` (convites, não Meta).
- Front-end: o popup OAuth usa `postMessage` com target `"*"` e o callback envia `Cross-Origin-Opener-Policy: unsafe-none`.

Respostas: OAuth **depende do domínio da instalação** (redirect URI precisa estar registrado no App). Webhook **depende do domínio** e é **único por produto no App**. **Não existe domínio central em uso** (só o fallback hardcoded).

---

## 7. Dependências de banco

Cada instalação lê/escreve exclusivamente o seu Supabase, via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (`@/integrations/supabase/client.server`) ou o client autenticado do usuário. Verificado:

- Tabelas: `social_connections`, `meta_oauth_sessions`, `client_social_accounts`, `meta_compliance_events`, `social_posts`, `post_placements`, `brain_events` — todas locais, com `brand_id`.
- RPCs: `claim_scheduled_social_posts`, `mark_social_post_published/failed`, `sync_post_publication_state`, `can_access_client` / `client_in_scope` — locais.
- Edge Functions Supabase: **nenhuma** no caminho Meta (padrão do projeto é `createServerFn` + server routes).
- Cron: `pg_cron` local chamando a rota `/api/public/meta/publish-scheduled` do próprio domínio com `CRON_SECRET` local.
- `service_role` nunca cruza instalações.

Conclusão: **Supabase A / B / C funcionam sem alteração estrutural.** Nada globaliza o banco.

---

## 8. Fluxo atual

```text
OAuth (por instalação)
Usuário (browser, domínio A)
   ↓ startMetaOAuth (server fn, Worker A) — state HMAC{brandId,userId}
Meta OAuth dialog (client_id do App compartilhado, redirect_uri = domínio A)
   ↓ ?code&state
Callback  GET https://A/api/public/meta/callback   (Worker A)
   ↓ code → token curto → token longo → /me, /me/permissions
Token cifrado (BRAND_CREDENTIALS_SECRET de A) → meta_oauth_sessions (Supabase A)
   ↓ postMessage(sessionId) → dialog de seleção
social_connections (brand_id) + client_social_accounts (client_id)  [Supabase A]
   ↓
Meta Graph API (publicação, analytics) usando page token de A
```

```text
Webhook (único no App Dashboard)
Meta
 ↓ POST  https://<domínio configurado no App>/api/public/meta/webhook
Worker dessa instalação (verifica X-Hub-Signature-256 com META_APP_SECRET)
 ↓ lookup social_connections por (provider=meta, channel, external_id)
 ├─ achou  → brain.events.publish → brain_events (Supabase dessa instalação)
 └─ não achou → log "no matching connection" + HTTP 200  ← evento perdido para a outra instalação
```

Hospedagem: OAuth/callback/webhook/cron nos Workers da própria instalação; dados no Supabase da própria instalação; nada em infraestrutura compartilhada.

---

## 9. O que já funciona para múltiplas instalações

- App id/secret, redirect URI, verify token, chave de cifra e banco: **todos por env, por instalação**.
- OAuth com múltiplos domínios: a Meta aceita vários "Valid OAuth Redirect URIs" no mesmo App; o código já deriva o URI do origin da request.
- Tokens totalmente separados (cifra e banco distintos).
- Publicação, analytics, descoberta, reconexão, cron: 100% locais.
- Deauthorize/data-deletion: verificação de assinatura correta — funcionam em qualquer domínio registrado.

## 10. Pontos que impedem (ou atrapalham) múltiplas instalações

1. **🟠 Webhook único por produto.** O App Dashboard permite **uma** Callback URL para "Page" e uma para "Instagram". Com A e B no mesmo App, os eventos chegam só num domínio; a outra instalação nunca os vê (descartados com 200). É a única dependência realmente estrutural — e afeta apenas quem depende de webhooks (comentários/DM/lead ads). Publicação agendada e métricas **não** dependem de webhook.
2. **🟡 `state` OAuth assinado com `META_APP_SECRET`.** Com o secret compartilhado, um state emitido por A é criptograficamente válido em B. O `brandId`/`userId` do state pertence a outro banco, então a exploração prática é limitada (a sessão seria criada com um brand inexistente em B), mas é um enfraquecimento de isolamento. Segredo dedicado por instalação resolveria.
3. **🟡 Allowlist de redirect larga.** `resolveMetaRedirectUri` aceita qualquer host `*.lovable.app` / `*.lovableproject.com`. Como todo redirect precisa também estar registrado no App Dashboard, o risco real é baixo, mas a checagem deveria ser restrita ao host da instalação.
4. **🟢 Fallback de domínio hardcoded** (`unitos.sejaumpartner.com` em `signed-request.server.ts`): em B, sem `PUBLIC_APP_URL`, a URL de confirmação de exclusão apontaria para o domínio de A.
5. **🟢 Deauthorize/data-deletion são por instalação.** A Meta chama uma URL só, então remover o app na Meta revoga as conexões apenas na instalação que recebe o callback. Conformidade/limpeza fica parcial nas demais.
6. **🟢 `postMessage(..., "*")`** no HTML do callback — higiene, não bloqueio.

---

## 11. Solução mínima recomendada

**Classificação final: 🟡 Pequena alteração** (🟠 apenas se webhooks forem requisito para todas as instalações).

Passo a passo, sem Control Plane e sem Gateway:

1. **Configuração (nenhum código):** em cada instalação, definir `META_APP_ID` e `META_APP_SECRET` iguais; `META_REDIRECT_URI`, `PUBLIC_APP_URL`, `META_WEBHOOK_VERIFY_TOKEN`, `BRAND_CREDENTIALS_SECRET`, `CRON_SECRET` e credenciais Supabase **próprios**. No App Dashboard, adicionar `https://<domínio>/api/public/meta/callback` de A e de B em "Valid OAuth Redirect URIs".
2. **Webhooks — opção mínima por ordem de preferência:**
   - (a) Se webhooks não são usados no produto: nada a fazer.
   - (b) Se são usados: manter **um App por instalação apenas para webhooks** não é possível com App único — então usar o padrão **"forward"**: a instalação que recebe o webhook (dona da URL) repassa o *raw body + header de assinatura* para `/api/public/meta/webhook` das demais quando não encontra `external_id` local. Cada instalação continua validando a assinatura com o mesmo `META_APP_SECRET`. É uma alteração localizada num único arquivo (`webhook.ts`) + uma env de lista de peers. **Não** requer nova infraestrutura, banco compartilhado ou gateway.
   - (c) Alternativa sem código: aceitar que webhooks só operem na instalação principal.
3. **Isolamento do state:** trocar `stateSecret()` para um segredo dedicado (ex.: `META_STATE_SECRET`, com fallback ao app secret) — alteração de 3 linhas.
4. **Higiene de domínio:** remover o fallback hardcoded em `signed-request.server.ts` (falhar explicitamente sem `PUBLIC_APP_URL`) e estreitar a allowlist de `resolveMetaRedirectUri` ao host de `META_REDIRECT_URI` (+ preview, se necessário).
5. **Deauthorize/data-deletion:** mesmo mecanismo de forward do item 2b, se conformidade multi-instalação for exigida.

Complexidade estimada:

| Item | Esforço |
| --- | --- |
| 1. Configuração + registro de redirect URIs | 🟢 minutos, zero código |
| 3. Segredo dedicado do state | 🟡 ~15 min |
| 4. Domínio hardcoded + allowlist | 🟢 ~15 min |
| 2b. Forward de webhooks entre instalações | 🟠 ~2–4 h, 1 arquivo + 1 env |
| 5. Forward de deauthorize/data-deletion | 🟠 ~1–2 h |

**Control Plane / Gateway: não necessário.** Nenhuma dependência de banco, tabela ou serviço compartilhado foi encontrada; a única limitação vem do App Dashboard da Meta (URL única de webhook), resolvível com o forward acima.
