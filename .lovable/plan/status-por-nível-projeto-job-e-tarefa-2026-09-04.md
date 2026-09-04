# Status por nível: projeto, job e tarefa

## Situação atual

O cadastro já existe: **Configurações › Status de trabalho** (`/settings/work-statuses`), com três blocos separados (Projetos, Jobs, Tarefas). Cada status tem nome, cor e a marca "conta como concluído", e é gravado por workspace e por escopo — ou seja, os status de projeto, job e tarefa já são independentes.

O problema é de uso, não de modelo:

- Enquanto o workspace não cadastra nada, o seletor de status simplesmente **não aparece** nas telas de projeto/job/tarefa, então parece que o recurso não existe.
- A tela de cadastro não é alcançável de dentro de Projetos.
- O seletor não tem busca, ordenação por arraste, nem as "pílulas" coloridas das referências enviadas.

## O que será feito

### 1. Começar com status prontos (por escopo)
Botão "Usar conjunto sugerido" em cada bloco do cadastro, que cria uma lista inicial editável — diferente para cada nível:
- Projetos: Não iniciado, Em planejamento/briefing, Campanha ativa, Campanha pausada, Concluído (concluído), Cancelado (concluído)
- Jobs: Não iniciado, Em produção, Em revisão, Aprovado, Entregue (concluído)
- Tarefas: A fazer, Em andamento, Aguardando cliente, Bloqueado, Concluída (concluído)

Nada é criado automaticamente sem o clique, e tudo permanece renomeável/excluível.

### 2. Seletor de status no padrão das referências
Trocar o `Select` atual por um popover com:
- campo "Buscar status";
- pílula colorida + nome em cada opção, item "Sem status";
- atalho no rodapé: "Gerenciar status" (leva ao cadastro do escopo correspondente);
- quando o escopo não tem status cadastrado, mostrar um botão discreto "Definir status" que abre o cadastro, em vez de esconder tudo.

### 3. Ordem dos status
Setas ↑/↓ em cada linha do cadastro para definir a ordem em que aparecem no seletor e nas colunas de Kanban (usa o campo de posição que já existe).

### 4. Acesso rápido
Link "Status" no cabeçalho da tela de projeto e no modal de job, apontando para o cadastro do escopo.

## Escopo técnico

- Frontend: `src/components/projects/status-picker.tsx` (popover com busca), `src/routes/_authenticated/settings.work-statuses.tsx` (conjunto sugerido + reordenar), `project-header.tsx` / `job-detail-modal.tsx` (atalho).
- Backend: reutiliza `listWorkStatusesFn`, `createWorkStatusFn`, `updateWorkStatusFn`, `deleteWorkStatusFn` já existentes. Sem migração de banco, sem mudança de RLS/RBAC e sem alterar regras de conclusão/arquivamento.
