# Exclusão de cliente: dupla confirmação com digitação + restrição a administradores

## Objetivo

1. Ao excluir um cliente, exigir **dupla confirmação com escrita** (digitar o nome do cliente) e aviso explícito de que **todos os dados, arquivos e informações serão perdidos permanentemente e não poderão ser recuperados**.
2. Garantir que **somente nível administrador** (super admin / admin do workspace; owner resolve como admin) possa excluir cliente — hoje **manager também consegue**, tanto na RLS quanto na server function.

## Estado atual (verificado)

- `src/routes/_authenticated/customers.index.tsx`: `AlertDialog` de confirmação simples ("Excluir cliente?"), item "Excluir" visível no menu de qualquer papel.
- `src/lib/workspace.functions.ts` → `deleteClient`: usa `assertBrandAdmin(...)` que por padrão **aceita manager**.
- RLS `clients delete in scope` (migration `20260824215348`): permite `super_admin`, `admin` **e `manager`**.
- Exclusão é cascata real no banco (briefings, personas, pautas, posts, documentos etc. têm `ON DELETE CASCADE`) — o aviso de perda total é factual.

## Mudanças

### 1. Banco — RLS (nova migration, sem tocar históricas)

- Nova migration: `DROP POLICY "clients delete in scope"` e recriar permitindo apenas `super_admin` e `admin` (remover `'manager'` do array), mantendo `can_access_client_row`.

### 2. Backend — `src/lib/workspace.functions.ts`

- `deleteClient`: trocar para `assertBrandAdmin(context.supabase, context.userId, data.brandId, { allowManager: false })`. Manager passa a receber "Forbidden: papel insuficiente".
- Sem alteração em RBAC geral, auth ou demais guards — apenas este endpoint.

### 3. Frontend — `customers.index.tsx`

- **Gate de UI**: item "Excluir" do dropdown só renderiza quando `accessRole === "admin"` (o bloqueio real continua no backend/RLS).
- **Dupla confirmação com escrita**: substituir o `AlertDialog` atual por diálogo que exige digitar o **nome exato do cliente** em um input; botão "Excluir permanentemente" só habilita quando o texto digitado é idêntico ao nome.
- **Aviso de perda irreversível** (texto em destaque destrutivo):
  > "Todos os dados deste cliente serão excluídos permanentemente: briefing, documentos e arquivos, pautas e planejamentos, posts, projetos, tarefas, conexões e histórico. **Esta ação é irreversível e os dados não poderão ser recuperados.**"
- Estado do input é limpo ao fechar/reabrir o diálogo; botão mostra spinner durante a mutação.

### 4. Testes

- Estender `tests/rbac-scope.integration.test.ts` (ou `scope-closure.integration.test.ts`): manager com cliente atribuído **não** consegue deletar (RLS retorna 0 linhas / server function lança Forbidden); admin consegue.
- Teste unitário do diálogo: botão desabilitado até digitação exata do nome; texto de irreversibilidade presente.

### 5. Validação

- `bunx tsgo --noEmit`, testes direcionados + suíte completa, build.
- Verificação manual no preview: como manager, item "Excluir" não aparece; como admin, fluxo de digitação funciona.

## Fora de escopo

- Não alterar soft-delete, nem criar lixeira/backup.
- Não mexer em RBAC/RLS de outras tabelas, auth, migrations históricas ou separação Instalação × Workspace.
