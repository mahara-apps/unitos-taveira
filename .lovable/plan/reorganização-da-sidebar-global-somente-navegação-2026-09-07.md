# Reorganização da sidebar global (somente navegação)

## Escopo

Apenas `src/components/app-sidebar.tsx` (e, se necessário, ajustes mínimos em `src/components/brand-client-switcher.tsx`). Nenhuma rota, página, cabeçalho, tema ou componente global é alterado. Todos os itens e destinos atuais são preservados — só mudam grupo, ordem e rótulo.

## Nova estrutura (de cima para baixo)

1. **Marca UNITOS + botão Recolher** — já existe no `SidebarHeader` (logo + `SidebarTrigger`); mantido.
2. **Seletor de contexto (cliente)** — o `ContextSwitcher` atual passa a ser renderizado como cartão de contexto em destaque logo abaixo da marca, deixando claro que o cliente ativo escopa os itens. O item "Perfil" solto no primeiro grupo é removido do menu — o perfil do cliente continua acessível pelo contexto/seletor e pela página de Clientes (rota `/customers/$customerId` não é removida).
3. **Mensagens (inbox fixo no topo, sem grupo)** — sai de "Inteligência" e vira item único acima dos grupos, com badge de não lidas (`messages-unread`, já existente). Separador discreto abaixo.
4. **Grupo "Visão"** — Dashboard, Analytics (renomeado de "Visão Geral"; item "Perfil" sai daqui).
5. **Grupo "Trabalho"** (renomeado de "Operação", nova ordem) — Calendário, Projetos, **Pautas** (rótulo padronizado; destino `/monthly-plan` inalterado), Conteúdo, Tarefas (badge de pendências), Mídia paga.
6. **Grupo "Inteligência"** — Agentes IA, Brain (com **Diagnostics** como subitem aninhado sob Brain, recuado e sem ícone, destino `/brain/diagnostics` inalterado), Chat. Mensagens sai daqui.
7. **Grupo "Agência" fixo no rodapé, recessivo** (cor apagada, `mt-auto`) — Clientes, **Área do cliente** (mantido, com contador de pendências), Integrações, Notificações, Configurações. Para Super Admin, os itens de Administração (Recursos, Identidade, Ambiente) entram neste mesmo grupo em vez de um grupo separado.
8. **Conta do usuário no rodapé** — `UserProfileMenu` atual (avatar, nome, sair/preferências) mantido.

## Comportamento

- **Modo rail (só ícones)**: o `collapsible="icon"` do shadcn já fornece rail com tooltip no hover; o estado já é persistido (cookie da sidebar). Será verificado/ajustado para persistir por usuário.
- **Pontinho no modo colapsado**: itens com contador (Tarefas, Mensagens, Área do cliente) exibem um dot no canto do ícone quando a sidebar está recolhida (hoje o badge simplesmente some).
- **Badges com estilo único**: um só componente/estilo de contador para Tarefas e Mensagens (e o contador da Área do cliente, que é acionável, usa o mesmo estilo). Badge "beta" do Brain mantido como tag discreta.
- **Acessibilidade**: foco visível e navegação por teclado via componentes shadcn já existentes; tooltips no rail via `tooltip` do `SidebarMenuButton`.

## O que NÃO muda

- Nenhuma rota criada, removida ou renomeada; nenhum destino de item alterado.
- Filtros de permissão existentes (`canAccessSidebarUrl`, `allowedSidebarUrls`, feature flags, Super Admin) continuam aplicados item a item — nenhum item some para quem hoje o vê.
- Cabeçalho global intocado (o inbox no cabeçalho é opcional na referência e fica fora deste escopo).

## Detalhes técnicos

- Reescrever apenas o array `groups` e a ordem de renderização em `app-sidebar.tsx`: item Mensagens fixo renderizado fora do loop de grupos; grupo Agência renderizado com `mt-auto` dentro de `SidebarContent` (ou `SidebarFooter` acima do perfil) com estilo recessivo (`text-muted-foreground`).
- Subitem Diagnostics: renderizado com recuo (`pl-` + rótulo menor) e oculto no modo rail.
- Dot no rail: span absoluto no botão quando `state === "collapsed"` e contador > 0.
- Seguir MASTER-first ao final: regenerar delta, sincronizar `delta_version.txt` + `MASTER_RELEASE_VERSION` (1.2.10), `bun run master:check`, typecheck e build. Mudança é 100% frontend — sem migration nova.
