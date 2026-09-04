# Alargar painel de Comentários · Anexos e links (+50%) em Projetos

## Contexto
No detalhe do projeto, o painel lateral com as abas **Comentários** e **Anexos e links** (`ContextTabs`) tem apenas **380px** de largura, e no modal de job **400px**. Fica estreito para leitura de comentários e links. Mudança somente visual — nenhuma lógica, query, permissão ou dado é alterado.

## Alterações

### 1. Visão geral do projeto (`src/components/projects/jobs-panel.tsx`)
- Linha do grid da visão geral: `lg:grid-cols-[minmax(0,1fr)_380px]` → `lg:grid-cols-[minmax(0,1fr)_min(600px,45vw)]`
  - 380px → até 600px (**+58%**), com teto em % da viewport para não sufocar telas médias.
- No contêiner do painel (coluna direita), adicionar margem à esquerda: `lg:pl-8` — o conteúdo ganha respiro entre o divisor e as abas.
- Passar `contentClassName="px-6 py-5"` para o `projectContext` (o `ContextTabs` já aceita essa prop), aumentando o padding interno das abas.

### 2. Modal de job (`src/components/projects/job-detail-modal.tsx`)
- Grid interno: `lg:grid-cols-[minmax(0,1fr)_400px]` → `lg:grid-cols-[minmax(0,1fr)_min(600px,45vw)]` (**+50%**).
- Coluna do `aside` recebe `lg:pl-8` para a mesma margem esquerda.

### 3. Painel de tarefa (`src/components/projects/task-timesheet-sheet.tsx`)
- Nenhuma mudança estrutural: já é modal largo de coluna única; apenas acompanha o novo padding se reutilizar o `ContextTabs` (não reutiliza — fica como está).

## Não altera
- Banco, RLS, RBAC, server functions, regras de negócio, filtros ou fluxos existentes.
- `pauta-detail-modal` e demais modais não citados.

## Validação
- `tsgo --noEmit` + build.
- Conferir no preview (`/projects/:id`) que o painel fica ~600px, com margem à esquerda, sem quebrar o layout em telas menores (a coluna cai para empilhado abaixo de `lg`, comportamento atual mantido).
