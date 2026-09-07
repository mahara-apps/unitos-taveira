# Por que o MASTER mostra duas versões diferentes para a Taveira

## O que está acontecendo (verificado agora no banco do MASTER)

Registro `unitos-taveira`:

```text
versão registrada (current_version): 1.3.4
versão realmente publicada (pinned_release): 1.2.9
código publicado (commit):            4b11ace
status: up_to_date · saúde: healthy
```

São duas informações diferentes na mesma tela:

- O selo do topo ("v1.3.4 → v1.3.4 · Em dia") compara o **número registrado**
  na instalação com a versão do sistema. Esse número foi gravado em
  atualizações antigas que não enviaram código novo, então está inflado.
- O cartão "Publicado nesta instalação" mostra a **versão real do código**
  (1.2.9 · 4b11ace), que é a verdade.

Ou seja: a instalação está de fato em 1.2.9 e o selo mente dizendo "Em dia".

Segundo ponto confirmado: o cartão "Disponível no MASTER" mostra
"Token do GitHub não configurado" porque a credencial de leitura do
repositório do MASTER não está configurada neste ambiente. Sem ela o sistema
não consegue saber qual versão existe no pacote publicado, e hoje isso não
impede clicar em "Autorizar atualização" — o aviso de "MASTER não publicado"
só aparece quando essa leitura funciona.

## O que será corrigido

1. O selo do topo passa a usar a versão real do código publicado
   (a mesma do cartão "Publicado nesta instalação") em vez do número
   registrado. Quando as duas divergirem, a tela mostra a divergência em vez
   de dizer "Em dia".
2. O registro da Taveira é corrigido para 1.2.9, alinhando o número guardado
   com o código que está realmente rodando lá; o status volta para
   "atualização disponível".
3. Quando a leitura do repositório do MASTER não estiver disponível, a tela
   explica em linguagem clara o que falta configurar e o botão "Autorizar
   atualização" fica bloqueado — para não repetir o problema de "atualizei e
   nada subiu".
4. A lista de instalações passa a exibir a mesma versão real, para não haver
   dois números diferentes entre lista e detalhe.
5. Fechamento MASTER-first: regenerar o pacote, alinhar `delta_version.txt` e
   a versão do sistema em 1.3.5, rodar `bun run master:check`, tipos e build.

Depois disso a ordem para a Taveira receber tudo continua: publicar o MASTER →
autorizar a atualização na instalação.

## Detalhes técnicos

- `src/routes/_authenticated/admin.instalacoes.$id.tsx`: `VersionPair` do card
  "Versão publicada" passa a receber `inst.pinnedRelease ?? inst.currentVersion`
  como versão instalada; botão desabilitado também quando
  `masterVersion.data?.repoRelease` é nulo (inclui token ausente), com o texto
  do erro (`repoReleaseError` / `error`) exibido.
- `src/routes/_authenticated/admin.instalacoes.index.tsx`: mesma fonte de
  versão instalada na listagem.
- `src/lib/installation/manager.functions.ts`: `mapRow` mantém `pinnedRelease`;
  ajustar apenas onde a UI decide "em dia" para usar a versão fixada.
- Migração de dados (somente MASTER, registro da Taveira):
  `update public.installations set current_version = pinned_release,
   status = 'update_available' where slug = 'unitos-taveira'`.
- Credencial: `UNITOS_GITHUB_TOKEN` não está configurada neste ambiente —
  precisa ser adicionada para o cartão "Disponível no MASTER" funcionar.
- Teste novo em `tests/`: selo usa versão fixada, e botão bloqueado quando a
  versão do pacote do MASTER é desconhecida.
- Nada muda em RBAC/RLS, no banco da Taveira ou em outros módulos.
