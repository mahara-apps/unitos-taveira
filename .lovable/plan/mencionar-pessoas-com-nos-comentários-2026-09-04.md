# Mencionar pessoas com @ nos comentários

Hoje o campo de comentários de projeto, job, tarefa e pauta é um texto simples. Só o painel antigo de tarefa tem um seletor de @, e mesmo ali a menção é gravada mas **ninguém é notificado** — não existe nenhuma notificação do tipo "menção" sendo criada no sistema.

## O que passa a funcionar

1. **Digitar `@` abre a lista de pessoas** em todo campo de comentário: projeto, job, tarefa e pauta. A lista mostra nome e avatar dos membros do workspace, filtra conforme você digita, e é escolhida com as setas + Enter ou com o clique. Ao escolher, o nome entra no texto como `@Nome Sobrenome`.

2. **Quem foi mencionado recebe notificação** no sino e na página de Notificações, na aba "Menções", com o texto do comentário e um link que abre direto o projeto, o job, a tarefa ou a pauta comentada. Quem se menciona a si mesmo não gera notificação, e menções repetidas do mesmo comentário não duplicam o aviso.

3. **A menção aparece destacada** no comentário já publicado (`@Nome` em cor de destaque), em todos os níveis.

4. **Somente pessoas do workspace** podem ser mencionadas — a lista vem dos membros e a validação é refeita no servidor, então não é possível notificar alguém de fora do escopo.

## Detalhes técnicos

- Novo `src/components/ui/mention-textarea.tsx`: `Textarea` + popover de sugestões, controlado por `value`/`onChange`, recebendo `people: {id, name, avatar_url}[]` e devolvendo os `mentions: string[]` resolvidos a partir do texto final (fonte de verdade é o texto, evitando IDs órfãos quando o autor apaga o `@Nome`).
- Novo `src/components/ui/mention-text.tsx`: renderiza o corpo do comentário destacando os nomes mencionados.
- `src/components/projects/comment-thread.tsx`: troca o `Textarea` pelo novo campo, carrega os membros por `listBrandAssigneesFn` (`["brand-assignees", brandId]`, já em cache) e passa `mentions` para `addWorkCommentFn`/`addTaskCommentFn` (ambos já aceitam esse parâmetro). Também passa a exibir o corpo com `MentionText`.
- `src/components/tasks/shared.tsx` (TaskDrawer): substitui o seletor manual atual pelo mesmo componente, mantendo o envio de `mentions`.
- Novo `src/lib/mention-notify.server.ts`: dado `{ brandId, authorId, mentions, title, body, href }`, filtra IDs que sejam membros de `brand_members`, remove o autor e insere via `insertNotificationsDeduped` com `kind: "mention"` e `dedupe_key` derivada do id do comentário + usuário (o enum `notification_kind` já tem `mention` e o índice único parcial já garante idempotência).
- `addWorkCommentFn` e `addTaskCommentFn` (`work-comments.functions.ts`, `tasks.functions.ts`) passam a retornar o id do comentário inserido e a chamar o helper de notificação em modo best-effort (falha ao notificar não derruba o comentário). O `href` aponta para `/projects/{projectId}` (com job/pauta na query quando aplicável) e `/tasks?taskId={id}` para tarefas.
- Sem migração: `work_comments.mentions` e `task_comments.mentions` já existem, `notifications` e o enum já suportam menção. RBAC/RLS inalterados — tudo passa pelo cliente autenticado com as policies atuais.
