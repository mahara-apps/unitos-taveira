# Listar todas as contas Meta (Páginas + Instagram) com precisão

## O que está acontecendo hoje

O scan da Meta busca as contas em um único lugar: `/me/accounts` — apenas as Páginas em que o seu usuário é **administrador direto**. Isso explica o resultado atual (56 Páginas, só 12 com Instagram):

- Páginas que pertencem a um **Portfólio Empresarial (Business Manager)** onde você é admin do portfólio, mas não admin direto da Página, não aparecem.
- Páginas de **clientes** (Páginas atribuídas ao seu portfólio como "Páginas de clientes") não aparecem.
- Contas do Instagram vinculadas à Página por outro tipo de vínculo (campo `connected_instagram_account`) não são lidas — o código só lê `instagram_business_account`, então a Página aparece "sem IG".
- Contas do Instagram atribuídas direto ao portfólio (sem Página administrada por você) não têm de onde vir.
- O login não pede `business_management`, permissão necessária para enxergar os portfólios (hoje ela só é pedida no canal "Ads").

Confirmado no código: `listPagesWithInstagram` faz apenas `pageLoop("/me/accounts")` e os campos pedidos incluem só `instagram_business_account`; `getMetaScopesForChannel` não inclui `business_management` para Facebook/Instagram.

## O que vou fazer

### 1. Varredura completa do portfólio
Agregar as contas de todas as fontes, sem duplicar (dedupe por ID):
- `/me/accounts` (Páginas administradas diretamente)
- `/me/businesses` → para cada portfólio: `owned_pages` e `client_pages`
- `/me/businesses` → `owned_instagram_accounts` e `client_instagram_accounts` (contas IG sem Página administrada)
- Paginação completa em todas as chamadas (limite 100 por página, seguindo `paging.next` — já existe o cuidado com `appsecret_proof`).

### 2. Detecção de Instagram mais precisa
Pedir `instagram_business_account` **e** `connected_instagram_account` na Página, e usar o que existir. Assim as Páginas que hoje aparecem "sem IG" passam a mostrar o @ correto.

### 3. Permissões
Incluir `business_management` nos escopos de Facebook e Instagram (e no conjunto padrão), para o token conseguir enumerar os portfólios. Quem já está logado precisará reautorizar uma vez — a tela avisa quando falta permissão (`missingScopes` já existe).

### 4. Vincular Página + Instagram juntos
Hoje ativar o Instagram cria só a conexão do IG. Vou passar a criar, no mesmo clique, também a conexão da Página do Facebook de origem (e vice-versa: ativar a Página vincula o IG dela quando existir), marcando as duas como vinculadas na lista. Isso é possível porque a restrição antiga do banco que limitava uma conta ativa por canal já foi removida.

### 5. Transparência na tela
- Contadores explícitos: total de Páginas, com IG, sem IG, contas IG isoladas, e quantos portfólios foram varridos.
- Aviso quando algum portfólio falhar no scan (ex.: sem permissão), em vez de simplesmente devolver menos contas.
- Busca por nome/@ e rolagem já existente mantidas, para achar entre ~50 contas.

## Detalhes técnicos
- `src/lib/meta/provider.server.ts`: refatorar `listPagesWithInstagram` para agregação multi-fonte (`/me/accounts`, `/{business}/owned_pages`, `/{business}/client_pages`, `/{business}/owned_instagram_accounts`, `/{business}/client_instagram_accounts`) com dedupe por `pageId`/`igId`; adicionar `business_management` em `getMetaScopesForChannel`.
- Páginas vindas do portfólio não trazem `access_token` no mesmo campo: buscar o token da Página via `/{page-id}?fields=access_token` sob demanda (no momento do vínculo), evitando 50+ chamadas no scan.
- `src/lib/meta/portfolio.functions.ts`: novo campo `standaloneInstagram` no `PortfolioResponse`, contadores e `scanWarnings`; em `linkMetaAccount`, vincular par Página+IG na mesma transação lógica (upsert por `brand_id,provider,external_id`).
- `src/components/connections/meta-portfolio-dialog.tsx`: exibir contas IG isoladas, contadores, avisos e o estado "Vinculada" para os dois canais do par.
- Sem mudanças de schema; o cache do scan continua em `meta_oauth_sessions` (botão "Sincronizar" força re-scan).
