# Corrigir a falha da instalação unitos-taveira (validação de tabelas)

## O que está acontecendo

A instalação da Taveira **não está quebrada**. O que falhou foi o próprio
relatório de saúde do MASTER: ele exige uma tabela temporária que, por desenho,
não deve existir no destino.

Estado real lido agora no banco do MASTER (registro `unitos-taveira`):

- `status: error`, `health: failing`
- Único erro: `FAIL: 1 verificação(ões) em FAIL: delta: todas as tabelas do
  pacote MASTER existem (observado: brain_events_new)`
- Conectividade, frontend, Supabase, secrets, storage, cron, código e
  configuração estão todos `ok`
- `super_admin` está em `attention` (aviso, não falha)
- Versão instalada: `1.2.2`

Causa confirmada: a verificação nº 80 monta a lista de tabelas obrigatórias a
partir dos `CREATE TABLE` do pacote de migrações. Uma das migrações cria
`brain_events_new` apenas como passo intermediário e, no mesmo bloco, executa
`ALTER TABLE public.brain_events_new RENAME TO brain_events`. Ou seja: ao final
da migração essa tabela **nunca** existe — nem no MASTER. A verificação a cobra
mesmo assim, e por isso reprova qualquer instalação, inclusive as saudáveis.

Como o cartão Banco/Schema/RLS/Seeds herda o resultado da validação, todos
aparecem "com falha" mesmo com o ambiente funcionando.

## O que será corrigido

1. Remover `brain_events_new` da lista da verificação nº 80, mantendo
   `brain_events` (a tabela final, que deve existir).
2. Ensinar o guardião automático a ignorar tabelas renomeadas dentro do próprio
   pacote, para que a lista nunca volte a incluir nomes intermediários.
3. Rodar novamente a validação da Taveira para o cartão voltar a "Pronto" caso
   nenhuma outra verificação reprove — se surgir outra falha real, ela será
   tratada com o erro concreto em mãos.
4. Revisar o aviso de `super_admin` em "atenção" e explicar na tela o que ele
   significa (não bloqueia liberação).

## Detalhes técnicos

- `supabase/install/verify-installation.sql`: remover `'brain_events_new'` dos
  dois `ARRAY[...]` da checagem 80 e incluir `'brain_events'`.
- `tests/installation-master-sync.unit.test.ts`: o extrator
  (`/CREATE TABLE ... public\.([a-z0-9_]+)/`) passa a descartar nomes que
  aparecem como origem de `ALTER TABLE public.<x> RENAME TO <y>` no mesmo
  pacote, e a exigir o nome final.
- MASTER-first: regenerar `007_delta_migrations.sql`/`delta_manifest.txt`,
  atualizar `delta_version.txt` e `MASTER_RELEASE_VERSION` para `1.2.4`, rodar
  `bun run master:check`, typecheck e build.
- Nenhuma migração de banco nova é necessária; nada será alterado no banco da
  Taveira além de reexecutar a validação de leitura.
