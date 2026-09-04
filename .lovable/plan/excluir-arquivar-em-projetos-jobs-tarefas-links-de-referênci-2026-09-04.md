# Excluir/arquivar em Projetos › Jobs › Tarefas + Links de referência

## Parte 1 — Situação atual (verificada no código)

| Nível | Excluir | Arquivar | Desarquivar | Ver arquivados |
|---|---|---|---|---|
| Projeto | Sim (menu do projeto) | Sim (vira status "Arquivada") | **Não existe** | Sim (filtro na lista de projetos) |
| Job | Sim (menu do job) | Só indiretamente: ao "Concluir" o job ele é arquivado | Só desmarcando "Concluir" | Parcial: o toggle "mostrar concluídos" mistura tudo |
| Tarefa | Sim, mas só na tela /tasks | Sim, só na tela /tasks | Sim, só na tela /tasks | Sim (filtro em /tasks) |

Ou seja: dentro da tela do projeto não dá para arquivar/restaurar/excluir uma tarefa, não existe "arquivar job" separado de "concluir job", e projeto arquivado não tem botão de restaurar.

## Parte 1 — O que será feito

Padronizar as três ações nos três níveis, com o mesmo vocabulário:

- **Concluir** — marca como feito e arquiva automaticamente (comportamento atual mantido).
- **Arquivar / Restaurar** — sai (ou volta) das listas ativas, sem perder nada.
- **Excluir** — remove de vez, sempre com confirmação explícita e aviso do que acontece com os filhos.

Mudanças por nível:

1. **Projeto**: adicionar "Restaurar projeto" no menu quando estiver arquivado (volta para o status anterior ou "Em andamento"). Confirmação de exclusão passa a avisar que jobs, tarefas, comentários e links do projeto também serão removidos e que as peças de conteúdo apenas serão desvinculadas.
2. **Job**: separar "Arquivar job"/"Restaurar job" de "Concluir job" no menu; a exclusão continua desvinculando as tarefas (com aviso claro). Filtro do painel passa a ter Ativos / Arquivados / Todos em vez do toggle atual.
3. **Tarefa**: menu de contexto na linha da tarefa dentro do projeto com Concluir, Arquivar/Restaurar e Excluir — reaproveitando as funções que já existem em /tasks, sem criar regra nova.
4. **Regras de permissão**: mantidas como estão. Excluir projeto/job continua restrito a quem já pode hoje; arquivar/restaurar segue a mesma autoridade da edição do item.

### Detalhes técnicos (Parte 1)

- Novas funções de servidor: `setProjectArchivedFn` (arquivar/restaurar via status) e `setJobArchivedFn` (grava/limpa `archived_at` sem tocar em `done_at`); reutilizar `setTaskArchivedFn`, `deleteProject`, `deleteJobFn`, `deleteTaskFn`.
- `listJobsFn` e `listProjectTasksFn` já aceitam `archive: active|archived|all` — o painel passa a usar o parâmetro em vez de filtrar no cliente.
- Todas as ações mantêm `requireSupabaseAuth`, os guards `assertBrandMember`/`assertProjectScope` e invalidação das queries de projeto/jobs/tarefas.
- Sem migração de banco nesta parte (`archived_at` e `status` já existem).

## Parte 2 — Links de referência (Google Drive, Figma, etc.)

Hoje não há campo de link em projeto, job, tarefa nem na pauta; o cliente no portal só consegue escrever um comentário de texto. Será criado um recurso único de **Links** reutilizado em todos os níveis.

- Bloco "Links e referências" com URL + rótulo opcional, lista com ícone da origem detectada (Drive, Figma, YouTube, Dropbox, genérico), quem adicionou e quando, e botão de remover.
- Onde aparece: detalhe do projeto, job, tarefa (drawer), modal da pauta e **na tela pública de aprovação de pautas**, onde o cliente pode anexar o link da imagem/arquivo por pauta antes de aprovar.
- Links adicionados pelo cliente ficam marcados como "enviado pelo cliente" e geram notificação para o responsável do projeto (best-effort, não bloqueia o envio).
- URLs digitadas em comentários passam a ser clicáveis automaticamente.
- Somente links (URL). Upload de arquivo não entra neste escopo.

### Detalhes técnicos (Parte 2)

- Migração: tabela `public.work_links` com `brand_id`, `client_id`, alvo polimórfico (`project_id`, `job_id`, `task_id`, `post_id`, `topic_id`) com CHECK de exatamente um alvo, `url`, `title`, `source`, `created_by`, `created_by_client boolean`, `created_at`. GRANTs para `authenticated`/`service_role` (+ `anon` só se o portal usar token anônimo), RLS habilitada e policies: membros do workspace pelo escopo já usado em projetos/tarefas, e cliente do portal restrito aos links do próprio `client_id`/pauta via a função de sessão do portal já existente.
- Server functions `listWorkLinksFn` / `addWorkLinkFn` / `deleteWorkLinkFn` com validação Zod (apenas `http`/`https`, limite de tamanho, máximo de links por item) e função separada para o caminho do portal, que valida a sessão/token do cliente antes de gravar.
- Componentes novos: `work-links.tsx` (lista + formulário) e detecção de origem por hostname; integrado nos pontos citados sem alterar layout existente além do bloco novo.
- Testes: validação de URL/origem, exatamente-um-alvo, permissão do portal limitada ao próprio cliente, e notificação de link do cliente.
