# Auditoria — estado de autorização Meta na Central de Canais

## Fluxo traçado

OAuth → `/api/public/meta/callback` grava `meta_oauth_sessions` (token de usuário
cifrado, `pages` vazio) → `listDiscoveredMetaAccountsFn` escaneia o Graph com
essa sessão e devolve “Contas disponíveis” → seleção/vínculo grava
`social_connections` (+ `client_social_accounts`) → painel “Portfólio Meta do
workspace” lia `getMetaPortfolioStatusFn`.

## Causa raiz

`getMetaPortfolioStatusFn` construía a lista de portfólios **exclusivamente a
partir de `social_connections`**; a sessão OAuth só era usada para o nome de quem
autorizou (e ainda filtrada por `user_id`). Com autorização válida e zero contas
vinculadas, `portfolios` vinha vazio e a UI (que usava `portfolios.length` como
“está conectado?”) imprimia “Nenhum portfólio Meta autorizado”, enquanto a
descoberta — que filtra apenas `brand_id` + `revoked_at IS NULL` + token não
expirado — listava as 87 contas. Estado inválido, não dado corrompido.

## Fontes de verdade adotadas

- Autorização Meta: `meta_oauth_sessions` (`brand_id`, `revoked_at IS NULL`,
  `user_token_ciphertext` presente, `user_token_expires_at` nulo ou futuro).
  Mesmo predicado da descoberta — se alimenta “Contas disponíveis”, autoriza.
- Canais conectados: `social_connections` (status != `revoked`).
- Vínculo com cliente: `client_social_accounts`.

Autorização é do workspace (por isso não é filtrada por `user_id`; o filtro por
usuário era justamente parte do estado divergente). Nenhuma linha artificial é
criada em `social_connections`.

## Contas “Não disponível”

São conexões históricas em `social_connections` cujo `external_id` a Meta não
devolve na autorização atual (`status` revoked/expired/needs_reauth, marcadas por
`reconcileMetaConnectionFn`/revogação). Não são cache: a descoberta filtra
sessões revogadas e não usa `pages` de sessão inválida. Permanecem como
histórico, exigindo novo OAuth para voltar.

## Alterações

- `src/lib/meta/authorization-state.ts` (novo): `isSessionAuthorized` e
  `buildMetaPortfolioStatus` (lógica pura).
- `src/lib/meta/portfolio-admin.functions.ts`: status combina conexões +
  sessões ativas; expõe `authorized` e `portfolio.authorized`.
- `src/components/connections/channels-center.tsx`: painel usa `authorized ||
  portfolios.length`, mostra “Selecionar contas (n)” e o aviso de portfólio
  autorizado sem canais.
- `tests/meta-authorization-state.unit.test.ts` (novo): 5 cenários de aceite.

Nada foi alterado em banco, RLS, OAuth, webhook ou secrets.
