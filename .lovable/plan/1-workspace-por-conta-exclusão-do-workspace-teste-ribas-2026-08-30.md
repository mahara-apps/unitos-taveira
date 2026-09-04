# 1 workspace por conta + exclusão do workspace "Teste Ribas"

## Contexto (verificado no banco)

- Workspace real: **Pitada Digital** (8 clientes).
- Workspace de teste: **Teste Ribas** (`7ca02616-95cf-48d4-95de-afac39e90f1d`, criado em 29/08), com 1 cliente: **Cliente 1**.
- Hoje a criação de workspace é livre para usuários internos (`can_create_brand` + policy `internal users create brand`), e o seletor (brand-client-switcher) oferece "criar nova agência/workspace".
- Sobre "onde excluir workspace": já existe em **Configurações → Workspace** (`workspace-management.tsx`), visível só para Owner/Super Admin, com confirmação digitando o nome — por isso não aparece em /customers.

## Mudanças

### 1. Excluir o workspace "Teste Ribas" (dados — run_sql, irreversível)
- `DELETE FROM brands WHERE id = '7ca02616-...'` — em cascata remove: o cliente "Cliente 1" e todos os dados vinculados (briefings, pautas, posts, documentos, membros, convites etc.).
- Não inclui o "Cliente Teste" da Pitada Digital — se quiser removê-lo também, agora dá para fazer pela tela /customers com a nova dupla confirmação (ou me peça).

### 2. Regra: 1 workspace por conta (migration + backend + UI)
- **Migration**: atualizar `can_create_brand(uuid)` para retornar `false` quando o usuário **já é owner** de um workspace existente (mantido: super admin sem limite; bloqueado para portal clients). A policy `internal users create brand` já invoca essa função — nenhuma policy precisa mudar.
- **Backend** (`workspace.functions.ts → createBrand`): mensagem clara quando bloqueado ("Sua conta já possui um workspace. O Unitos permite 1 workspace por conta.").
- **UI** (`brand-client-switcher.tsx`): esconder a opção de criar novo workspace quando o usuário já é owner de um (a barreira real continua no banco).

### 3. Pendências do turno anterior (incluídas nesta entrega)
- Corrigir o teste `tests/client-delete-authority.integration.test.ts` (campo de fixture inexistente `otherBrandClientId`).
- Rodar validação completa: typecheck, testes (tema + exclusão de cliente + suíte) e build.

## Fora de escopo
- Não apagar os workspaces residuais de QA ("RBAC ..." criados por testes automatizados) — posso limpar depois, se quiser.
- Não alterar RBAC, papéis ou a tela de Configurações → Workspace.
