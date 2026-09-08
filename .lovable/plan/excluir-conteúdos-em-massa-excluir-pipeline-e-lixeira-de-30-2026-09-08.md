# Excluir conteúdos em massa, excluir pipeline e Lixeira de 30 dias

## O que o usuário vai ver

Na tela **Conteúdo**:

1. **Excluir selecionados** — no modo de seleção, ao lado de "Mover para o estágio",
   aparece "Excluir selecionados" (contorno vermelho) com confirmação que diz quantas
   peças vão para a Lixeira. Visível apenas para Owner/Admin do workspace (e Super Admin).
2. **Excluir pipeline inteiro** — no menu de engrenagem do pipeline, item "Excluir
   pipeline". Confirmação exige digitar o nome do pipeline e mostra quantas peças serão
   removidas junto. O pipeline padrão (`is_default`) e o último pipeline restante não
   podem ser excluídos. Também restrito a Owner/Admin/Super Admin.
3. **Lixeira (30 dias)** — botão "Lixeira" na barra da tela de Conteúdo, com contador.
   Abre um painel listando peças e pipelines excluídos do cliente atual, com data da
   exclusão, quem excluiu, dias restantes e botão **Restaurar** (item por item e
   "Restaurar tudo"). Restaurar um pipeline devolve o pipeline e as peças que foram
   removidas junto com ele.
4. Peças com publicação já feita/publicada não são apagadas silenciosamente: a exclusão
   cancela agendamentos pendentes e o item aparece na Lixeira com aviso.

Depois de 30 dias, uma rotina diária apaga definitivamente o que estiver na Lixeira.

## Regras de negócio

- Somente **Owner/Admin do workspace e Super Admin** excluem em massa ou excluem pipeline
  (via `app_access_role`, mesmo padrão de `monthly-plan-delete.server.ts`).
- Exclusão é sempre **soft delete** (`deleted_at`), nunca remoção imediata.
- Pipeline excluído marca também as peças dele (`deleted_at` + marca de origem), para que
  a restauração devolva o conjunto exato.
- Peças já publicadas em rede social continuam com o histórico; só saem do board.
- Agendamentos pendentes (`post_placements`, `social_posts` em `scheduled`) são cancelados
  na exclusão para não publicar peça excluída.
- Limite de 200 itens por lote (mesmo limite do "mover em massa").

## Detalhes técnicos

### Banco (uma migração)

- `content_pipelines`: `deleted_at timestamptz`, `deleted_by uuid`.
- `posts`: `deleted_by uuid`, `deleted_reason text` (`'bulk' | 'pipeline'`), 
  `deleted_pipeline_id uuid` para restauração em conjunto.
- Índices parciais por `deleted_at IS NOT NULL` em `posts` e `content_pipelines`.
- Policies existentes de `posts`/`content_pipelines` continuam valendo; nenhuma nova tabela.
- Função `public.purge_deleted_content()` (security definer, `search_path=public`) que
  apaga em ordem segura os dependentes de `posts` (placements, aprovações, comentários,
  links, social_posts) e depois os posts e pipelines com `deleted_at < now() - interval '30 days'`.
- Cron diário `purge-deleted-content-30d` às `40 4 * * *` chamando essa função —
  é limpeza por tempo, uma execução por dia, atraso máximo de 24h e custo mínimo.

### Servidor (`src/lib/content.functions.ts`)

- `bulkDeletePostsFn` — valida autoridade, escopo brand/client/pipeline, cancela
  agendamentos, marca `deleted_at`, retorna resultado por item.
- `deletePipelineFn` — bloqueia `is_default` e último pipeline; marca pipeline + peças.
- `listContentTrashFn` — peças e pipelines excluídos nos últimos 30 dias do cliente.
- `restoreTrashItemsFn` — restaura peças e/ou pipelines (limpa `deleted_at` e marcas).
- `listPipelinesFn` e `loadBoardFn` passam a filtrar `deleted_at IS NULL` em pipelines.

### Interface

- `src/components/content/bulk-stage-bar.tsx` — botão de exclusão + diálogo de confirmação.
- Novo `src/components/content/content-trash-dialog.tsx` — painel da Lixeira.
- `src/components/content/content-toolbar.tsx` — botão "Lixeira" com contador e item
  "Excluir pipeline" no menu de configuração.
- Autoridade lida por `useAccessRole`; sem permissão, os controles não aparecem.

### Testes e MASTER-first

- `tests/content-trash.unit.test.ts`: autoridade, bloqueio do pipeline padrão/último,
  janela de 30 dias, restauração em conjunto e limite do lote.
- Regenerar o pacote (`build_delta.py`), alinhar `delta_version.txt` e
  `MASTER_RELEASE_VERSION` (1.3.10), cobrir as novas colunas/função em
  `verify-installation.sql` e rodar `bun run master:check` + typecheck + build.
