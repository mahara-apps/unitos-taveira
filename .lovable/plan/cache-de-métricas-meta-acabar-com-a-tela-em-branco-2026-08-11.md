# Cache de métricas Meta — acabar com a tela em branco

## Problema

Hoje o cache das chamadas da API do Meta existe apenas na memória do servidor (`src/lib/social-analytics/cache.ts`, TTL 10 min, escopo do isolate). Consequências:

- Quando o isolate é reciclado (acontece com frequência), a próxima visita refaz todas as chamadas Graph do zero.
- No navegador, o React Query guarda os dados só em memória (`staleTime: 60s`, `gcTime` 5 min): qualquer reload ou volta para a tela de Analytics cai no `q.isLoading` e mostra o skeleton/branco esperando a API — parece falha de sistema.

## Solução (duas camadas, sem persistir métricas em banco)

### 1. Snapshot persistente no navegador

- Adicionar um persister do React Query (localStorage) aplicado só às queries de social analytics (`social-analytics`, `social-analytics-top`, e as demais chaves do dashboard por conexão), com validade de 24h e chave versionada por usuário/marca.
- Na volta à tela, os dados do último snapshot aparecem imediatamente; a atualização ocorre em background.

### 2. Render "stale-while-revalidate" no dashboard

- Em `src/components/analytics/social-analytics-dashboard.tsx`, deixar de bloquear em `q.isLoading`: renderizar os dados em cache (mesmo velhos) e exibir uma faixa discreta "Atualizando métricas… · dados de {hora}" enquanto `isFetching`.
- Skeleton só no primeiro acesso real (sem snapshot algum).
- Mostrar `generatedAt` do payload como "última atualização" e um botão de atualizar manual (invalida a query).
- Mesma abordagem para o painel por conexão (top posts) — hoje ele já tem skeleton próprio, passa a manter o conteúdo anterior visível.

### 3. Menos refetch redundante

- Subir `staleTime` das queries de social analytics para o mesmo TTL do servidor (10 min) e `gcTime` para 24h, com `placeholderData: keepPreviousData` ao trocar período/cliente (evita piscar branco ao mudar filtro).
- Manter a coalescência de requests que já existe no cache do servidor.

## Detalhes técnicos

- Dependência nova: `@tanstack/react-query-persist-client` + `@tanstack/query-sync-storage-persister`.
- Persistência configurada em `src/router.tsx` (ou wrapper no `__root.tsx`) com `dehydrateOptions.shouldDehydrateQuery` filtrando apenas as chaves de social analytics — nada de tokens ou dados de auth no localStorage.
- Nenhuma métrica é gravada no banco; a regra do módulo (`cache.ts`) continua valendo.
- Nenhuma mudança nos providers Meta nem no `service.server.ts` além de reuso do TTL exportado.
