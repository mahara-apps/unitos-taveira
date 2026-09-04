# Auditoria técnica — Meta OAuth e gestão de Portfólio (Unitos Master)

> Nenhum segredo, token ou valor de variável é impresso neste documento.

## 1. Fluxo atual ponta a ponta

1. `ChannelsCenter` / `SocialChannelCard` / `MetaPortfolioDialog` chamam
   `startMetaOAuth` (`src/lib/meta/meta.functions.ts`) com `brandId` e `channel`.
2. `startMetaOAuth` (autenticada, `requireSupabaseAuth`):
   - lê o **origin da requisição** (`getRequest().url`);
   - instancia `MetaProvider({ origin })` → `resolveMetaRedirectUri(origin)`;
   - assina o `state` HMAC (`signOAuthState`) com `brandId`, `userId`,
     `redirectTo`, `channel`, `nonce`, `exp` (TTL 600 s);
   - devolve `authorizeUrl` + `redirectUri`.
3. O cliente abre popup e navega para o diálogo OAuth do Facebook.
4. Meta redireciona para `GET /api/public/meta/callback`
   (`src/routes/api/public/meta/callback.ts`):
   - `verifyOAuthState` valida assinatura e expiração;
   - `exchangeCode` → `exchangeForLongLivedUserToken` → `getMe` →
     `listGrantedPermissions`;
   - o token de usuário é cifrado (`encryptCredential`) e gravado em
     `meta_oauth_sessions` (portfólio vazio; carregado sob demanda);
   - HTML de retorno faz `postMessage({source:"meta-oauth", sessionId})` para o
     opener e fecha o popup.
5. `MetaPortfolioDialog` chama `getMetaPortfolio` (`portfolio.functions.ts`), que
   varre o Graph com o token da sessão e lista Páginas/IG/ad accounts.
6. `linkMetaAccount` grava/atualiza `social_connections` (uma linha por conta,
   com `owner_external_id`/`owner_name` = Business/Portfólio) e o vínculo
   cliente↔conta em `client_social_accounts`.

### Arquivos envolvidos

| Arquivo | Papel |
| --- | --- |
| `src/lib/meta/provider.server.ts` | Graph client, `resolveMetaRedirectUri`, `buildAuthorizeUrl`, `exchangeCode`, state HMAC |
| `src/lib/meta/meta.functions.ts` | `startMetaOAuth`, sessões, `disconnectMeta`, refresh |
| `src/routes/api/public/meta/callback.ts` | Callback público |
| `src/lib/meta/portfolio.functions.ts` / `portfolio-shared.ts` | Descoberta e vínculo de contas |
| `src/lib/meta/discovery.*`, `reconnect.functions.ts` | Contas disponíveis e reconexão |
| `src/components/connections/channels-center.tsx`, `meta-portfolio-dialog.tsx`, `social-channel-card.tsx` | UI |

## 2. Callback URL

Path canônico: `META_CALLBACK_PATH = /api/public/meta/callback`.

URL gerada **hoje**: `resolveMetaRedirectUri(origin)` retornava
`${origin}${META_CALLBACK_PATH}` quando o host do request e o host de
`META_REDIRECT_URI` fossem *ambos* domínios Lovable (heurística `isLovableHost`)
ou subdomínio do host configurado. No preview isso produzia
`https://id-preview--<uuid>.lovable.app/api/public/meta/callback`, que **não está
registrado** no App Meta.

URL que deve ser registrada (produção):
`https://unitos-master.lovable.app/api/public/meta/callback`

## 3. State / CSRF

- Criado em `signOAuthState`: `base64url(JSON).hmacSha256Hex(payload)`.
- Payload: `brandId`, `userId`, `redirectTo`, `channel`, `nonce` (16 bytes
  aleatórios), `exp` (unix, TTL padrão 600 s).
- Segredo: `META_STATE_SECRET` (opcional) com fallback para `META_APP_SECRET`.
  Não vai na URL — apenas a assinatura vai.
- Validação em `verifyOAuthState`: assinatura (comparação de tempo constante),
  `exp`; o `nonce` **não era** verificado contra replay.
- Não há tabela de state: o token é auto-contido (stateless).

## 4. Variáveis de ambiente

| Variável | Necessidade | Situação |
| --- | --- | --- |
| `META_APP_ID` | obrigatória | configurada |
| `META_APP_SECRET` | obrigatória | configurada |
| `META_REDIRECT_URI` | obrigatória — URL absoluta https do callback | configurada |
| `META_STATE_SECRET` | recomendada (isola state por instalação) | ausente (usa fallback) |
| `META_EXTRA_REDIRECT_HOSTS` | opcional — hosts extras já registrados no App Meta | ausente |
| `META_WEBHOOK_VERIFY_TOKEN` | webhooks | configurada |
| `PUBLIC_APP_URL` | URLs de compliance (data deletion) | ausente |

`Graph API v22.0` (`GRAPH_VERSION` em `provider.server.ts`) — mantida; nenhuma
incompatibilidade observada no fluxo de OAuth/portfólio.

## 5. Causa do “URL bloqueada”

Confirmada por leitura de código: o `redirect_uri` era derivado do origin do
request sempre que request e `META_REDIRECT_URI` estivessem em domínios Lovable.
Em preview (`id-preview--<uuid>.lovable.app`) e em qualquer host Lovable não
cadastrado, o `redirect_uri` enviado ao diálogo OAuth divergia da allowlist do
App Meta → “O redirecionamento falhou porque o URI usado não está na lista de
liberação”. O `exchangeCode` usava o mesmo valor, então o erro aparecia já no
authorize.

**Correção aplicada:** `resolveMetaRedirectUri` passou a ser determinística —
usa `META_REDIRECT_URI` salvo quando o host do request é exatamente o host
configurado ou consta em `META_EXTRA_REDIRECT_HOSTS`. Heurísticas de subdomínio
e de domínio Lovable foram removidas.

## 6. Gaps identificados

- Replay de `state`: o mesmo `state` podia ser reapresentado dentro do TTL.
  Corrigido com `state_nonce` único em `meta_oauth_sessions`.
- Ausência de ação explícita de “Desconectar portfólio” / “Trocar portfólio”:
  só existia remoção por canal individual (`disconnectMeta`) e reconexão.
- `disconnectMeta` dependia apenas de RLS; nenhuma checagem explícita de papel.
- Isolamento por workspace: todas as consultas filtram `brand_id` e usam o
  cliente autenticado (RLS ativa). Sessões OAuth filtram também `user_id`.
- `postMessage` do callback usa `"*"` como targetOrigin; o payload não contém
  token nem segredo (apenas `sessionId`), mas é um ponto de atenção conhecido.
- Logs: erros do callback registram etapa e objeto de erro do Graph; nenhum
  token é logado. `redirectUri` é logado no console do cliente (não é segredo).

## 7. Segundo portfólio

O modelo suporta múltiplos portfólios: cada conta vira uma linha em
`social_connections` com `owner_external_id`/`owner_name` (Business). Conectar um
segundo portfólio simplesmente adiciona novas linhas — mas a UI não mostrava
quais portfólios estavam conectados nem permitia removê-los em bloco.

## 8. Arquitetura/UX implementada

- Card “Portfólios Meta conectados” na Central de canais, listando
  `owner_name`/`owner_external_id`, nº de canais, clientes atendidos e status.
- CTA primário “Trocar portfólio” (reinicia OAuth com `forceReauth`, abre o
  seletor; nada é gravado até o usuário escolher as contas — a conexão antiga
  permanece intacta se a nova falhar).
- Ação secundária “Desconectar” por portfólio, com confirmação; revoga as
  conexões daquele portfólio no workspace, remove vínculos de cliente e expira
  sessões OAuth quando não resta portfólio.
- Sem conexão: CTA “Conectar Meta”.
- Ações restritas a Owner/Admin/Super Admin (`app_access_role`) e sempre
  filtradas por `brand_id`.
