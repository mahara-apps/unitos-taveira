# Página + Instagram no mesmo passo

## O que está acontecendo hoje

Quando você ativa uma Página do Facebook, o sistema **já conecta o Instagram
vinculado** a ela nos bastidores (isso está confirmado no código que grava as
contas). O problema é que a tela ignora esse segundo resultado:

- a aba Instagram continua mostrando a conta como não conectada, porque a tela
  só marca o canal que você tocou;
- a lista do rodapé ("o que foi ativado") recebe apenas a Página, então ao
  escolher o cliente **somente a Página é vinculada ao cliente** — o Instagram
  fica solto, exatamente como você descreveu;
- ao desativar a Página, o Instagram continua ativo.

Ou seja: não falta a conexão em par, falta a tela enxergar e concluir o par.

## O que vou fazer

1. **Vínculo em par visível**: ao ativar uma Página que tenha Instagram, a tela
   passa a marcar Página e Instagram como conectados na hora, e as duas contas
   entram juntas na lista do rodapé.
2. **Um único destino**: ao escolher o cliente e concluir, Página e Instagram
   são vinculados ao cliente na mesma ação. Nada de voltar depois para vincular
   o Instagram.
3. **Aviso claro no lugar do par**: na linha da Página aparece que o Instagram
   `@usuario` será ativado junto; se a Página não tiver Instagram, aparece o
   motivo em vez de silêncio.
4. **Desativar também em par**: remover a Página remove o Instagram que veio
   junto, com aviso do que será removido.
5. **Página sem Instagram e Instagram sem Página** continuam funcionando
   exatamente como hoje (inclusive contas do Instagram diretas do portfólio).
6. **Nada muda** em Threads, Contas de Anúncios, permissões, rotas ou regras de
   quem pode conectar.

## Detalhes técnicos

- `linkMetaAccount` (src/lib/meta/portfolio.functions.ts) já retorna
  `connectionIds` e `linkedChannels`, mas ninguém consome. Passa a retornar uma
  lista `linked: [{ channel, externalId, connectionId, label }]`, mantendo
  `connectionId`/`connectionIds` para compatibilidade.
- `meta-portfolio-dialog.tsx`: `mut.onSuccess` itera `linked` para atualizar
  `connected.facebook` e `connected.instagram` e para inserir todas as entradas
  em `linkedNow` (hoje só usa `result.connectionId`).
- `MetaAssignFooter` já percorre `linked`, então a atribuição ao cliente passa a
  cobrir o par sem mudança de lógica de negócio.
- `handleToggle` ao desconectar uma Página com Instagram pareado desfaz as duas
  conexões (`unlinkMetaAccount` por conexão), com confirmação.
- Sem migração, sem mudança de RLS/RBAC. Teste focado novo cobrindo o mapeamento
  do par (canal, ids e entradas do rodapé).
- MASTER-first: versão 1.3.22, delta regenerado, `delta_version.txt` e
  `MASTER_RELEASE_VERSION` iguais, `bun run master:check` verde; publicação e
  autorização nas instalações ficam para depois da sua aprovação.
