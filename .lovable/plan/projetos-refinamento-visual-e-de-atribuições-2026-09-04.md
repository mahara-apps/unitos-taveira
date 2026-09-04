# Projetos: refinamento visual e de atribuições

Mudança de UI/UX na área de Projetos, inspirada nas referências enviadas. Sem alterar banco, RBAC/RLS, servidor ou regras de negócio — apenas apresentação, layout e interação.

## 1. Cabeçalho do projeto (barra única)

Uma faixa só, alta o suficiente para respirar, no espírito da referência:

```text
[cor] Nome do projeto        Cliente: VFAX   [avatar resp.]  [status ▾]  [Concluir]  [⋮]
```

- Nome grande, truncado; ponto/faixa da cor do projeto à esquerda.
- Cliente em rótulo pequeno + nome (link para o cliente).
- Responsável como avatar clicável (abre o seletor), não como select largo.
- Status como pílula com cor do status cadastrado.
- Menu `⋮` reúne ações secundárias hoje espalhadas: Arquivar, Duplicar, Exportar, Excluir, Ver concluídos.
- Segunda linha fina e discreta: período, prazo, progresso `publicadas/total` + barra de 2px.
- Grid `grid-cols-[minmax(0,1fr)_auto]` no mobile, `flex` em `sm:`; `min-w-0`/`truncate` no bloco de texto e `shrink-0` nos widgets.

## 2. Estrutura de 3 colunas

```text
┌──────────┬─────────────────────────────┬──────────────┐
│ Jobs     │ JOBS / <job> · tarefas      │ Comentários  │
│ (lista)  │ linhas densas               │ do nível     │
│ 0/3      │                             │              │
├──────────┴─────────────────────────────┴──────────────┤
│ Envolvidos no projeto  [avatares] [+]                 │
└───────────────────────────────────────────────────────┘
```

- Coluna esquerda estreita (~220px): lista de jobs com contador `concluídos/total` no topo, item selecionado destacado por barra lateral, nome truncado e badge de status pequeno. "Pautas" fixo no topo com ícone.
- Centro: título `JOBS / <nome do job>` + botão "+ Adicionar", busca e filtro alinhados à direita, e as tarefas em linhas densas (44–48px).
- Direita (~320px): comentários do nível selecionado, colapsável por botão `‹ ›`; some no mobile e vira aba.
- Rodapé fixo do card com "Envolvidos no projeto" (avatares sobrepostos + botão `+`), como na referência.

## 3. Linha de job e de tarefa padronizadas

Mesma anatomia nos dois níveis, para leitura previsível:

```text
○  Nome                       ☰ 5   0/5   [avatar]   30/10   (Não iniciado)   ⋮
```

- Círculo à esquerda conclui o item (hover mostra check; concluído fica riscado e esmaecido).
- Contagem de subitens e `feitas/total` em números tabulares.
- Avatar do responsável (clique abre seletor inline).
- Datas compactas `01/10 – 30/10`; vermelho discreto quando atrasado.
- Pílula de status à direita e menu `⋮` com Concluir, Reabrir, Mover, Duplicar, Excluir.
- Hover com fundo `muted/40`; divisórias `divide-border/60`; sem sombras pesadas.

## 4. Detalhe do job/tarefa em drawer

Baseado no segundo screenshot:

- Faixa superior do drawer: `Concluir` (primário), responsável, prazo, timer `00:00 / 00:00`, status, contador de comentários, `⋮`, fechar.
- Abaixo: código/nome do item à esquerda e breadcrumb `Cliente > Projeto` à direita.
- Corpo em duas colunas: tarefas/subtarefas + campo de observação à esquerda; à direita abas **Comentários · Anexos · Timesheet · Histórico** (Anexos e Histórico entram como estados vazios informativos, sem backend novo).
- Reaproveita o `TaskTimesheetSheet` e o `CommentThread` já existentes.

## 5. Estados e detalhes finos

- Skeletons por linha (não spinner de tela cheia) para jobs, tarefas e comentários.
- Vazios com uma frase de orientação e ação primária ("Adicionar tarefa").
- Concluídos: alternador "Ver concluídos" no menu `⋮` do cabeçalho e contador ao lado do título.
- Sem cor fixa em classe: status/cliente/projeto usam tokens semânticos, e só a cor livre do banco entra via `style`.
- KPIs, se ficarem no topo, usam `PageKpi`/`PageKpiGrid`.
- Datas formatadas por `src/lib/timezone.ts` (America/Sao_Paulo).

## Detalhes técnicos

- `src/routes/_authenticated/projects.$projectId.tsx`: novo cabeçalho, layout de 3 colunas + rodapé de envolvidos; mantém as mesmas queries e mutations.
- `src/components/projects/jobs-panel.tsx`: extrai `JobSidebar`, `JobRow`, `TaskRow` e `WorkItemRow` compartilhado; comportamento de dados inalterado.
- Novos componentes de apresentação: `src/components/projects/work-item-row.tsx`, `job-sidebar.tsx`, `project-header.tsx`, `avatar-stack.tsx`.
- `task-timesheet-sheet.tsx`: reorganiza o cabeçalho do drawer e agrupa o painel direito em abas (`Tabs` do shadcn), reaproveitando `CommentThread`.
- `involved-people.tsx`: variante compacta com avatares sobrepostos para o rodapé.
- Nenhuma alteração em `*.functions.ts`, migrations ou policies.
- Ao final: `tsgo --noEmit`, testes relacionados e build.
