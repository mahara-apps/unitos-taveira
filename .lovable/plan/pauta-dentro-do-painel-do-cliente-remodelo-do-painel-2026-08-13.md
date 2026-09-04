# Pauta dentro do painel do cliente + remodelo do painel

## Diagnóstico (confirmado)

`src/routes/_authenticated/customers.$customerId.tsx` é a rota-pai de `.../pauta`, `.../brain` e `.../media-plan`, mas o componente dela renderiza as abas e **não renderiza `<Outlet />`**. Com isso, ao abrir `/customers/{id}/pauta` o router monta o pai e a tela filha nunca aparece — é exatamente o "pauta não carrega". Hoje também não existe nenhum link para a pauta dentro do painel do cliente.

## O que vamos fazer

### 1. Pauta como aba nativa do painel
- A pauta passa a ser uma aba do painel do cliente: `/customers/{id}?tab=pauta`.
- O conteúdo atual da pauta (hoje dentro do arquivo de rota, ~1.4k linhas) é extraído para um componente reutilizável, sem mudar nenhuma lógica, query, mutation ou validação existente.
- A rota antiga `/customers/{id}/pauta` continua funcionando: passa a redirecionar para a aba (mesmo padrão já usado hoje em `briefing`), preservando `?planId=` quando existir.
- `brain` e `media-plan` continuam como sub-rotas; o painel passa a renderizar `<Outlet />` corretamente para não quebrar mais nenhuma filha.

### 2. Navegação do painel reorganizada
Nova ordem de abas, agrupada por fluxo de trabalho real:

```text
Visão geral | Briefing | Estratégia IA | Pauta | Canais | Gestão da conta | Cadastro
```

- Abas ganham indicadores discretos (ex.: contador de itens da pauta aguardando decisão, alerta de briefing incompleto).
- Aba ativa continua sincronizada com `?tab=`, então links diretos e refresh mantêm a posição.

### 3. Redesenho visual (sem mudar dados)
- **Header do cliente**: avatar/inicial com cor do cliente, nome, nicho, status e ações principais (Completar onboarding, ir para Pauta) em uma faixa mais sólida, no lugar do header quase vazio de hoje.
- **Visão geral**: cards com hierarquia e cor semântica (briefing, estratégia, pauta, canais conectados) em vez do bloco monocromático atual, cada card levando para a aba correspondente.
- **Abas**: barra de abas com espaçamento e estado ativo mais legíveis; conteúdo com largura e respiro consistentes com o resto do sistema.
- Skeleton de carregamento atualizado para refletir o novo header/abas, evitando a sensação de tela em branco.

Nada de lógica de negócio, permissões, queries ou schema muda nesta etapa.

## Detalhes técnicos

- `customers.$customerId.tsx`: adicionar `pauta` ao enum de `validateSearch`, incluir `<TabsContent value="pauta">` e renderizar `<Outlet />` para as sub-rotas remanescentes.
- Novo `src/components/monthly-plan/pauta-workspace.tsx` (ou similar): recebe `brandId`/`clientId`/`planId` por props; o arquivo de rota vira um wrapper fino. `usePageHeader` sai do componente extraído (o header passa a ser do painel).
- Redirect da rota `pauta` seguindo o padrão de `customers.$customerId.briefing.tsx`.
- Verificar depois se os links existentes para `/customers/$customerId/media-plan` e `/brain` continuam navegando com o novo `<Outlet />`.

## Fora de escopo agora

Redesenho interno de cada aba (Briefing, Estratégia, Canais, Cadastro, Gestão) — pode vir em grupos aprovados depois, no mesmo modelo dos grupos anteriores.
