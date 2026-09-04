# Auditoria ponta a ponta — Meta para agências (Unitos Master)

> Nenhum segredo, token ou valor de variável de ambiente é impresso aqui.

## 1. Modelo conceitual (o que estava embaralhado)

| Conceito | Fonte de verdade | Antes | Agora |
| --- | --- | --- | --- |
| Usuário Unitos | `auth.users` / `brand_members` | ok | ok |
| Usuário Meta (quem autorizou) | `meta_oauth_sessions.meta_user_id` | usado também como "portfólio" | apenas identidade do administrador |
| Business Portfolio | `social_connections.meta_business_id` + `meta_oauth_sessions.businesses` | inexistente | identidade real do portfólio |
| Assets (Página/IG/Ads) | varredura Graph + cache `pages` | rasa (`/me/accounts`) | varredura profunda por Business |
| Concessão granular do app | `debug_token.granular_scopes` | só booleano | motivo acionável por ativo |
| Canal conectado | `social_connections` (status ≠ revoked) | ok | ok |
| Vínculo com cliente | `client_social_accounts` | ok | ok |
| Histórico/revogação | `status=revoked`, `revoked_at` | parcial | granular por portfólio |

Causa raiz do caso `jose@mahara.marketing`: a autorização era tratada como
pertencente ao **usuário Meta** e à **sessão do usuário Unitos** que iniciou o
OAuth. Um segundo administrador do MESMO Business Portfolio não reaproveitava a
autorização do workspace, e os ativos do portfólio não eram descobertos porque a
varredura usava apenas `/me/accounts` (páginas onde o usuário é admin direto).

## 2. Ajustes aplicados

- `provider.server.ts` — varredura profunda por padrão: `/me/businesses`,
  `owned_pages`, `client_pages`, `owned_instagram_accounts`, com paginação e
  deduplicação; retorna `businesses` e anexa `businessId/businessName` a cada
  página. Diagnóstico `metaOAuthModeDiagnostics()` (Facebook Login for Business
  via `META_BUSINESS_CONFIG_ID` × escopos legados).
- `portfolio-shared.ts` — cache passa a carregar `businesses` e identidade de
  portfólio por página; `accountStatusReason()` explica por que um ativo não está
  disponível (permissão ausente × ativo não marcado no consentimento).
- `authorization-state.ts` — autorização, portfólio e canais separados;
  agrupamento por `meta_business_id` com fallback legado por usuário Meta;
  suporte a múltiplos administradores e múltiplos portfólios.
- `authorization.server.ts` — revogação granular: desconectar um portfólio não
  derruba os outros; a sessão só é revogada quando não alcança mais nenhum
  portfólio, senão apenas o cache daquele portfólio é podado.
  `revokeMetaAuthorization()` revoga um administrador Meta específico.
- `portfolio-admin.functions.ts` / `meta.functions.ts` / `discovery.functions.ts`
  — RBAC server-side (Owner/Admin/Super Admin), reuso de autorização por
  workspace (não por usuário Unitos), status e descoberta cientes de portfólio.
- `portfolio.functions.ts` — grava `meta_business_id/meta_business_name` nas
  conexões, persiste `businesses` na sessão e não considera conta `revoked` como
  já conectada (permite reconexão).
- UI — cartões por Business Portfolio (nome, Business ID, canais, clientes, nº de
  administradores autorizantes, desconexão granular) e, em "Contas disponíveis",
  o portfólio dono e o motivo acionável de indisponibilidade.
- `callback.ts` — `postMessage` deixa de usar `"*"`: usa o origin canônico
  derivado de `META_REDIRECT_URI`.

## 3. Endpoints canônicos (inalterados)

- Callback OAuth: `https://unitos-master.lovable.app/api/public/meta/callback`
- Webhook: `https://unitos-master.lovable.app/api/public/meta/webhook`
  (handshake `hub.mode/hub.verify_token/hub.challenge` + HMAC-SHA256 no POST).

## 4. Regras de disponibilidade

Uma conta só aparece como disponível quando: existe autorização ativa
(`revoked_at is null`, token cifrado presente e não expirado) **e** a Meta
devolveu o ativo na varredura atual **e** o ativo não está conectado por uma
conexão não revogada. Cache antigo nunca é usado como fallback de autorização.

## 5. Pendências conhecidas

- `META_BUSINESS_CONFIG_ID` não configurado: o app usa escopos legados, e a Meta
  pode não oferecer a tela de seleção de ativos do portfólio. Recomendado criar
  uma configuração de Facebook Login for Business e definir esse secret.
- 77 avisos do linter de segurança do Supabase são **pré-existentes** ao projeto
  (RLS sem política em tabelas internas, extensões no schema public, funções
  SECURITY DEFINER executáveis, proteção de senha vazada desabilitada) e não
  foram corrigidos nesta fase.
