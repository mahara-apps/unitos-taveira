# Header de Conexões: botão único com menu de ações Meta

## O que muda
No cabeçalho da seção Conexões (aba "Clientes e canais"), substituir os dois botões atuais ("Conectar Meta" + "Adicionar outro portfólio") por **um único botão primário "Meta"** com um menu dropdown contendo:

1. **Conectar canais** — abre o mesmo fluxo do atual "Conectar Meta" (`setConnectOpen(true)`). Rótulo do item muda para deixar claro o objetivo operacional.
2. **Adicionar outro portfólio** — dispara `connectMeta("facebook", true)`, forçando novo consentimento (visível apenas quando já existe portfólio conectado, como hoje).
3. **Revogar acesso** — abre um diálogo de confirmação e revoga todas as autorizações Meta ativas do workspace, chamando `revokeMetaAuthorizationFn` para cada `metaUserId` retornado por `portfolioStatus.authorizations`. Só aparece quando há autorização ativa e o usuário tem `canManage`.

Nada mais na tela muda: tabela, painel de portfólios, ações por linha e fluxo OAuth permanecem intactos.

## Detalhes técnicos
- Arquivo único: `src/components/connections/channels-center.tsx`, bloco do header (linhas ~445–464).
- Usar `DropdownMenu` + `DropdownMenuTrigger` do design system (já importado no projeto). Botão trigger com ícone `ChevronDown` e rótulo "Meta".
- Confirmação de "Revogar acesso" via `AlertDialog` (padrão já usado em outras revogações), com texto explicando que canais permanecem, mas novas descobertas exigirão nova autorização.
- Estado local: `revokingAll: boolean` para desabilitar o item enquanto executa; toast de sucesso/erro reaproveitando os helpers já usados no arquivo.
- Sem alterações em server functions, RLS, banco ou OAuth.

## Validação
- Typecheck + build.
- Fumaça manual: abrir menu, verificar visibilidade condicional dos itens (com/sem portfólio) e permissão (`canManage`).
