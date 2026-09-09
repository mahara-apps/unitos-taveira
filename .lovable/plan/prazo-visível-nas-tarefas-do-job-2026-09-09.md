# Prazo visível nas tarefas do job

## O que está acontecendo

A data que você digita ao criar a tarefa não é gravada. O campo de data existe na tela e é enviado, mas a rotina que cria a tarefa no banco ignora esse valor e salva a tarefa sem prazo. Por isso a lista nunca mostra data: ela já sabe exibir o prazo (inclusive em vermelho quando atrasado), só não tem o que exibir.

Tarefas que recebem prazo depois, pela tela de detalhe da tarefa, gravam normalmente — o problema é só na criação rápida.

## O que vou fazer

1. **Gravar o prazo na criação** — a data digitada ao lado de "Adicionar uma tarefa" passa a ser salva junto com a tarefa.

2. **Prazo visível na linha da tarefa** — cada tarefa mostra a data de entrega (dd/mm), em vermelho quando estiver atrasada e sem data quando não houver prazo. Clicar na data abre um seletor para ajustar ali mesmo, sem abrir a tarefa.

3. **Responsável em formato compacto** — no lugar do nome por extenso fica só o círculo com a inicial (ou a foto). Ao passar o mouse aparece o nome completo; clicar continua abrindo a lista para trocar de responsável. Isso libera a largura que a data vai ocupar.

4. **Mais espaço para as tarefas** — a janela fica um pouco mais larga e a coluna de comentários encolhe cerca de 20%, sobrando espaço para títulos de tarefa maiores. Em telas menores nada muda: comentários continuam embaixo.

Nada de permissões, rotas ou regras de negócio muda. Nenhuma tarefa existente é alterada.

## Detalhes técnicos

- `src/lib/project-jobs.functions.ts`: `createJobTaskFn` ganha `due_at` (opcional, nulável) no validador e no insert — hoje o Zod descarta a chave silenciosamente. `updateJobTaskFn` já aceita `due_at`.
- `src/components/projects/jobs-panel.tsx`: `renderTaskRow` passa o `AssigneePicker` em modo compacto (só avatar + `title`/tooltip) em todas as larguras e um controle de data no slot `status`/novo slot, gravando via `patchTaskMut`.
- `src/components/projects/work-item-row.tsx`: `dateLabel` aceita `ReactNode` para permitir o chip editável, mantendo o comportamento atual de `overdue`.
- `src/components/projects/job-detail-modal.tsx`: `DialogContent` de `min(1200px,96vw)` para `min(1320px,96vw)`; grade de `min(600px,45vw)` para `min(480px,36vw)`.
- MASTER-first: sem migração; regenerar o pacote, subir `delta_version.txt` e `MASTER_RELEASE_VERSION` para 1.3.20 e rodar `bun run master:check`, typecheck e build.
