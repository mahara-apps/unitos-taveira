# Conexão Meta: sempre a tela oficial + todas as contas aprovadas

## Problema (confirmado no código)

1. **O popup do Meta só aparece na primeira vez.** Em `connected-channels-section.tsx`, o botão "Conectar canal" chama `getActiveMetaSession` antes do OAuth: se existir uma sessão Meta ainda válida, o popup é fechado e o app abre direto o seletor interno ("Selecione as contas da Meta"). O mesmo atalho existe no card de canal do cliente. É exatamente o "popup próprio do sistema" no lugar da tela do Meta.
2. **Mesmo indo ao Meta, a tela de escolha de contas não reaparece.** O fluxo padrão usa `auth_type=rerequest`, que o Meta trata como "já autorizado" e devolve o código sem mostrar login nem seleção de Páginas/contas.
3. **Contas aprovadas podem faltar na listagem.** O seletor lê o portfólio em modo cache-first (`staleTime: Infinity`, sem refetch), então contas recém-aprovadas no consentimento só aparecem se o usuário clicar em "Sincronizar". Além disso, quando a leitura de um portfólio empresarial falha parcialmente, o aviso fica discreto e a lista parece simplesmente incompleta. A varredura também não percorre portfólios filhos (portfólios ligados a outro portfólio).

## O que será feito

### 1. Consentimento sempre no Meta, com escolha de contas
- Remover o atalho de "reaproveitar sessão" do botão **Conectar canal** (painel de canais) e do botão de conectar no card de canal: o clique passa a abrir sempre a URL oficial de autorização do Meta no popup.
- Iniciar o OAuth com reautenticação forçada, de modo que o Meta exiba login + tela de seleção de Páginas/contas do Instagram a cada conexão.
- Manter o reaproveitamento de sessão **apenas** para reabrir o seletor de contas de um canal já conectado (ação "Gerenciar contas"/"Vincular contas"), que não é um novo consentimento.

### 2. Todas as contas aprovadas na listagem para vinculação
- Ao voltar do Meta, a primeira abertura do seletor faz varredura nova no Graph (não usa cache), garantindo que tudo que acabou de ser aprovado apareça.
- Ampliar a varredura para portfólios filhos (portfólios de empresa vinculados ao portfólio principal), além das Páginas diretas e dos portfólios de primeiro nível já cobertos.
- Tornar visível o resultado da varredura no topo do seletor: total de Páginas / contas Instagram / Threads / Ads encontradas e, quando houver falha parcial, um aviso claro com o botão "Sincronizar" ao lado — em vez de uma lista silenciosamente incompleta.
- Manter na aba Instagram tanto as contas vindas de Páginas quanto as atribuídas direto a um portfólio, com indicação de par Página+Instagram.

## Detalhes técnicos

- `src/components/connections/connected-channels-section.tsx`: `connectMeta` deixa de chamar `getActiveMetaSession`; chama `startMetaOAuth({ brandId, channel, forceReauth: true })` e aponta o popup para `authorizeUrl`.
- `src/components/connections/social-channel-card.tsx`: mesmo ajuste no caminho de conexão; a rota de reuso de sessão passa a ser usada só pela ação de abrir o seletor de contas de conexão existente.
- `src/lib/meta/meta.functions.ts` / `provider.server.ts`: sem mudança de contrato — `forceReauth` já mapeia para `auth_type=reauthenticate`. Em `scanPortfolio`, adicionar as arestas de portfólios filhos (`owned_businesses` / `client_businesses`) reutilizando o `loop` paginado e a deduplicação por `seenPages` / `seenIg`.
- `src/components/connections/meta-portfolio-dialog.tsx`: quando o `sessionId` ainda não teve varredura nesta sessão do navegador, executar a query com `refresh: true`; adicionar cabeçalho de resumo com contagens e destacar `warnings` do scan.
- Sem alterações de banco, RLS ou de lógica de vinculação (`linkMetaAccount` permanece igual).

## Fora de escopo

Publicação/agendamento, métricas e o fluxo de vínculo cliente↔conta (feito no perfil do cliente) permanecem como estão.
