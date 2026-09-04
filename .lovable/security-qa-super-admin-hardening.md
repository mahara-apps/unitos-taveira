# Hardening — contas QA com SUPER ADMIN (P1 de ambiente)

Origem: `.lovable/security-final-audit.md` (risco P1 de ambiente).
Escopo: identidade e privilégio de QA. RBAC, RLS, Storage, Portal, entitlements e planos **não** foram alterados.

## 1. Inventário (antes)

Consulta: `user_profiles.is_super_admin = true OR role = 'super_admin'` + `auth.users`.

| Conta | is_super_admin | role | memberships | client_members | Classificação |
| --- | --- | --- | --- | --- | --- |
| `n3@unitos.com` | true | `super_admin` | 0 | 0 | SUPER ADMIN legítimo (preservado) |
| 13 × `qa+<tag>-s5super@unitos-tests.dev` | true | `user` | 0 | 0 | QA (suíte de integração) |

Confirmação de que eram QA:
- domínio exclusivo de teste `@unitos-tests.dev` e prefixo `qa+`;
- rótulo `s5super` idêntico ao usado em `tests/scope-closure.integration.test.ts`;
- `created_at`/`last_sign_in_at` coincidentes (segundos) com execuções da suíte em 24–25/08;
- zero memberships, zero vínculos de cliente, zero dados operacionais associados.

Total encontrado: **13 contas QA privilegiadas** (a auditoria estimava 12; o inventário real prevaleceu).

## 2. Privilégio removido

`UPDATE public.user_profiles SET is_super_admin = false` restrito às contas cujo e-mail em `auth.users`
termina em `@unitos-tests.dev`. Nenhuma conta foi promovida a ADMIN, nenhuma membership criada/alterada,
nenhum usuário real tocado, nenhum dado operacional apagado, nenhum usuário excluído nesta etapa.

O mecanismo de SUPER ADMIN (`is_super_admin` + `public.is_super_admin()` + `resolveIsSuperAdmin`)
permanece intacto; não foi criada equivalência com `role = 'admin'`.

## 3. Origem da criação

Cinco arquivos de teste criavam usuário real via service role e ligavam a flag manualmente:

- `tests/scope-closure.integration.test.ts` (`s5super`) — **sem** exclusão no `afterAll` → fonte dos 13 resíduos;
- `tests/rbac-scope.integration.test.ts` (`su`) — sem exclusão do usuário;
- `tests/privilege-escalation.integration.test.ts` (`super`);
- `tests/scope-null-10d2.integration.test.ts` (`d2super`);
- `tests/workspace-context.integration.test.ts` (`wsctx-super`).

Helper compartilhado `tests/helpers/fixtures.ts` gerava senha **derivável do e-mail**
(`Qa!${TAG}${label}Aa1`) e usava `SUPABASE_SERVICE_ROLE_KEY` sem qualquer verificação de ambiente —
executando, portanto, contra o Supabase de produção.

## 4. Correções aplicadas

- **`tests/helpers/test-env.ts` (novo)** — barreira fail-closed. Criação privilegiada exige
  `UNITOS_TEST_ENV=test`; `UNITOS_PRODUCTION_PROJECT_REF` bloqueia por ref do projeto mesmo quando
  declarado como teste. Ambiente desconhecido → bloqueio. Sem fallback.
- **`tests/helpers/fixtures.ts`** — `createSuperAdminUser()` como único caminho autorizado
  (chama `assertPrivilegedTestEnv()`); senhas via `crypto.randomBytes` (+ segredo opcional
  `UNITOS_TEST_USER_PASSWORD_SECRET`, nunca hardcoded nem logado); e-mails com sufixo aleatório;
  registro de todas as identidades criadas e `cleanupTestIdentities()`.
- **`tests/helpers/global-teardown.ts` (novo)** + `vitest.config.ts` `setupFiles` — `afterAll` global
  remove a flag e apaga as identidades criadas, inclusive quando os testes falham.
- **5 arquivos de teste** — passam a usar `createSuperAdminUser`, com `PRIV = privilegedTestEnvAllowed()`
  e casos privilegiados em `it.skipIf(!PRIV)`. Nenhuma assertiva foi enfraquecida.

## 5. Testes adicionados — `tests/qa-super-admin-hardening.test.ts` (8 casos)

Barreira de ambiente (desconhecido/valores não canônicos/projeto de produção/ambiente de teste válido),
senha não previsível e não repetida, ausência de padrão derivado de e-mail nos helpers, inventário do
banco sem QA privilegiado, e SUPER ADMIN legítimo preservado.
Cenários "ADMIN não vira SUPER ADMIN", "USER/MANAGER não elevam privilégio" e "SUPER ADMIN legítimo
funciona" continuam cobertos por `rbac`, `rbac-scope`, `privilege-escalation` e `v1-role-escalation`.

## 6. Regressão

- Suíte completa: **404 passed, 12 skipped** (os skipped são exatamente os casos privilegiados, corretamente
  bloqueados por rodar contra produção), 25 arquivos.
- Typecheck (`tsgo --noEmit`): OK. Lint nos arquivos alterados: sem novas violações
  (restam 5 avisos `Brain-First` pré-existentes em `scope-closure`). Build: OK.

## 7. Auditoria final

`contas QA com is_super_admin ativo = 0`; `SUPER ADMIN total = 1` (`n3@unitos.com`, legítimo).
Nenhuma senha ou secret consta neste relatório.

## Riscos residuais

- 13 contas QA continuam existindo em `auth.users` (sem privilégio, sem workspace, sem dados). Podem ser
  excluídas em uma limpeza separada de identidades.
- Enquanto `UNITOS_TEST_ENV` não for definido em um ambiente de teste dedicado, os 12 casos privilegiados
  permanecem skipped — cobertura de SUPER ADMIN só roda em ambiente isolado.
- `UNITOS_PRODUCTION_PROJECT_REF` deve ser configurada nos runners para ativar o bloqueio duro por ref.
