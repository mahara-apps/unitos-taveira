# supabase/baseline/ — área de staging (NÃO aplicada)

Estes arquivos **não estão** em `supabase/migrations/` de propósito.

Motivo: `supabase/migrations/` é gerenciado pelo pipeline de migrations do
projeto — qualquer arquivo colocado lá entra na fila de aplicação no banco de
**produção**. Como esta etapa exige explicitamente *nenhuma alteração em
produção*, os SQLs ficam aqui até aprovação.

## Arquivos

| Arquivo | Papel | Destino final |
|---|---|---|
| `20260101000000_baseline_pre_versioning.sql` | Cria `update_updated_at_column()` e `user_profiles` (objetos pré-versionamento). Timestamp **anterior** à 1ª migration histórica (`20260707030537`). | `supabase/migrations/` |
| `20260821090000_fix_user_profiles_role_and_signup.sql` | Forward-only: DEFAULT `role='user'`, CHECK, `handle_new_user()`, privilégios mínimos. | `supabase/migrations/` |
| `20260821090100_storage_buckets_baseline.sql` | Forward-only: cria os **5** buckets de Storage nunca versionados (inclui `chat-attachments`). | `supabase/migrations/` |
| `20260821090300_fix_user_profiles_privilege_escalation.sql` | Forward-only: corrige escalação de privilégio em `user_profiles` (`role` / `is_super_admin`). | `supabase/migrations/` |
| `20260821091000_fix_brand_invite_escalation.sql` | Forward-only: bloqueia escalação manager→owner via `brand_invites` (nova `can_invite_brand_role()`, policies de INSERT/UPDATE e revalidação em `accept_brand_invite()`). | `supabase/migrations/` |
| `20260821091100_fix_portal_tokens_scope.sql` | Forward-only: `portal_tokens` passa a usar `can_access_client_row()` em vez de `is_brand_member()`. | `supabase/migrations/` |
| `20260821091200_revoke_anon_table_privileges.sql` | Forward-only: revoga privilégios de tabela/sequência de `anon` em `public` (defesa em profundidade). Não toca `storage.objects` nem EXECUTE das RPCs do Portal. | `supabase/migrations/` |
| `20260821092000_fix_v1_manager_owner_escalation.sql` | Forward-only: fecha **V1** (MANAGER → OWNER). `link_existing_user_to_brand()` passa a validar o papel concedido por `can_invite_brand_role()` (antes do INSERT e do ON CONFLICT DO UPDATE), bloqueia autopromoção e corrige a ambiguidade histórica de `user_id` no upsert. **PROMOVIDO EM PRODUÇÃO — 2026-08-20 19:22 UTC** (migration `20260820192249_...`). Regressão permanente: `tests/v1-role-escalation.integration.test.ts`. | `supabase/migrations/` |
| `20260821095000_fix_v5_portal_client_brand_creation.sql` | Forward-only: fecha **V5** (PORTAL_CLIENT criava Brand e virava OWNER). Nova `can_create_brand(uuid)` (SECURITY DEFINER, EXECUTE só para `authenticated`/`service_role`) e substituição da policy `any auth creates brand` por `internal users create brand`. **VALIDADO NO CLUSTER DESCARTÁVEL — NÃO PROMOVIDO.** | `supabase/migrations/` |


## Como promover (somente após aprovação)

**Validação em Supabase descartável** (clone separado do repo, nunca no
diretório ligado à produção):

```bash
git clone <repo> unitos-rebuild-test && cd unitos-rebuild-test
cp supabase/baseline/*.sql supabase/migrations/
supabase link --project-ref <ref-DESCARTAVEL>
supabase db push
```

## Status de promoção (concluída)

- `20260821090000_...` e `20260821090300_...` → **APLICADOS EM PRODUÇÃO** via a
  ferramenta de migration (migration consolidada de promoção). Verificado:
  `user_profiles.role` DEFAULT `'user'`, CHECK ativo, `handle_new_user()` e a
  guarda `guard_super_admin_flag()` (UPDATE + INSERT) em produção.
- `20260821090100_storage_buckets_baseline.sql` → **não aplicável em produção**:
  os 5 buckets já existem e a criação de bucket é feita pela API de Storage, não
  por SQL. O arquivo permanece aqui apenas como referência de instalação limpa.
- `20260101000000_baseline_pre_versioning.sql` → permanece **fora** de
  `supabase/migrations/`. Já era idempotente e agora também é inofensivo em
  produção (a policy histórica permissiva só é recriada quando a tabela não
  possui nenhuma outra policy, cenário exclusivo de instalação limpa).

## Instalação limpa (nova instância Supabase)

```bash
cp supabase/baseline/20260101000000_*.sql supabase/migrations/
cp supabase/baseline/20260821*.sql supabase/migrations/
supabase link --project-ref <ref-NOVO>
supabase db push
```

Depois do push, criar os 5 buckets caso o SQL de buckets não tenha permissão
(`brand-assets`, `brand-documents`, `brand-media`, `avatars`,
`chat-attachments`, todos privados).


## Comandos proibidos no repositório ligado à produção

- `supabase db push` contra produção
- qualquer `psql`/SQL remoto de escrita no projeto de produção
- mover estes arquivos para `supabase/migrations/` neste repositório

Detalhes completos em `docs/DB_BASELINE_PLAN.md`.


## Lote de segurança 2026-08-20 (validado em cluster descartável, NÃO promovido)

`20260821091000`, `20260821091100` e `20260821091200` corrigem os 3 achados
prioritários da auditoria de RBAC. Reconstrução completa no cluster local:
**207 arquivos aplicados, 0 falhas**. Testes: 17 cenários de convite,
14 de `portal_tokens` e 8 de `anon` — todos com o resultado esperado
(`/tmp/dbclone/sec3_tests.sql` e `sec3_tests_fix.sql`).

Produção **não** foi alterada por este lote.

## V2 — brain_apply_partition_policies (validado em cluster descartável, NÃO promovido)

`20260821093000_fix_v2_brain_partition_policies_execute.sql` remove EXECUTE de
`PUBLIC`, `anon` e `authenticated` em `public.brain_apply_partition_policies(text)`
(SECURITY DEFINER que executa ENABLE/FORCE RLS, CREATE POLICY e GRANT), mantendo
`service_role`. Não altera a implementação da função, funções canônicas, RLS ou
grants de tabela.

Reconstrução do zero no cluster local: **211 arquivos, 0 falhas**. Validado:
`prosecdef = true`, `anon`/`authenticated` = sem EXECUTE (`permission denied`),
`service_role` = EXECUTE, `brain_ensure_event_partitions()` funcionando,
RLS ativo em 105/105 tabelas. Regressão: 77/77 (RBAC, settings, Portal, V1).

Correções de idempotência (somente nos arquivos de baseline, produção intocada):
`20260821091000` e `20260821091100` passaram a fazer `DROP POLICY IF EXISTS` das
policies que criam, pois a promoção equivalente já existe em produção.

Produção **não** foi alterada por este lote.

## V7 — social_posts_status_check / status 'blocked' (validado em cluster descartável, NÃO promovido)

`20260821097000_fix_v7_social_posts_status_blocked.sql` recria
`social_posts_status_check` (mesmo nome) preservando os 6 status existentes e
adicionando **apenas** `'blocked'`, valor que
`block_unusable_scheduled_social_posts()` / `mark_social_post_blocked()` já
tentam gravar — hoje o sweep aborta por violação de CHECK. Nada além da
constraint é alterado (sem RLS, policies, grants, triggers, colunas, funções ou
dados).

Reconstrução do zero no cluster local: **220 arquivos, 0 falhas**. Validado:
7 status aceitos, status arbitrários rejeitados, sweep gravando
`connection_inactive` e `client_account_link_missing`, posts válidos/futuros/
publicados intocados, 2ª execução idempotente, tenant B isolado, ACL da V6
preservada. Regressão: 160/160, typecheck e build OK.

Produção **não** foi alterada por este lote.
