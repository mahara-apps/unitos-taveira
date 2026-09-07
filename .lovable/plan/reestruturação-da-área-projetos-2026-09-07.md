# Reestruturação da área Projetos

Mudança de interface e navegação apenas na área **Projetos** (`/projects` e as telas de projeto). Nada de banco, permissões, server functions ou outras telas. Os dados continuam sendo os reais do sistema; o HTML anexo é usado como referência de layout, hierarquia e interação.

## Regra central deixada explícita na tela

Projeto → Jobs → Tarefas. A **Pauta é um tipo de Job** (job de conteúdo), e as tarefas dele são os itens de pauta por rede. Isso aparece como selo de tipo em cada job: "Pauta de conteúdo" ou "Job".

## 1. Lista de Projetos (`/projects`)

- Faixa de indicadores no topo: Projetos, Publicações, Aprovadas, Publicadas (usando o componente de KPI já padrão do sistema).
- Barra de filtros compacta: buscar (nome do projeto e do cliente), status, responsável, cliente.
- Cards de projeto com nome, cliente, pill de status, responsável e progresso; clique abre a visão geral do projeto.
- Estados de carregamento, vazio e contagem de resultados.

## 2. Projeto — Visão geral (`/projects/<id>`)

- Breadcrumb sempre visível: Projetos / Nome do projeto / Visão geral.
- Header com nome, cliente, pill de status e responsável.
- **Funil por estágio** no topo com contagem: Briefing, Em produção, Em revisão, Aprovado, Agendado, Publicado.
- Abas: Visão geral, Jobs & Pautas, Comentários, Anexos.
- **Uma única lista de Jobs** com selo de tipo, progresso, prazo e responsável.
- Painel lateral: matriz Unidade × Rede com contagem de itens e lista de próximos prazos.

## 3. Board de pautas (ao clicar num job de conteúdo)

- Navegação in-place com breadcrumb (Projetos / Projeto / Nome do job), não modal.
- Kanban pelas seis colunas de estágio, com filtros por Unidade e Rede e alternador Board / Lista / Matriz.
- Card de pauta: chip de unidade, rede, formato, título e responsável. Sem arte, placeholder neutro.

## 4. Drawer de detalhe da pauta

- Painel deslizante à direita, o board permanece visível atrás — nunca modal sobre modal.
- Briefing (ângulo, público, racional), metadados (rede, formato, unidade, publicação, prazo interno, prioridade, responsável), checklist de tarefas e ações Abrir em Conteúdo, Ver no Calendário e Editar.
- Tudo que o detalhe atual já faz (comentários, links, timesheet, troca de status e responsável) continua disponível dentro do drawer.

## 5. Página do Job comum

- Mesma navegação com breadcrumb, com a checklist de Tarefas (título, status, prazo, responsável) e as ações que já existem hoje.

## Cores

Ciclo único de seis estágios usado no funil, nos cards e no board, com legenda consistente: Briefing, Em produção, Em revisão, Aprovado, Agendado, Publicado — nas cores pedidas, adaptadas para funcionar bem no tema claro e no escuro. Os status reais do sistema são agrupados nesses seis para exibição; nada muda no banco. Chips de unidade nas cores Matriz, Loja Centro e Loja Shopping.

## Pontos de atenção (confirmados com você)

- **Unidades ainda não existem** nos dados. O chip e a matriz Unidade × Rede só aparecem quando houver esse dado; enquanto não houver, a matriz mostra as redes e um aviso curto de que unidades não estão configuradas. Criar o conceito exigiria mudança de banco, fora deste escopo.
- **Nada de dados fictícios**: a área continua ligada aos dados reais, como você escolheu.
- O detalhe de pauta hoje abre como janela expandida; passa a ser drawer lateral. Nenhuma ação é perdida.
- Nenhuma rota ou recurso atual deixa de existir: assistente de novo projeto, criar a partir de modelo, arquivar/excluir, horas do projeto, pessoas envolvidas, comentários, anexos/links e tarefas seguem funcionando.

## Detalhes técnicos

- Arquivos principais: `src/routes/_authenticated/projects.index.tsx`, `src/routes/_authenticated/projects.$projectId.tsx` e componentes em `src/components/projects/`.
- Novas rotas para deep-link in-place: `projects.$projectId.jobs.$jobId.tsx` (board de pauta ou página de job, decidido pelo tipo do job), mantendo `projects.$projectId.tsx` como layout com breadcrumb + `<Outlet />` e a visão geral em `projects.$projectId.index.tsx`.
- Novos componentes de apresentação: `stage-funnel.tsx`, `job-type-badge.tsx`, `pauta-board.tsx`, `pauta-card.tsx`, `unit-network-matrix.tsx`, `pauta-detail-drawer.tsx` (sobre o `Sheet` existente), `upcoming-deadlines.tsx`.
- Tokens de estágio de conteúdo em `src/lib/publication-status-tokens.ts` reaproveitados/estendidos com o agrupamento em seis estágios; variáveis de cor em `src/styles.css` já existentes para status são reutilizadas, adicionando apenas as de unidade.
- Sem migration. Queries e server functions atuais (`getProject`, `listPipelinesFn`, `loadBoardFn`, `listTasksFn`, `getPautaDetailFn`, jobs) permanecem iguais.
- Validações: `bunx tsgo --noEmit`, testes afetados e build.
- MASTER-first: regenerar o pacote delta, sincronizar `delta_version.txt` com `MASTER_RELEASE_VERSION` (1.2.8) e rodar `bun run master:check` antes de considerar concluído.
