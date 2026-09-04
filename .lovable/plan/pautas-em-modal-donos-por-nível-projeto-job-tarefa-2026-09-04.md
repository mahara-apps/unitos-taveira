# Pautas em modal + donos por nível (Projeto › Job › Tarefa)

Duas melhorias na área de Projetos, sem sair da tela e sem mudar regras de negócio.

## 1. Modal da pauta dentro do job "Pautas"

Hoje cada item da pauta só tem o botão "Abrir peça", que troca de página para Conteúdo. Passa a ser:

- A linha inteira do item fica clicável e abre um **modal de resumo** sobre a tela do projeto.
- Conteúdo do modal:
  - capa/miniatura, título, canal, formato e status (aprovação/publicação) com as mesmas cores atuais;
  - agendamento e prazo, no fuso America/Sao_Paulo;
  - **dono do item** (responsável), editável pelo mesmo seletor usado em jobs e tarefas;
  - lista das tarefas de produção ligadas àquela pauta, cada uma abrindo o drawer de tarefa já existente;
  - fio de comentários do nível (mesmo componente de comentários usado em projeto/job/tarefa).
- Ações rápidas no rodapé do modal: "Abrir peça em Conteúdo" e, quando houver pauta vinculada, "Ver na pauta" — ambos como saída opcional, nunca mais como único caminho.
- Itens "Fora da pauta" (peças sem tópico) abrem o mesmo modal, sem o bloco de pauta.
- Navegação por teclado: Enter/Espaço abre, Esc fecha; o modal empilha sobre o drawer de tarefa sem conflito de foco.

## 2. Dono em cada nível

A estrutura de responsável único já existe em projeto, job e tarefa. O que muda é a clareza e a consistência:

- **Projeto**: seletor de dono no cabeçalho (já presente), rótulo padronizado como "Dono".
- **Job**: seletor de dono no cabeçalho do job e avatar na linha da lista (já presente), mesmo rótulo.
- **Tarefa**: seletor de dono na linha e no drawer (já presente), mesmo rótulo.
- **Item de pauta**: passa a ter dono editável no modal, gravado no responsável da tarefa de produção correspondente; quando a pauta ainda não gerou tarefa, o seletor aparece desabilitado com a explicação "disponível após a pauta virar produção".
- Em todos os níveis, escolher um dono continua incluindo a pessoa nos **Envolvidos do projeto**, como já acontece.
- Sem novo campo de banco: nada de coluna nova, migração ou mudança de permissão.

## Detalhes técnicos

- Novo componente `src/components/projects/pauta-detail-modal.tsx`, usando `ExpandedModal` (tamanho `md`), `AssigneePicker`, `StatusPicker` (somente leitura quando não houver status cadastrado), `CommentThread` e `WorkItemRow` para as tarefas ligadas.
- `src/routes/_authenticated/projects.$projectId.tsx`: o bloco `pautasContent` deixa de renderizar botões de link como ação principal; cada item vira linha clicável que seta o estado `openPautaId` e monta o modal com os dados já carregados (`items`, `extraPosts`, `it.tasks`). Sem nova query de peça.
- Mutação de dono do item reaproveita `patchTaskFn` já usado por `JobsPanel` (`assignee_id`), com invalidação das mesmas query keys.
- Rótulos "Responsável"/"Dono" unificados em `assignee-picker.tsx` (`aria-label` e placeholder) e nos cabeçalhos de projeto/job/tarefa.
- Sem alteração em `*.functions.ts` de projetos/jobs além do reuso existente, sem migração, sem mudança de RLS/RBAC.
- Cores e tipografia apenas por tokens semânticos; datas via `src/lib/timezone.ts`.
- Ao final: `tsgo --noEmit`, lint dos arquivos alterados e build.
