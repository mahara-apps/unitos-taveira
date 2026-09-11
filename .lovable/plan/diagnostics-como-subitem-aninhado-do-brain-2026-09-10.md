# Diagnostics como subitem aninhado do Brain

## Problema

Hoje "Diagnostics" é renderizado como uma linha solta logo abaixo de "Brain" no grupo Inteligência (apenas recuada via `pl-[42px]`). Visualmente parece um item separado da barra, não um filho do Brain. O esperado: Diagnostics vive **dentro** do item Brain, como submenu aninhado.

## Escopo

Apenas `src/components/app-sidebar.tsx`. Nenhuma rota, destino (`/brain/diagnostics`), permissão (`featureKey: "brain"`) ou badge é alterado.

## Mudança

1. **Remover o item solto** `{ title: "Diagnostics", url: "/brain/diagnostics", sub: true }` do array `groups` (grupo Inteligência) — Brain volta a ser um único item de navegação na lista.
2. **Renderizar Brain com subitem aninhado**: no `renderItem`, quando o item for Brain (ou, de forma genérica, quando `item.sub` deixar de existir e o Brain ganhar um filho declarado), usar os componentes `SidebarMenuSub` / `SidebarMenuSubItem` / `SidebarMenuSubButton` do shadcn para renderizar "Diagnostics" indentado com a linha-guia lateral padrão, dentro do `SidebarMenuItem` do Brain.
   - O filho só aparece quando a sidebar está expandida (`group-data-[collapsible=icon]:hidden`, como hoje).
   - Estado ativo: Diagnostics ativo quando `pathname === "/brain/diagnostics"`; Brain permanece ativo em `/brain` exato (hoje `isActive("/brain")` também casa `/brain/diagnostics` — ajustar para não marcar os dois como ativos com o mesmo destaque, ou manter o comportamento atual de prefixo, conforme ficar mais claro visualmente; padrão: Brain ativo em qualquer `/brain*`, Diagnostics com destaque próprio quando ativo).
3. **Filtros preservados**: a visibilidade do subitem segue a mesma regra do Brain (`featureKey: "brain"`, `canAccessSidebarUrl("/brain/diagnostics")`, `moduleAllowsUrl`) — como Diagnostics herda o módulo Brain, o subitem só é renderizado quando o Brain está visível.
4. **Limpeza**: remover o campo `sub` do tipo `NavItem` e o branch `if (item.sub)` do `renderItem`, já que Diagnostics era o único usuário — substituído pelo subitem declarativo.

## Validação

- `bunx tsgo --noEmit` sem erros.
- Testes relacionados à sidebar (se existirem no `tests/`) continuam passando; rodar `bunx vitest run` nos que tocam navegação.
- Verificação visual no preview: Brain com Diagnostics aninhado e recolhido corretamente no modo rail.
- MASTER-first: mudança 100% frontend, sem migration — regenerar delta, sincronizar `delta_version.txt` + `MASTER_RELEASE_VERSION`, `bun run master:check` e build ao final.
