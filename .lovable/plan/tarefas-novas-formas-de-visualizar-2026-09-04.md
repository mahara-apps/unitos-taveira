# Tarefas: novas formas de visualizar

Somente a camada de visualização de `/tasks`. Nada muda em banco, permissões, filtros existentes ou regras de negócio — as mesmas tarefas já carregadas passam a ter mais formatos de leitura.

## O que existe hoje

Quatro visões em abas de texto: Lista, Kanban (por status), Calendário e Minhas tarefas. Filtros, KPIs clicáveis, agrupamento, ordenação e o painel de detalhe da tarefa continuam iguais.

## O que será adicionado

1. **Seletor de visão em ícones** — a barra de abas passa a ser um grupo compacto de botões com ícone e tooltip (como na referência), mantendo a visão atual na URL para poder ser compartilhada/favoritada.

2. **Kanban por responsável** — mesma mecânica do Kanban atual, mas cada coluna é uma pessoa (mais a coluna "Sem responsável"), com contagem no topo e ordenação alfabética. Arrastar um cartão entre colunas reatribui o responsável. Cada cartão mostra título, cliente/projeto, prazo e progresso de subtarefas.

3. **Timeline do mês** — grade com as pessoas nas linhas e os dias do mês nas colunas. Cada tarefa aparece como barra do início ao prazo (tarefa sem início ocupa apenas o dia do prazo). Navegação mês anterior/próximo, destaque do dia atual, fins de semana sombreados, cor por status e clique abre a tarefa.

4. **Lista mais densa** — a linha da lista fica mais próxima da referência: título em destaque, cliente/projeto em segunda linha, prazo colorido quando atrasado, avatar do responsável e status como etiqueta à direita. Continua com seleção, agrupamento e ordenação atuais.

5. **Rodapé de contagem** — "Exibindo X de Y tarefas" abaixo do conteúdo, para dar noção de filtro aplicado.

Todas as visões respeitam os filtros e a busca já existentes, e o clique em qualquer item abre o mesmo painel de detalhe de hoje.

## Detalhes técnicos

- `src/components/tasks/task-views.ts`: incluir `board-assignee` e `timeline` em `VIEWS`/`VIEW_META`; `searchSchema` já usa `catch`, então URLs antigas seguem válidas.
- `src/components/tasks/task-kanban.tsx`: parametrizar por `groupMode: "status" | "assignee"`, reutilizando o card e o `DndContext`; no modo responsável a mutação grava `assignee_id` via `updateTaskFn` (já existente).
- Novo `src/components/tasks/task-timeline.tsx`: puramente derivado de `TaskRow` (`start_date`, `due_at`, `assignee_id`, `assignee_name`, `assignee_avatar`, `status`), sem chamadas novas ao servidor.
- Novo `src/components/tasks/view-switcher.tsx`: botões com ícone + tooltip, usado no lugar do `Tabs` em `src/routes/_authenticated/tasks.tsx`.
- `src/components/tasks/task-table.tsx`: ajustes visuais de densidade/hierarquia nas linhas; colunas, seleção e ordenação preservadas.
- Sem migração, sem alteração em `tasks.functions.ts` além de nada; sem novos endpoints.
