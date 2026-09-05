# Identidade das pessoas e marcação com @ em todo o sistema

## O problema (confirmado no banco)

- O workspace Unitos Master tem 206 membros, e 203 são contas criadas pelos testes automatizados (`qa+...@unitos-tests.dev`, `rbac.*@unitos-qa.test`). Elas aparecem na tela de Membros e em qualquer lista de pessoas.
- Motivo: toda conta nova é vinculada automaticamente ao workspace mais antigo da instalação. A limpeza dos testes só desfazia os vínculos dos workspaces de teste, nunca o do Master.
- Quando o nome não é informado, o nome exibido vira o pedaço antes do @ do e-mail (ex.: "rbac.portal.rbacmtndmc0m").
- O e-mail não existe junto do perfil: só é buscado uma conta por vez na tela de Membros e não chega às outras telas.
- A marcação com @ compara apenas o nome digitado. Com nomes repetidos, marca todas as pessoas de mesmo nome; quem está sem nome não pode ser marcado.

## O que muda

1. **Limpeza definitiva**: as contas de teste (só endereços `@unitos-tests.dev` e `@unitos-qa.test`) e seus vínculos são apagadas do Unitos Master e dos workspaces de teste remanescentes. Os workspaces "QA Brand" órfãos também saem.

2. **Não volta a sujar**: contas de teste passam a ser desvinculadas de todos os workspaces e apagadas ao fim da suíte; contas de teste nunca mais entram no workspace da instalação.

3. **Nome e e-mail certos em todo lugar**: o e-mail passa a ficar junto do perfil da pessoa, sempre em sincronia com a conta de acesso. Membros, responsáveis, comentários, avatares, notificações e a área do cliente mostram o mesmo nome e e-mail.

4. **Nome de verdade**: sem nome informado, exibimos uma versão apresentável derivada do e-mail (ex.: "joao.silva@…" → "João Silva"), e no primeiro acesso a pessoa é obrigada a confirmar o nome completo antes de seguir.

5. **Marcação com @ confiável**: a lista mostra nome + e-mail, filtra por nome ou e-mail, e a menção guarda exatamente a pessoa escolhida (nunca mais marca homônimos). Quem foi marcado recebe aviso, como já hoje.

6. **Vale também para a Taveira e futuras instalações**: a mudança entra no pacote de atualização de banco já existente e é aplicada nas instalações derivadas.

## Detalhes técnicos

- Migration: coluna `public.user_profiles.email` (texto, único case-insensitive, indexado para busca), preenchida por backfill a partir de `auth.users` e mantida por trigger em `auth.users` (insert/update de e-mail). `handle_new_user` passa a gravar o e-mail e a não usar o local-part cru como `full_name` (grava `NULL` quando não houver nome, e o app decide a exibição).
- Migration: `handle_new_user` deixa de vincular ao workspace mais antigo quando o e-mail casa com os domínios reservados de teste (`unitos-tests.dev`, `unitos-qa.test`).
- Limpeza de dados (via run_sql, não migration): `DELETE` de `brand_members`/`client_members`/`user_profiles` e `auth.users` para os domínios de teste, e remoção dos `brands` cujo slug começa com `qa-brand`.
- Novo `src/lib/identity.ts`: `displayName({ full_name, email })` (título a partir do local-part, remove sufixos/hashes), `identityLabel`, `initialsOf` — usado por `avatar-stack.tsx`, `team-shared.tsx`, `assignee-picker`, comentários e portal. Componentes locais de iniciais/nome passam a delegar.
- `listBrandTeam`, `listBrandTeamAdminFn` e `listBrandAssigneesFn` passam a selecionar `email` de `user_profiles` (fim das N chamadas `auth.admin.getUserById` no caminho de listagem) e a retornar `{ id, name, email, avatar_url, role }`.
- `mention-textarea.tsx`: `MentionPerson` ganha `email`; sugestão filtra por nome e e-mail e exibe os dois; o texto inserido passa a ser um token estável `@[Nome](id)` renderizado por `mention-text.tsx`, e `resolveMentions` extrai os ids do token (mantendo a regra de "apagar o @Nome remove a menção") com fallback de compatibilidade para os comentários antigos em texto puro. `comment-thread.tsx` e `tasks/shared.tsx` só repassam os novos campos.
- Primeiro acesso: `requires_password_change` já existe; a tela de troca obrigatória passa a exigir `full_name` não vazio (validação server-side em `profile.functions.ts`).
- Instalações derivadas: regenerar `supabase/baseline-snapshot/007_delta_migrations.sql`, subir `MASTER_RELEASE_VERSION` e conferir `applyDatabaseDelta()` — a limpeza de dados de teste não é replicada (é específica do Master).
- Testes: novo `tests/identity-display.unit.test.ts` (derivação de nome, homônimos), extensão de `tests/mentions.test.ts` (token com id, e-mail no filtro, sem marcação de homônimo) e ajuste de `tests/helpers/fixtures.ts` + `global-teardown.ts` para limpar vínculos em todos os workspaces.
