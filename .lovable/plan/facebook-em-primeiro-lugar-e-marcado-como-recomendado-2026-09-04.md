# Facebook em primeiro lugar e marcado como recomendado

Mudança apenas visual na escolha de canal para conectar (modal "Conectar com a Meta").

## O que muda

- O cartão do Facebook passa a aparecer acima do Instagram na lista de canais disponíveis.
- O Facebook recebe um selo "Recomendado" (em destaque, no lugar do atual "Disponível") e uma linha curta de explicação: conectar pelo Facebook é o caminho que traz as Páginas e as contas de Instagram vinculadas, garantindo a atribuição correta dos ativos.
- O Instagram continua disponível, com o selo "Disponível" como hoje.
- Nada muda na autorização, nas permissões, no vínculo de ativos ou nos dados: só a ordem e os rótulos.

## Detalhes técnicos

- `src/components/connections/channel-meta.tsx`: `CONNECTABLE_CHANNELS` passa a ordenar por prioridade de recomendação (Facebook primeiro), e o tipo `ChannelDef` ganha um campo opcional `recommended` + `hint`. `CHANNEL_DEFS` mantém a ordem atual para as outras telas que a usam como catálogo.
- `src/components/connections/connect-channels-dialog.tsx`: o selo do cartão passa a ser "Recomendado" quando `def.recommended`, e a linha secundária mostra o `hint` quando existir.
- Sem mudanças de backend, RLS, RBAC ou schema.
