# Ver arquivados/concluídos e prazo nas tarefas

## O que muda

### 1. Filtro de visibilidade nos três pontinhos (3 telas)

Em cada nível da hierarquia (projeto → job → tarefa) o menu de ações "⋯" ganha um bloco
"Exibir" com quatro opções, e o filtro escolhido fica lembrado enquanto você navega:

- Ativos (padrão)
- Concluídos
- Arquivados
- Todos

Onde entra:

- **Lista de projetos** (`/projects`) — o menu de cada card/linha continua igual; o bloco
  "Exibir" entra no menu de ações da própria tela (topo da lista), aproveitando o filtro de
  status que já existe, agora incluindo "Arquivados" de forma explícita.
- **Tela do projeto** (`/projects/$projectId`) — menu do cabeçalho (onde hoje ficam
  "Configurações do projeto" e "Arquivar") passa a ter também o bloco "Exibir", que controla
  a lista de jobs.
- **Detalhe do job (tarefas)** — mesmo bloco "Exibir" no menu do job, controlando as tarefas.

O botão solto "Ver concluídos / Ocultar concluídos" sai; a função dele passa a viver nesse
menu, sem perder nenhum comportamento atual.

### 2. Prazo de entrega da tarefa

- Ao criar uma tarefa dentro de um job, aparece um campo de data ao lado do título
  (opcional — pode ficar vazio e ser preenchido depois).
- A data aparece na linha da tarefa e continua editável no painel da tarefa, como hoje.
- Tarefas com prazo vencido aparecem destacadas como atrasadas.

### 3. Filtro por prazo nas tarefas

No mesmo menu "⋯" da lista de tarefas do job, um bloco "Prazo" com:
Todos · Atrasadas · Hoje · Amanhã · Próximos 7 dias · Sem prazo.

A tela geral de Tarefas já tem esses filtros; o novo bloco usa exatamente as mesmas regras,
sem criar uma segunda definição de "atrasada".

## Detalhes técnicos

- Sem migração: `tasks.due_at`, `project_jobs.due_at`, `projects.status/archived_at` e
  `archived_at` das tarefas já existem, e as funções de leitura já aceitam
  `archive: "active" | "all"`. O backend só é ajustado se for necessário aceitar
  `archive: "archived"` (somente arquivados) em `listJobsFn`/`listTasksFn`.
- Componente único de filtro reutilizado nos três menus, para o rótulo e a semântica
  serem idênticos; o estado do filtro fica na URL (search param) quando a tela já usa
  search params, ou em estado local caso contrário.
- Regras de prazo (`isOverdue`, faixas hoje/amanhã/7 dias) reaproveitadas de
  `src/components/tasks/task-toolbar.tsx` / `shared.tsx` e do fuso oficial
  `America/Sao_Paulo` (`src/lib/timezone.ts`) — nenhuma lógica duplicada.
- `createTask` já aceita `due_at`; a criação rápida no job passa a enviá-lo.
- Nada muda em permissões, RBAC/RLS, rotas ou nas demais telas.
- MASTER-first: delta regenerado, `delta_version.txt` + `MASTER_RELEASE_VERSION` na mesma
  nova versão e `bun run master:check` verde antes de concluir.

## Verificação

- Arquivar um job e uma tarefa e recuperá-los pelo filtro "Arquivados" de cada nível.
- Criar tarefa com e sem prazo; conferir destaque de atrasada e os filtros de prazo.
- Typecheck, build e testes de filtros de tarefas.
