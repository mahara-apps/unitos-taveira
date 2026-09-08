# Por que o MASTER mostra 1.3.7 e a Taveira mostra 1.3.9

## O que foi verificado agora

Registro da Taveira no MASTER:

```text
versão registrada:            1.3.7
versão publicada (fixada):    1.3.7 · d4ad589
status: atualização disponível · saúde: saudável
```

Verificação direta nos repositórios de código (com credencial de leitura):

```text
pacote do MASTER (main):        1.3.9
pacote da Taveira (main):       1.3.9
tela da Taveira (ambiente):     1.3.9
```

Conclusão: **a Taveira já está rodando 1.3.9**. O código novo foi publicado e
entrou no ar; só o registro no painel do MASTER ficou parado em 1.3.7.

Duas causas confirmadas:

1. **O painel não consegue ler o repositório do MASTER.** O cartão "Disponível
   no MASTER" mostra "HTTP 403". A credencial de leitura funciona quando testada
   fora do site publicado, mas o site publicado do MASTER não a tem — ela foi
   cadastrada depois da última publicação. Sem essa leitura, o painel não sabe
   qual versão existe no pacote.
2. **A atualização de hoje foi barrada por engano.** Como o painel não conseguiu
   descobrir o ponto atual do código, a autorização usou o ponto antigo
   (`d4ad589`, que é 1.3.7). A verificação então concluiu "o MASTER ainda não foi
   publicado: pacote em 1.3.7 e sistema em 1.3.9" e cancelou a operação — mesmo
   com o código novo já publicado e no ar. Por isso a versão nunca foi registrada.

## O que será corrigido

1. **Sempre usar o ponto atual do código.** A autorização deixa de aceitar um
   ponto antigo como alvo: se a leitura do repositório falhar, a tela diz o que
   falta e não deixa autorizar com um ponto desatualizado.
2. **Não barrar operação já publicada.** Quando o envio do código daquela mesma
   operação já foi concluído, a retomada segue para build e registro de versão em
   vez de cancelar por "MASTER não publicado".
3. **Registrar a versão real do que está no ar.** O painel passa a conferir a
   versão do pacote que está publicado no repositório da própria instalação e
   usa esse número como versão publicada — assim painel e instalação nunca mais
   mostram números diferentes. Aparece também um botão "Sincronizar versão" para
   reconciliar sem precisar republicar.
4. **Corrigir o registro da Taveira agora** para 1.3.9 / commit publicado, com
   status "em dia".
5. **Explicar a falta da credencial em linguagem clara** no lugar de "HTTP 403",
   dizendo que o MASTER precisa ser publicado novamente para passar a enxergar o
   repositório.
6. Fechamento MASTER-first: regenerar o pacote, alinhar versão do pacote e do
   sistema em 1.3.10, rodar `bun run master:check`, tipos e build.

## Detalhes técnicos

- `src/lib/installation/automation.server.ts` (`runAutomatedUpdate`): mover a
  checagem `compareReleaseVersions(publishedRelease, MASTER_RELEASE_VERSION)`
  para depois de verificar `checkpoint.codeDone` — operação com código já
  publicado não pode ser bloqueada; gravar `appliedRelease` em `stageProgress`
  no momento do publish e reutilizá-lo na finalização.
- `manager.functions.ts` (`authorizeUpdateFn` / `getMasterVersionFn`): exigir
  `head.sha` fresco; nunca cair para `pinned_commit_sha` como alvo. Nova função
  `syncInstallationVersionFn` (guard `super_admin`) lê
  `supabase/baseline-snapshot/tools/delta_version.txt` no `main` do repositório
  da instalação e grava `pinned_release`/`pinned_commit_sha`/`current_version`.
- `src/routes/_authenticated/admin.instalacoes.$id.tsx`: botão "Sincronizar
  versão" e mensagem amigável quando `repoReleaseError` indica 403/404
  (credencial ausente no runtime publicado).
- Migração de dados (só o registro da Taveira no MASTER): `current_version` e
  `pinned_release` = `1.3.9`, `pinned_commit_sha` = commit atual do repositório
  da instalação, `status = 'up_to_date'`.
- Testes novos em `tests/`: retomada com código já publicado não bloqueia;
  autorização recusada sem ponto de código fresco; sincronização usa a versão do
  repositório da instalação.
- Nada muda em RBAC/RLS, no banco da Taveira ou em outros módulos.

## Ação necessária do usuário

Depois do merge, **publicar o MASTER** uma vez — é o que leva a credencial de
leitura do repositório para o site publicado e faz o cartão "Disponível no
MASTER" voltar a funcionar.
