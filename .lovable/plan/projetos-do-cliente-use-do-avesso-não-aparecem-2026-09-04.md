# Projetos do cliente "Use do avesso" não aparecem

## O que eu confirmei no banco

O cliente **Use do avesso** (workspace Unitos Master) **tem 3 projetos ativos**, nenhum arquivado:

- Pauta — Elegância Descomplicada: Versatilidade Autoral para a Rotina Real
- Modelo Redes Mensal
- novo taveira

Todos com `brand_id` correto, `status = active`, `archived_at` nulo, e 50 publicações ligadas. As policies de RLS de `projects` permitem a leitura para o seu usuário. Ou seja: **os dados existem e não há bloqueio de permissão**.

## O que está acontecendo na tela

Inspecionando o estado real da página `/projects`:

- a consulta `["projects", brandId, ..., clientId(Use do avesso)]` está **presa em "carregando" indefinidamente** (status `pending`, 0 falhas registradas);
- a mesma função de servidor já respondeu com sucesso para outro cliente (6 projetos), então a consulta em si funciona;
- enquanto isso a tela mostra **esqueletos cinza para sempre** e o rodapé de filtros exibe **"0 projetos"**, e os KPIs mostram **0**, como se o cliente não tivesse nada. Foi isso que você viu.

O problema, portanto, é de **resiliência da tela**: quando a requisição demora, falha ou é interrompida (troca de cliente, aba em segundo plano, rede instável), a interface não tem saída — nunca desiste, nunca avisa, e ainda mostra números zerados que parecem dados reais. Hoje também não há diferença visual entre "erro" e "nenhum projeto": um erro cai no mesmo texto "Nenhum projeto encontrado".

## Correção proposta (frontend, sem mexer em dados nem em permissões)

1. **Timeout + cancelamento na busca de projetos**: a chamada passa a ter limite de tempo (~20s) e é abortada quando o cliente ativo muda, evitando requisições penduradas.
2. **Retry automático limitado** com backoff curto para falhas transitórias de rede.
3. **Estado de erro explícito**: painel com mensagem clara ("Não foi possível carregar os projetos") e botão **Tentar novamente**, distinto do estado vazio.
4. **Estado vazio honesto**: "Nenhum projeto para este cliente" só aparece quando a resposta realmente chegou vazia.
5. **KPIs e contador não mentem durante o carregamento**: mostram "—" em vez de 0 enquanto a consulta não respondeu.
6. **Aviso de lentidão**: se passar de ~8s carregando, aparece uma linha discreta "Está demorando mais que o normal" com ação de recarregar, em vez de esqueleto infinito.
7. Mesmo tratamento aplicado às consultas auxiliares da tela (clientes e equipe), que hoje também podem ficar penduradas e deixar filtros vazios.

## Detalhes técnicos

- Arquivo principal: `src/routes/_authenticated/projects.index.tsx` (consulta `projectsQ`, blocos de `isLoading`/vazio, `kpis`, contador de linhas).
- `queryFn` recebe `AbortSignal` do TanStack Query e um `AbortController` com timeout; `retry: 2` com `retryDelay` progressivo.
- Novo bloco de erro reutiliza `DashboardPanelSurface` + `Button` com `projectsQ.refetch()`; nada de componente novo de KPI (KPIs continuam em `KpiCard`/`PageKpi`).
- Sem alteração em `src/lib/projects.functions.ts`, em RLS, schema, filtros de negócio ou regras de arquivamento.

## Fora do escopo

Não mexer em banco, RLS, funções de servidor, nem no comportamento de arquivar/concluir projetos.
