# Plano: Diagnostics sai da barra lateral e vive só dentro do Brain

## Objetivo
Remover o item "Diagnostics" do menu lateral (hoje aparece como subitem solto sob Brain) e dar acesso a ele apenas dentro da própria página Brain.

## O que muda

1. **Menu lateral (`src/components/app-sidebar.tsx`)**
   - Remover o `children` de Brain (`Diagnostics`, `/brain/diagnostics`), deixando Brain como item simples, igual aos demais.
   - Manter o restante: badge BETA, ícone, permissões (`featureKey: "brain"`), ativo por rota e o suporte genérico a `children` (não removemos o recurso, só o uso).
   - Diagnostics deixa de aparecer no menu — nem expandido, nem recolhido.

2. **Página Brain (`src/routes/_authenticated/brain.tsx`)**
   - Adicionar no topo da página um acesso a Diagnostics (abas ou botão com link para `/brain/diagnostics`), preservando permissões de quem pode ver o Brain.
   - A rota `/brain/diagnostics` continua existindo e funcional — só muda como se chega até ela.

## O que NÃO muda
- Rota `/brain/diagnostics`, permissões, RBAC, dados, backend, tema e demais itens do menu.

## Validação
- Typecheck + build.
- Conferência visual: menu lateral sem Diagnostics; abrindo Brain, o acesso a Diagnostics aparece; clicando, a página de Diagnostics abre.

## MASTER-first
- Se houver alteração só de código (sem SQL), executar `build_delta.py` e `bun run master:check` para manter o pacote sincronizado (SHA SQL não deve mudar).
