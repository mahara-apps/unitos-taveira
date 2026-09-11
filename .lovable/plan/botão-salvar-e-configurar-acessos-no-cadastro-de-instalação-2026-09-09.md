# Botão "Salvar e configurar acessos" no cadastro de instalação

## Hoje (verificado)

O diálogo "Nova instalação" em `src/routes/_authenticated/admin.instalacoes.index.tsx`
tem um único botão **Cadastrar**. Ao salvar, ele navega para
`/admin/instalacoes/$id?novo=true`, que abre na aba **Visão geral**. A aba
**Acessos** (onde ficam o token do Supabase, Vercel e GitHub da instalação) só
fica visível se o usuário clicar nela manualmente.

A página de detalhe (`admin.instalacoes.$id.tsx`) controla a aba com
`useState("visao")` e o `validateSearch` da rota só aceita `novo` — não há como
abrir direto numa aba específica pela URL.

## O que muda

1. **Segundo botão no diálogo de cadastro**: "Cadastrar e configurar acessos",
   ao lado do "Cadastrar" atual. Ele executa o mesmo `createInstallationFn` e,
   em caso de sucesso, navega para a página da instalação já na aba
   **Acessos** (com `novo=true` e `tab=acessos`).
2. **Aba via URL**: o `validateSearch` da rota de detalhe passa a aceitar
   `tab` (`visao` | `versoes` | `saude` | `acessos` | `execucoes`). O estado
   inicial da aba vem do `tab` da URL, mantendo o default `visao`. Trocar de
   aba atualiza a URL, para que recarregar/continuar abra na mesma aba.
3. **Sem mudança de lógica/dados**: nenhuma alteração em `createInstallationFn`,
   credenciais, RBAC/RLS ou fluxo de provisionamento. O cadastro continua
   idêntico; só muda para onde o usuário é levado.

## Detalhes técnicos

- `src/routes/_authenticated/admin.instalacoes.$id.tsx`:
  - `validateSearch` aceita `tab?: string` (validado entre os valores
    conhecidos; anything else vira `visao`).
  - `useState(() => search.tab ?? "visao")` e `onValueChange` que faz
    `navigate({ to, params, search: { ...prev, tab } })` preservando `novo`.
- `src/routes/_authenticated/admin.instalacoes.index.tsx`:
  - Novo botão no `DialogFooter` que aciona o mesmo `create.mutate()` e, no
    `onSuccess`, navega com `search: { novo: true, tab: "acessos" }`.
  - Estado de loading compartilhado com o botão existente
    (`create.isPending`).
- MASTER-first: sem migration. Regenerar delta, subir
  `MASTER_RELEASE_VERSION` e `delta_version.txt` para a próxima versão, rodar
  `bun run master:check`, publicar o MASTER e autorizar as instalações.

## Fora de escopo

Nada de novo em banco, credenciais, permissões ou fluxo de provisionamento. O
cadastro e o provisionamento seguem exatamente como hoje.
