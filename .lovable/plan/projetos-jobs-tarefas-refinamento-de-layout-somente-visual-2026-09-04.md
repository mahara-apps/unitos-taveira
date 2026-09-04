# Projetos › Jobs › Tarefas — refinamento de layout (somente visual)

Objetivo: aplicar a dinâmica dos anexos de referência — respiro, hierarquia clara por níveis e abertura em modal amplo — sem mexer em dados, permissões ou regras.

## O que muda

### 1. Visão geral do projeto (nível 1)
- Cabeçalho mantém identidade/cliente/responsável/status/ações, com mais respiro vertical e tipografia do título maior.
- Abaixo, faixa de indicadores em cartões espaçados (período, progresso de peças, tempo apontado quando existir), no lugar da linha comprimida atual.
- Coluna direita fixa com o painel de contexto do projeto em abas: Comentários · Anexos/Links · Histórico. Comentários do projeto passam a ser o conteúdo padrão dessa coluna.
- Bloco “Jobs 2/8” como cartão clicável de entrada, com contador e progresso — sem listar tudo já na visão geral.
- “Envolvidos no projeto” fixado no rodapé da área, em barra discreta.

### 2. Lista de Jobs (nível 2)
- Ao entrar em Jobs, a tela troca para o modo lista com voltar “‹ Visão geral” e trilha `JOBS / <job>`.
- Sidebar esquerda enxuta apenas com o contador de jobs e filtros de arquivados; a lista ocupa a largura principal.
- Cada linha de job ganha respiro (altura maior), numeração/ordem visível, contagem de tarefas, progresso `feitas/total`, responsável, data, status e menu `⋮` — mesma anatomia atual, apenas mais espaçada e alinhada em colunas fixas.
- Busca e filtro no topo da lista, alinhados à direita.

### 3. Job aberto (nível 2 → detalhe) em modal amplo
- Clicar no job abre modal grande (aprox. 1200px, altura ~90vh) em vez de trocar o painel lateral.
- Barra superior do modal: Concluir, responsável, datas, status, menu e fechar.
- Título com trilha `Cliente › Projeto` à direita.
- Corpo em duas colunas: à esquerda tarefas do job (linhas espaçadas, “Adicionar tarefa”, contador “Abertas 2/6”) e briefing/observações; à direita abas Comentários · Anexos/Links · Timesheet · Histórico.

### 4. Tarefa (nível 3)
- Mantém o drawer atual, mas com a mesma barra superior de ações (Concluir, responsável, data, status) e o mesmo conjunto de abas, para leitura idêntica nos três níveis.
- Espaçamento e larguras alinhados ao modal de job.

### 5. Pautas
- O job virtual “Pautas” segue na mesma lista e continua abrindo o modal de resumo da pauta já existente, agora com o mesmo padrão visual de barra/abas.

## Garantias
- Nenhuma alteração de banco, RLS, RBAC, funções server-side, queries ou regras de negócio.
- Todos os fluxos atuais preservados: concluir/arquivar/excluir, comentários por nível com @menções, links de referência, timesheet, filtros e paginação.
- Alterações concentradas em `project-header.tsx`, `work-item-row.tsx`, `jobs-panel.tsx`, `task-timesheet-sheet.tsx`, `pauta-detail-modal.tsx`, `comment-thread.tsx` e na rota de detalhe do projeto, mais um novo componente de modal de job e um de painel com abas de contexto.
- Tokens semânticos do design system; KPIs pelo `PageKpi`/`PageKpiGrid`.

## Detalhes técnicos
- Novo `job-detail-modal.tsx` reaproveitando a lista de tarefas hoje renderizada no painel central do `JobsPanel` (mesmos handlers e mutations, apenas realocados).
- Novo `context-tabs.tsx` unificando Comentários/Anexos/Timesheet/Histórico, usado por projeto, job e tarefa com os mesmos componentes já existentes (`CommentThread`, `WorkLinks`).
- Modo “visão geral × lista de jobs” controlado por estado local na rota, sem mudar rotas nem URLs.
