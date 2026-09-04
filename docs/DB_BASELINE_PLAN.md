# Unitos — Plano de Baseline do Banco (artefatos preparados / aguardando aprovação)

Status: **ARTEFATOS PREPARADOS EM STAGING**. Nada foi executado no banco de produção
(nenhum DDL/DML remoto). Nenhuma migration existente foi editada, renomeada ou removida.
Nenhum arquivo foi adicionado a `supabase/migrations/`.

Os SQLs propostos estão em **`supabase/baseline/`** (área de staging, não aplicada) —
ver `supabase/baseline/README.md` e a seção 10 deste documento.

Evidências coletadas em: repositório atual (199 migrations) + leitura read-only do
banco de produção (`information_schema`, `pg_class`, `pg_policy`, `pg_proc`).


---

## 1. BASELINE PROPOSTO

Estratégia: **forward-only + baseline idempotente executado ANTES das 199 migrations**,
sem tocar no histórico.

Como funciona:

- Novo arquivo versionado em `supabase/migrations/` com timestamp **anterior** a
  `20260707030537` (ex.: `20260101000000_baseline_pre_versioning.sql`).
  Isso não é "reescrever histórico": nenhuma migration existente muda de conteúdo
  ou nome; apenas entra um arquivo novo no início da ordem lexicográfica.
- 100% idempotente (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
  `DROP POLICY IF EXISTS` + `CREATE POLICY`, `DO $$ ... IF NOT EXISTS`), de forma que
  aplicar no banco de produção seja **no-op verificável**.
- Em produção, em vez de rodar, marca-se como aplicada:
  `supabase migration repair --status applied 20260101000000`.
  Assim produção não sofre nenhuma alteração.
- Em instância nova: `supabase db push` aplica baseline → depois as 199 na ordem.

Conteúdo mínimo do baseline: `public.update_updated_at_column()`,
`public.user_profiles` (+PK, FK, RLS, policy inicial, trigger, grants mínimos).

---

## 2. USER_PROFILES

Definição que deve existir em instalação nova (estado *original*, pré-versionamento —
as 199 migrations depois adicionam colunas, CHECK, policies e trigger de guarda):

```sql
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  role        text NOT NULL DEFAULT 'editor',
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_user_profiles_modtime ON public.user_profiles;
CREATE TRIGGER update_user_profiles_modtime
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Policy histórica (removida depois por 20260710020307). Necessária apenas para
-- que aquele DROP POLICY IF EXISTS seja coerente; não amplia acesso no estado final.
DROP POLICY IF EXISTS "Autenticados veem perfis" ON public.user_profiles;
CREATE POLICY "Autenticados veem perfis"
  ON public.user_profiles FOR SELECT TO authenticated USING (true);

-- GRANTS MÍNIMOS (não replicar o ACL antigo)
REVOKE ALL ON public.user_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;
```

Sobre `role text DEFAULT 'editor'`: o baseline reproduz o estado histórico
(é o que produção tem hoje). A correção do DEFAULT é item separado do plano
(seção 7), aplicada por migration forward-only para produção **e** instalação nova.

### Privilégios: análise (não copiar o ACL antigo)

ACL real hoje em produção:
`anon=arwdDxtm`, `authenticated=arwdDxtm`, `service_role=arwdDxtm`, `postgres=arwdDxtm`
— ou seja, `anon` tem SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER.

O que o sistema realmente precisa:

| Role | Necessário | Justificativa |
|---|---|---|
| `anon` | **nada** | Nenhuma policy de `user_profiles` concede acesso a `anon`; as 4 policies atuais são `TO authenticated` (ou default). Portal usa RPCs `SECURITY DEFINER`. |
| `authenticated` | `SELECT, INSERT, UPDATE` | Perfil próprio, perfis de colegas de marca, atualização de nome/avatar/prefs. Nada no código faz `DELETE` em `user_profiles`. |
| `service_role` | `ALL` | Server functions/admin client e triggers administrativos. |
| `postgres` | `ALL` | Owner. |

`DELETE`/`TRUNCATE` para `authenticated` e todo o acesso de `anon` são excedentes
herdados da criação manual → devem ser revogados (item da seção 7).

---

## 3. FUNÇÕES PRÉ-EXISTENTES (criadas fora do versionamento)

Varredura automática das 199 migrations: 119 funções aparecem; **apenas uma** nunca é
criada pelas migrations iniciais e ainda assim é usada desde a primeira:

### `public.update_updated_at_column()`

Definição real em produção:

```sql
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
```

Dependências: **30+ triggers** em `brands`, `clients`, `projects`, `tasks`, `posts`,
`user_profiles`, `content_pipelines`, `message_templates`, `media_plans` etc.
(`FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()`), a partir de
`20260707030537`, que inclusive comenta: *"já existe update_updated_at_column"*.

Migrations que a manipulam sem nunca criá-la no início:
- `20260707030621` → `ALTER FUNCTION ... SET search_path` + `REVOKE`/`GRANT`
- `20260715030950`, `20260715161725` → `REVOKE EXECUTE ... FROM anon, authenticated`
- `20260726164551` (linhas 122-124) → cria via `IF NOT EXISTS (SELECT 1 FROM pg_proc ...)`,
  **tarde demais**: 19 dias de migrations antes dela já dependem da função.

Observação: as 108 funções restantes usam `CREATE OR REPLACE` mas cada uma tem sua
primeira ocorrência versionada — não são dependências históricas.

---

## 4. OUTRAS DEPENDÊNCIAS HISTÓRICAS

| Objeto | Situação | Impacto em instalação nova |
|---|---|---|
| `public.user_profiles` | **única** tabela com `ALTER TABLE` sem `CREATE TABLE` (93 tabelas criadas nas migrations; 1 órfã). Primeiro `ALTER` em `20260712202121`. Também referenciada por `20260707032536` (trigger `handle_new_user`) e `20260710020307` (`DROP POLICY "Autenticados veem perfis"`). | **Falha dura** |
| `public.update_updated_at_column()` | ver seção 3 | **Falha dura** |
| Policy `"Autenticados veem perfis"` | só existe `DROP POLICY IF EXISTS` (`20260710020307`); nunca criada | Sem erro (`IF EXISTS`), mas o estado final é o mesmo — apenas documenta a origem manual |
| Buckets de Storage (`brand-assets`, `brand-documents`, `brand-media`, `avatars`) | zero referências a `storage.buckets` nas migrations; só policies em `storage.objects` | **Uploads quebram** — criar os 4 buckets manualmente |
| Trigger `on_auth_user_created` em `auth.users` | criado em `20260707032536` (versionado, ok) | ok |
| Extensões | `pg_net`, `pg_cron`, `vector`, `supabase_vault` **estão** versionadas | ok |
| 10 `cron.schedule` | versionados, mas com URL/segredo do ambiente antigo | reapontar domínio + `CRON_SECRET` |
| Materialized view (`brain_stats`) | criada em migration versionada | ok |
| Secrets (`SUPABASE_*`, `CRON_SECRET`, Meta, IA) | fora do banco | reconfigurar |
| `auth.users` / dados | não versionado por design | criar usuários novamente |
| `20260720144007` linha 230 | `JOIN public.user_profiles p ON p.user_id = ...` (coluna inexistente); corrigido em `20260720144133` com `p.id` | Sem falha no push (corpo de função não é validado), mas a função fica quebrada entre as duas migrations |

Nenhum `DROP TABLE` de tabela inexistente sem `IF EXISTS` e nenhuma função de trigger
não definida foram encontrados além dos itens acima.

---

## 5. MODELO DE ROLES

### Referências encontradas

**Banco (produção, hoje):**
- `user_profiles.role`: `DEFAULT 'editor'` (herdado) + CHECK `('admin','manager','user','super_admin')`
  → **DEFAULT viola o CHECK**.
- Distribuição real: `user` = 99, `admin` = 2, `super_admin` = 1. **Zero `editor`/`designer`/`member`**.
- `public.handle_new_user()` em produção **já** normaliza para `'user'`
  (`IF v_role NOT IN ('admin','manager','user','super_admin') THEN v_role := 'user'`).
  O fallback `'member'` citado no diagnóstico **não existe mais** no banco; é resquício
  de versões antigas das migrations (`20260707032536`, `20260717125330`), substituídas
  por `20260819150650`.
- Enum `public.app_role` (acesso à marca): `owner | manager | editor | designer | client | user`
  — `editor`/`designer` são valores mortos (nenhuma linha os usa; `normalize_app_role`
  converte para `user`). Valores de enum não podem ser removidos sem recriar o tipo.
- `app_access_role()` retorna `super_admin | owner | manager | user | client`.

**Código:**
- `src/lib/permissions.ts`, `settings.team.tsx`, `member-edit-modal.tsx`,
  `team-admin.functions.ts`: apenas `owner` (ADMIN), `manager`, `user`; `client` só no Portal.
- `src/integrations/supabase/types.ts` (gerado): ainda lista `editor`/`designer` porque o
  enum existe no banco.
- Fallbacks de **exibição** com `"member"`: `src/lib/profile.functions.ts:36` e
  `src/lib/content.functions.ts:72` (`?? "member"`) — string de UI, nunca gravada.
- Nenhuma escrita de `'editor'`, `'designer'` ou `'member'` em `user_profiles.role`.

### Modelo que o código realmente espera

Dois eixos distintos, e o código já opera nesse modelo:

1. **Papel interno de acesso** (`brand_members.role` / `app_access_role`):
   `SUPER ADMIN` (global, `user_profiles.is_super_admin`) → `ADMIN` (= `owner`) →
   `MANAGER` → `USER`. `CLIENT` isolado no Portal.
2. **`user_profiles.role`**: hoje só espelha `admin | manager | user | super_admin`.

### Recomendação (não aplicada)

- Alinhar `DEFAULT` de `user_profiles.role` para `'user'` (elimina `editor`).
- Manter `handle_new_user()` como está (já correto).
- Trocar os dois fallbacks de UI `?? "member"` por `?? "user"` (cosmético, sem risco).
- **Não** mexer no enum `app_role`: recriar o tipo exigiria reescrever dezenas de
  colunas/policies — risco alto para ganho apenas estético. Manter `normalize_app_role`
  como guarda.
- Resultado: três conceitos (`editor`, `member`, `user`) colapsam em **`user`**.

---

## 6. RISCO ATUAL

1. **Instalação do zero é impossível** — `db push` em banco vazio falha em
   `20260707030537` (trigger sobre função inexistente) e em
   `20260712202121` (`ALTER TABLE user_profiles`). Não há disaster recovery só com o repo.
2. **`user_profiles.role DEFAULT 'editor'` viola o CHECK** — qualquer `INSERT` sem `role`
   explícito falha com `user_profiles_role_check`. Hoje mascarado porque
   `handle_new_user()` sempre informa `role`. Um `INSERT` direto (script, admin, RPC
   nova) quebra.
3. **`anon` com privilégios totais em `user_profiles`** — mitigado apenas pela RLS.
   Qualquer policy futura permissiva a `anon`, ou um `ENABLE`/`DISABLE` equivocado,
   expõe/permite escrita de perfis. `DELETE`/`TRUNCATE` a `authenticated` também sobra.
4. **Buckets de Storage não versionados** — replicação incompleta do ambiente.
5. **Cron jobs apontando para URL/segredo do ambiente antigo** em novas instâncias.
6. **Enum `app_role` com valores mortos** (`editor`, `designer`) — ruído em tipos gerados.
7. Migrations não idempotentes → só aplicáveis a banco vazio, do zero.

---

## 7. PLANO DE MIGRAÇÃO (forward-only, aguardando aprovação)

Ordem proposta. Nada é executado sem autorização explícita.

**M0 — `20260101000000_baseline_pre_versioning.sql`** (arquivo novo, prefixo antigo)
- `CREATE OR REPLACE FUNCTION public.update_updated_at_column()` (idêntica à de produção)
- `CREATE TABLE IF NOT EXISTS public.user_profiles` conforme seção 2 (+PK/FK/RLS/trigger)
- policy histórica + grants mínimos (`REVOKE ALL FROM anon`)
- 100% idempotente → no-op em produção
- Produção: `supabase migration repair --status applied 20260101000000` (não roda SQL)
- Nota técnica: é a única exceção ao "forward-only", justificada porque a ordenação por
  timestamp é o mecanismo do próprio Supabase CLI e o arquivo é inerte em produção.
  Nenhuma migration existente muda.

**M1 — `<hoje>_fix_user_profiles_role_default.sql`** (forward-only, roda em produção)
- `ALTER TABLE public.user_profiles ALTER COLUMN role SET DEFAULT 'user'`
- `UPDATE ... SET role='user' WHERE role NOT IN ('admin','manager','user','super_admin')`
  (hoje afeta 0 linhas — rede de segurança)
- Reafirma o CHECK com `IF NOT EXISTS`

**M2 — `<hoje>_harden_user_profiles_grants.sql`** (forward-only)
- `REVOKE ALL ON public.user_profiles FROM anon`
- `REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_profiles FROM authenticated`
- `GRANT SELECT, INSERT, UPDATE ON public.user_profiles TO authenticated`
- `GRANT ALL ON public.user_profiles TO service_role`
- Aplicar **depois** de validar em Supabase descartável (seção 8)

**M3 — `<hoje>_storage_buckets_baseline.sql`** (forward-only, idempotente)
- `INSERT INTO storage.buckets (id, name, public) VALUES (...) ON CONFLICT DO NOTHING`
  para `brand-assets`, `brand-documents`, `brand-media`, `avatars`
- No-op em produção; torna a instalação nova completa

**M4 — apenas código (sem SQL)**
- `profile.functions.ts` e `content.functions.ts`: `?? "member"` → `?? "user"`

**Fora de escopo (não recomendado agora):** recriação do enum `app_role`;
consolidação/squash das 199 migrations; qualquer `DROP`.

---

## 8. TESTE EM SUPABASE LIMPO

1. Criar projeto Supabase descartável (`unitos-rebuild-test`), região igual à de produção.
2. `supabase link --project-ref <ref-descartavel>` em um **clone separado** do repo
   (nunca no diretório ligado à produção).
3. Adicionar M0..M3 apenas nesse clone (branch `chore/db-baseline`).
4. `supabase db push` — deve aplicar 199 + novas **sem erro**. Registrar o log completo.
5. Validação estrutural (comparar com produção, read-only):
   - contagem de tabelas em `public` (esperado 93 + `user_profiles` = 94, conferindo
     partições de `brain_events`)
   - `information_schema.columns` de `user_profiles`: 16 colunas, `role` default `'user'`
   - `pg_constraint`: PK, FK para `auth.users`, `user_profiles_role_check`
   - `pg_policy`: 4 policies; `pg_class.relrowsecurity = true`
   - `relacl` sem `anon`
   - `pg_proc`: 119 funções esperadas; `update_updated_at_column` presente
   - triggers `update_user_profiles_modtime` e `trg_guard_super_admin_flag`
   - 4 buckets em `storage.buckets`
6. Teste funcional: criar usuário via Auth → confirmar que `handle_new_user` cria perfil
   com `role='user'`; criar marca → confirmar `add_brand_owner`; rodar a suíte
   (`bunx vitest run`) contra o projeto descartável.
7. Reapontar/desabilitar os 10 cron jobs no descartável para não gerar chamadas externas.
8. Só depois de 4-7 verdes: aplicar M1..M3 em produção e o `migration repair` de M0
   (com backup/PITR confirmado antes).
9. Excluir o projeto descartável.

---

## 9. APROVAÇÃO

Nada foi executado. Aguardando autorização explícita para:

- [ ] criar o arquivo de baseline M0 no repositório
- [ ] criar as migrations M1, M2, M3
- [ ] aplicar M1/M2/M3 em produção
- [ ] rodar `migration repair` de M0 em produção
- [ ] ajuste de código M4

---

## 10. ARTEFATOS PREPARADOS (staging — nada aplicado)

### 10.1 Por que em `supabase/baseline/` e não em `supabase/migrations/`

`supabase/migrations/` é gerenciado pelo pipeline de migrations do projeto: qualquer
arquivo colocado lá entra na fila de aplicação **no banco de produção**. Como esta
etapa exige explicitamente zero alteração em produção, os SQLs ficam em staging até
aprovação. A promoção (cópia para `supabase/migrations/`) é feita em um clone
separado para o teste em Supabase descartável.

### 10.2 Arquivos criados

| Arquivo | Timestamp | Resumo |
|---|---|---|
| `supabase/baseline/20260101000000_baseline_pre_versioning.sql` | anterior à 1ª histórica (`20260707030537`) | `CREATE OR REPLACE FUNCTION public.update_updated_at_column()` (definição idêntica à de produção, `search_path = public`) + `REVOKE` de `PUBLIC`/`anon` + `GRANT EXECUTE` a `service_role`; `CREATE TABLE IF NOT EXISTS public.user_profiles` (6 colunas base, PK, FK `auth.users ON DELETE CASCADE`, `role NOT NULL DEFAULT 'user'`); `ENABLE ROW LEVEL SECURITY`; trigger `update_user_profiles_modtime`; policy histórica `"Autenticados veem perfis"` (removida depois por `20260710020307`); grants mínimos (`REVOKE ALL FROM anon`, `SELECT/INSERT/UPDATE/DELETE` a `authenticated`, `ALL` a `service_role`). |
| `supabase/baseline/20260821090000_fix_user_profiles_role_and_signup.sql` | posterior à última histórica (`20260820134714`) | `role SET DEFAULT 'user'`; `UPDATE` de normalização (rede de segurança, 0 linhas hoje); recria `user_profiles_role_check` com `admin|manager|user|super_admin`; `CREATE OR REPLACE public.handle_new_user()` (`SECURITY DEFINER`, fallback `'user'`, nunca `member`/`editor`) + trigger `on_auth_user_created AFTER INSERT ON auth.users`; endurece privilégios (`REVOKE ALL FROM anon`, remove `TRUNCATE/REFERENCES/TRIGGER` de `authenticated`). |
| `supabase/baseline/20260821090100_storage_buckets_baseline.sql` | posterior | `INSERT ... ON CONFLICT DO NOTHING` nos 4 buckets privados (`brand-assets`, `brand-documents`, `brand-media`, `avatars`) que nunca foram versionados. |
| `supabase/baseline/README.md` | — | Instruções de promoção e lista de comandos proibidos nesta etapa. |

Decisões relevantes:
- O baseline **não** recria colunas adicionadas por migrations posteriores
  (`requires_password_change`, `phone`, `timezone`, `locale`, `job_title`, `bio`,
  `is_super_admin`, `whatsapp`, `notify_whatsapp`, `notification_prefs`) — elas
  aparecem apenas em comentário explicativo.
- O baseline **não** cria o CHECK de `role` (isso é papel de `20260819150650`).
- O enum `public.app_role` **não** é recriado nem alterado.
- `role` no baseline já nasce com `DEFAULT 'user'` (o histórico `'editor'` seria
  incompatível com o CHECK posterior).

### 10.3 Ordem de aplicação em instância limpa

```
20260101000000_baseline_pre_versioning.sql        <- baseline (objetos pré-versionamento)
20260707030537 ... 20260820134714                 <- 199 migrations históricas, intactas
20260821090000_fix_user_profiles_role_and_signup.sql
20260821090100_storage_buckets_baseline.sql
```

### 10.4 Validação estática executada (sem tocar no banco)

| Verificação | Resultado |
|---|---|
| Ordenação dos timestamps (baseline 1º, forward por último) | OK |
| Colisão de nome de arquivo com histórico | nenhuma |
| Colisão de timestamp com histórico | nenhuma |
| 1ª ocorrência de `user_profiles` na sequência | agora é o baseline (antes: `20260707032536`) |
| 1ª ocorrência de `update_updated_at_column` | agora é o baseline (antes: `20260707030537`) |
| `ALTER TABLE` sem `CREATE TABLE` anterior | **0** (antes: 1 — `user_profiles`) |
| `EXECUTE FUNCTION` de função de trigger nunca definida | **0** |
| Baseline recria colunas posteriores | não |
| Migrations históricas modificadas | **0** (199 arquivos preservados byte a byte) |

Problemas remanescentes (não bloqueiam o teste, documentados):
1. `20260720144007` (linha 230) referencia `user_profiles.user_id` (coluna inexistente);
   corrigido por `20260720144133`. Não impede `db push` (corpo de função não é validado).
2. As 10 chamadas `cron.schedule` apontam para URL/segredo do ambiente atual —
   precisam ser reapontadas ou removidas no projeto descartável.
3. As migrations históricas não são idempotentes: só aplicáveis a banco vazio.

### 10.5 Como validar em Supabase descartável

Ver seção 8 (roteiro completo) e `supabase/baseline/README.md`. Resumo:
clone separado do repo → `cp supabase/baseline/*.sql supabase/migrations/` →
`supabase link --project-ref <ref-descartavel>` → `supabase db push` →
comparar estrutura com produção (colunas, constraints, policies, `relacl`, `pg_proc`,
triggers, buckets) → teste funcional de signup/marca → `vitest run`.

### 10.6 Como tratar produção (somente depois da validação verde)

1. Backup/PITR confirmado.
2. `20260101000000_baseline_pre_versioning.sql`: **nunca executar**. Registrar como
   aplicado: `supabase migration repair --status applied 20260101000000`.
   Este comando **só** pode ocorrer após validação completa em banco descartável.
3. `20260821090000` e `20260821090100`: aplicar pelo fluxo normal de migrations
   (a ferramenta de migration do projeto), nessa ordem.
4. Regerar `src/integrations/supabase/types.ts`.

### 10.7 Comandos que NÃO devem ser executados nesta etapa

- `supabase db push` contra produção
- `supabase migration repair --status applied ...` em produção
- qualquer SQL remoto de escrita (`INSERT/UPDATE/DELETE/ALTER/DDL`) no projeto de produção
- mover/copiar `supabase/baseline/*.sql` para `supabase/migrations/` no repositório
  ligado à produção
- qualquer edição, renomeação ou remoção de arquivo em `supabase/migrations/`
