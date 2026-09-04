# Projetos > Jobs > Tarefas: hierarquia, responsáveis, status e comentários

Reorganizar a área de Projetos para que a hierarquia fique explícita e navegável (referências enviadas), e completar responsabilidade, datas, status cadastráveis e conclusão/arquivamento em cada nível — sem quebrar dados, permissões ou o fluxo pauta → produção.

## Hierarquia final

```text
Projeto  (responsável + envolvidos, datas, status, progresso, comentários)
  └── Job  (responsável, datas, status, comentários)  ex.: Pautas, Fazer criativos, Relatórios
        └── Tarefa  (responsável, datas, status, comentários)  ex.: Design cria peças, Ajustar peça 2
```

## 1. Tela do Projeto (Visão geral)

- Cabeçalho enxuto: cliente, período, status, responsável e badge da pauta.
- Faixa de progresso como hoje.
- Bloco **Jobs** como conteúdo principal: linhas densas com nome, tarefas concluídas/total, tempo somado, prazo, responsável (avatar) e status — no espírito da tela "JOBS / Pauta" da referência.
- Rodapé/faixa **Envolvidos no projeto** com avatares e botão para adicionar/remover pessoas.
- Painel lateral direito com **Comentários** do projeto.
- O bloco atual "Itens da pauta / Peças do projeto" passa a ser o job **Pautas**.

## 2. Job "Pautas" automático

- Projeto com pauta vinculada mostra um job fixo **Pautas** listando os itens da pauta (mesma consulta, mesmos estados e botão "Abrir peça").
- Não pode ser renomeado nem excluído (é derivado da pauta). Peças sem tópico de pauta aparecem nele como "Fora da pauta".

## 3. Visão do Job

- Esquerda: navegação entre jobs. Centro: tarefas do job. Direita: comentários do job.
- Breadcrumb `Projeto > Job`.
- Cabeçalho do job editável: responsável (1 pessoa), início/prazo, status, e "Concluir job".

## 4. Tarefa

- Detalhe (drawer) com breadcrumb `Projeto > Job > Tarefa`: responsável único, início/prazo, status, prioridade, estimativa, timesheet, subtarefas e comentários.
- Botão **Concluir** marca como concluída e arquiva automaticamente.

## 5. Responsáveis e envolvidos

- **Responsável**: exatamente 1 usuário em cada nível (projeto, job, tarefa). Projeto e tarefa já têm esse campo; job passa a ter.
- **Envolvidos**: lista de pessoas no nível do **projeto**. Jobs e tarefas herdam essa lista — os seletores de responsável de job/tarefa oferecem primeiro os envolvidos do projeto (com opção de escolher qualquer membro do workspace com acesso ao cliente).
- Adicionar alguém como responsável de um job/tarefa inclui a pessoa nos envolvidos do projeto automaticamente.

## 6. Datas, status cadastráveis e conclusão

- Datas de **início** e **prazo** em projeto, job e tarefa.
- **Status cadastráveis por workspace**, com escopo (projeto / job / tarefa): nome, cor, ordem, marcador "conclui" e "padrão". Gerenciados em Configurações; enquanto não houver status cadastrados, valem os status atuais como padrão (nada quebra).
- **Concluir** em qualquer nível: grava data de conclusão e arquiva automaticamente (sai das listas ativas).
- Filtro/aba **Concluídas** (e arquivadas) em cada nível, para consultar e, se preciso, reabrir.

## 7. Comentários / observações em 3 níveis

- Projeto, Job e Tarefa com fio próprio de comentários (autor, data, avatar, exclusão pelo autor).
- Tarefa reutiliza o que já existe; projeto e job usam a nova tabela de comentários de trabalho.

## Detalhes técnicos

Banco (uma migration, tudo aditivo e com GRANTs + RLS):

- `public.work_comments`: `brand_id`, `project_id`, `job_id` nullable, `author_id`, `body`, `mentions`. Policies via `can_access_project(project_id, auth.uid())`; exclusão só pelo autor.
- `public.project_participants`: `brand_id`, `project_id`, `user_id`, `created_at`, único por (projeto, usuário). Mesmas regras de acesso do projeto.
- `public.work_statuses`: `brand_id`, `scope` ('project' | 'job' | 'task'), `name`, `color`, `position`, `is_done`, `is_default`. Leitura para membros do workspace; escrita conforme `workspaceAdminActions`.
- `project_jobs`: novas colunas `assignee_id`, `start_date`, `due_at`, `status_id`, `done_at`, `archived_at`.
- `projects`: novas colunas `status_id`, `done_at`, `archived_at` (a coluna `status` enum atual continua existindo e sendo espelhada, para não quebrar telas/filtros).
- `tasks`: nova coluna `start_date` e `status_id`; `done`, `done_at`, `archived_at` já existem e passam a ser gravados juntos ao concluir.

Código:

- `src/lib/work-comments.functions.ts`, `src/lib/project-participants.functions.ts`, `src/lib/work-statuses.functions.ts` — `createServerFn` + `requireSupabaseAuth`, no padrão de `tasks.functions.ts`.
- `src/lib/project-jobs.functions.ts`: incluir os novos campos no select/patch e ações de concluir/reabrir; listagem separa ativos de arquivados.
- `src/lib/projects.functions.ts` e `src/lib/tasks.functions.ts`: aceitar `status_id`, `start_date` e conclusão com arquivamento.
- Componentes novos: `comment-thread.tsx` (usada nos 3 níveis), `assignee-picker.tsx`, `involved-people.tsx`, `status-picker.tsx` (lê `work_statuses` com fallback aos status atuais).
- `src/routes/_authenticated/projects.$projectId.tsx`: remove o toggle `showJobs`, promove `JobsPanel` a conteúdo principal, converte itens da pauta no job virtual "Pautas", adiciona envolvidos e comentários.
- `src/components/projects/jobs-panel.tsx`: job virtual "Pautas" (id sintético, sem renomear/excluir), breadcrumb, cabeçalho do job com responsável/datas/status/concluir, aba "Concluídas".
- `ProjectTasksPanel` deixa de ser seção duplicada na visão geral; o componente permanece no repositório.
- KPIs via `PageKpi`/`PageKpiGrid`; cores/tipografia só por tokens semânticos; datas via `src/lib/timezone.ts` (America/Sao_Paulo).
- Ao final: `tsgo --noEmit`, testes relacionados e build.

Fora de escopo: alterar o fluxo de aprovação de pauta, RBAC e RLS existentes.
