# Reformulação visual da área Projetos

## Objetivo

Aplicar à área **Projetos** a linguagem visual da referência enviada, sem alterar dados, permissões ou regras e sem retirar ações existentes. O trabalho ficará restrito à lista de projetos, ao detalhe do projeto e ao painel de job.

## 1. Lista de projetos

- Manter os quatro indicadores atuais — Projetos, Publicações, Aprovadas e Publicadas — usando exclusivamente o padrão `PageKpi`/`PageKpiGrid`, com barra superior semântica, rótulo discreto em maiúsculas, valor e contexto.
- Preservar a busca, o seletor Ativos/arquivados, o painel Filtros, o alternador Cards/Lista, os filtros ativos e o menu Novo projeto.
- Reformular os cartões para mostrar:
  - nome, cliente e status no cabeçalho;
  - pauta e período em etiquetas compactas;
  - progresso segmentado usando os dados já disponíveis: aprovadas, publicadas e pendentes;
  - legenda numérica dos segmentos e avatar/iniciais do responsável no rodapé.
- Manter o modo Lista, a ordenação, os estados de carregamento/erro/vazio e a navegação ao clicar.

## 2. Detalhe do projeto

- Preservar breadcrumb, título, cliente, pauta, responsável, status operacional, situação do projeto, Ver pauta, menu de ações e progresso total.
- Integrar a faixa de seis etapas ao mesmo bloco visual do cabeçalho:
  - Briefing `#64748b`
  - Em produção `#0ea5e9`
  - Em revisão `#e0a011`
  - Aprovado `#8b5cf6`
  - Agendado `#6366f1`
  - Publicado `#16a34a`
- Cada etapa continuará exibindo contagem e mini-barra e continuará filtrando o board quando clicada.
- Manter as abas Visão geral, Jobs & Pautas, Comentários e Anexos.
- Na área principal, apresentar **Jobs** e **Pautas** em dois painéis independentes lado a lado:
  - Jobs mantém busca, visibilidade, criação, conclusão, responsável, prazo, renomear, arquivar e excluir.
  - Pautas mostra o conteúdo real já vinculado, acesso ao board e botão **Nova pauta**, que abre a tela existente de Pautas conforme definido.
- Preservar também horas, envolvidos, matriz por rede/unidade e próximos prazos, reposicionando esses blocos sem removê-los.

## 3. Painel do job

- Reorganizar o painel existente segundo a referência, mantendo:
  - Concluir/Reabrir, responsável, status, datas de início e entrega e menu de ações;
  - lista de tarefas com conclusão, título, tempo registrado, timer, responsável, prazo e menu;
  - criação rápida de tarefa com prazo opcional;
  - Comentários e Anexos e links.
- Melhorar hierarquia, espaçamento e adaptação para telas menores sem alterar as mutações ou os dados.

## 4. Limites e compatibilidade

- Nenhuma alteração de banco, permissões, consultas ou modelo de dados.
- Nenhuma outra tela será alterada; o botão Nova pauta apenas encaminhará ao fluxo existente.
- Componentes atuais serão reaproveitados, e nenhuma função existente será removida.
- Cores visuais serão aplicadas por tokens semânticos globais, com suporte aos temas claro e escuro.

## 5. Validação e MASTER-first

- Validar lista, detalhe e painel de job em desktop e celular, incluindo alternância Cards/Lista, filtros, abas, abertura do job e acesso às pautas.
- Executar checagem de tipos, testes afetados, verificação de formatação e build.
- Regenerar o pacote do MASTER, sincronizar `delta_version.txt` e `MASTER_RELEASE_VERSION` na próxima versão, conferir a verificação de instalação e executar `bun run master:check`.
- Não publicar nem atualizar instalações sem autorização explícita.

## Detalhes técnicos

- Arquivos principais: `src/routes/_authenticated/projects.index.tsx`, `src/routes/_authenticated/projects.$projectId.tsx`, `src/components/projects/project-card.tsx`, `project-header.tsx`, `stage-funnel.tsx`, `jobs-panel.tsx` e `job-detail-modal.tsx`.
- A lista atualmente disponibiliza `total`, `approved`, `published` e `pending`; a barra segmentada usará exatamente esses valores, conforme a decisão tomada.
- O painel de Jobs será reorganizado por apresentação, mantendo as funções e estados existentes como fonte única das ações.
