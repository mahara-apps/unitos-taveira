-- =============================================================================
-- 007_delta_migrations.sql — DELTA do baseline.
--
-- O dump `001_initial_schema.sql` foi tirado em 2026-08-29 (migration
-- 20260829120135). Tudo que entrou depois vive aqui, na ordem cronologica
-- original das migrations, para que uma instalacao nova nasca identica ao
-- MASTER (briefing import por IA, workspace singleton, Installation Manager,
-- leases de ai_jobs, autoridade de integracao, /setup, etc).
--
-- Gerado por: supabase/baseline-snapshot/tools/build_delta.py
-- Aplicar DEPOIS de 005_auth_trigger.sql e ANTES de 003_storage_buckets.sql.
-- Nao editar a mao: regenerar quando novas migrations forem criadas.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 20260829121019_8a4f7bd3-bff7-464d-997c-d72f8676ebec.sql
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brain_archive_and_prune_events()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  hot_days   int := public._brain_cfg_days('brain_events_hot_days', 90);
  dropped    int := 0;
  part record;
  cutoff timestamptz := now() - (hot_days || ' days')::interval;
BEGIN
  FOR part IN
    SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'public.brain_events'::regclass
       AND c.relname <> 'brain_events_default'
  LOOP
    IF part.bound ~ 'TO \(''([^'']+)''\)' THEN
      IF (regexp_replace(part.bound, '.*TO \(''([^'']+)''\).*', '\1'))::timestamptz <= cutoff THEN
        EXECUTE format('DROP TABLE public.%I', part.relname);
        dropped := dropped + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('archived', 0, 'partitions_dropped', dropped, 'cutoff', cutoff);
END $function$;

DROP TABLE IF EXISTS public.brain_events_archive;

-- ---------------------------------------------------------------------------
-- 20260829122439_666fef4f-a72d-4fd9-b66a-9f387dc63dd2.sql
-- ---------------------------------------------------------------------------
-- ETAPA 3 — desparticionar public.brain_events (transação única; rollback automático em falha)
DO $$
DECLARE
  before_count bigint;
  before_hash text;
  after_count bigint;
  after_hash text;
BEGIN
  SELECT count(*), md5(coalesce(string_agg(id::text, ',' ORDER BY id), ''))
    INTO before_count, before_hash FROM public.brain_events;

  -- 1) Nova tabela normal com PK simples
  CREATE TABLE public.brain_events_new (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    source_module text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    outcome_score numeric,
    created_at timestamptz NOT NULL DEFAULT now(),
    actor_id uuid,
    entity_type text,
    entity_id uuid,
    action text,
    client_id uuid,
    project_id uuid,
    confidence numeric,
    correlation_id uuid,
    processed_at timestamptz,
    CONSTRAINT brain_events_new_pkey PRIMARY KEY (id)
  );

  -- 2) Copiar dados (sem triggers ativos na nova tabela)
  INSERT INTO public.brain_events_new (
    id, brand_id, event_type, source_module, payload, outcome_score, created_at,
    actor_id, entity_type, entity_id, action, client_id, project_id,
    confidence, correlation_id, processed_at
  )
  SELECT id, brand_id, event_type, source_module, payload, outcome_score, created_at,
         actor_id, entity_type, entity_id, action, client_id, project_id,
         confidence, correlation_id, processed_at
    FROM public.brain_events;

  SELECT count(*), md5(coalesce(string_agg(id::text, ',' ORDER BY id), ''))
    INTO after_count, after_hash FROM public.brain_events_new;

  IF after_count <> before_count OR after_hash <> before_hash THEN
    RAISE EXCEPTION 'ETAPA 3 abortada: divergencia de dados (antes=% / depois=%, hash antes=% / depois=%)',
      before_count, after_count, before_hash, after_hash;
  END IF;

  -- 3) Trocar as tabelas
  DROP TABLE public.brain_events CASCADE;
  ALTER TABLE public.brain_events_new RENAME TO brain_events;
  ALTER TABLE public.brain_events RENAME CONSTRAINT brain_events_new_pkey TO brain_events_pkey;

  RAISE NOTICE 'ETAPA 3: % eventos consolidados', after_count;
END $$;

-- 4) Índices definidos na auditoria
CREATE INDEX brain_events_brand_created_idx ON public.brain_events USING btree (brand_id, created_at DESC);
CREATE INDEX brain_events_type_idx ON public.brain_events USING btree (event_type);
CREATE INDEX brain_events_unprocessed_idx ON public.brain_events USING btree (created_at) WHERE processed_at IS NULL;

-- 5) Grants + RLS equivalentes
GRANT SELECT, INSERT ON public.brain_events TO authenticated;
GRANT ALL ON public.brain_events TO service_role;

ALTER TABLE public.brain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_events FORCE ROW LEVEL SECURITY;

CREATE POLICY "brain_events_part_select" ON public.brain_events
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id));

CREATE POLICY "brain_events_part_insert" ON public.brain_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.client_in_scope(client_id, brand_id)
    AND (actor_id IS NULL OR actor_id = auth.uid())
    AND created_at >= (now() - interval '2 minutes')
    AND created_at <= (now() + interval '2 minutes')
  );

-- 6) Triggers preservados (identidade + enqueue do Learning)
CREATE TRIGGER trg_brain_events_guard_identity
  BEFORE INSERT ON public.brain_events
  FOR EACH ROW EXECUTE FUNCTION public.brain_events_guard_identity();

CREATE TRIGGER trg_brain_events_enqueue_learning
  AFTER INSERT ON public.brain_events
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_brain_event_for_learning();

COMMENT ON TABLE public.brain_events IS
  'Barramento de eventos do Brain. Tabela unica (nao particionada) desde a ETAPA 3 da simplificacao.';

-- 7) Retenção sem particionamento
CREATE OR REPLACE FUNCTION public.brain_events_prune()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  hot_days int := public._brain_cfg_days('brain_events_hot_days', 90);
  cutoff timestamptz := now() - (hot_days || ' days')::interval;
  deleted int;
BEGIN
  WITH d AS (
    DELETE FROM public.brain_events WHERE created_at < cutoff RETURNING 1
  ) SELECT count(*) INTO deleted FROM d;
  RETURN jsonb_build_object('deleted', deleted, 'cutoff', cutoff);
END $function$;

REVOKE ALL ON FUNCTION public.brain_events_prune() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.brain_events_prune() FROM anon;
REVOKE ALL ON FUNCTION public.brain_events_prune() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.brain_events_prune() TO service_role;

CREATE OR REPLACE FUNCTION public.brain_retention_run()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a jsonb; b jsonb;
BEGIN
  a := public.brain_events_prune();
  b := public.brain_cleanup_ttl();
  RETURN jsonb_build_object('events', a, 'ttl', b, 'ran_at', now());
END $function$;

-- 8) Mecanismos exclusivos de particionamento
DROP FUNCTION IF EXISTS public.brain_ensure_event_partitions(integer, integer);
DROP FUNCTION IF EXISTS public.brain_archive_and_prune_events();
DROP FUNCTION IF EXISTS public.brain_apply_partition_policies(text);

DELETE FROM public.brain_retention_config WHERE key = 'brain_events_archive_days';

-- ---------------------------------------------------------------------------
-- 20260829124704_ed97a5cb-3e08-49ce-bc7a-88e12e0d9723.sql
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_orphans int; v_emb int;
BEGIN
  -- 1) Encerrar órfãos da fila sem retry
  UPDATE public.brain_learning_queue q
     SET status = 'skipped',
         error = COALESCE(NULLIF(q.error, ''), 'orphan_event: event_id não existe em brain_events (evento expurgado)'),
         processed_at = COALESCE(q.processed_at, now()),
         updated_at = now()
   WHERE NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id)
     AND q.status <> 'skipped';

  -- 2) Remover as linhas órfãs remanescentes (não podem satisfazer a FK)
  DELETE FROM public.brain_learning_queue q
   WHERE NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id);

  DELETE FROM public.brain_embeddings b
   WHERE b.event_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = b.event_id);

  SELECT count(*) INTO v_orphans FROM public.brain_learning_queue q
   WHERE NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id);
  SELECT count(*) INTO v_emb FROM public.brain_embeddings b
   WHERE b.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = b.event_id);
  IF v_orphans <> 0 OR v_emb <> 0 THEN
    RAISE EXCEPTION 'orfaos remanescentes: fila=% embeddings=%', v_orphans, v_emb;
  END IF;
END $$;

-- 3) FKs reais (CASCADE: o expurgo por idade de brain_events remove dependentes,
--    eliminando estruturalmente a classe de órfãos)
ALTER TABLE public.brain_learning_queue
  ADD CONSTRAINT brain_learning_queue_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.brain_events(id) ON DELETE CASCADE;

ALTER TABLE public.brain_embeddings
  ADD CONSTRAINT brain_embeddings_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.brain_events(id) ON DELETE CASCADE;

-- 4) Renomear policies (regras inalteradas)
ALTER POLICY "brain_events_part_select" ON public.brain_events RENAME TO "brain_events_select";
ALTER POLICY "brain_events_part_insert" ON public.brain_events RENAME TO "brain_events_insert";

-- ---------------------------------------------------------------------------
-- 20260829130645_6465717a-f869-49b9-b603-bc7434389391.sql
-- ---------------------------------------------------------------------------
CREATE TABLE public.installation (
  id boolean NOT NULL DEFAULT true PRIMARY KEY,
  app_url text,
  logo_url text,
  logo_dark_url text,
  icon_url text,
  login_logo_url text,
  email_from text,
  email_from_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installation_singleton_chk CHECK (id)
);

GRANT SELECT ON public.installation TO anon;
GRANT SELECT ON public.installation TO authenticated;
GRANT ALL ON public.installation TO service_role;

ALTER TABLE public.installation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "installation_select_public" ON public.installation
  FOR SELECT USING (true);

CREATE POLICY "installation_update_super_admin" ON public.installation
  FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER installation_touch_updated_at
  BEFORE UPDATE ON public.installation
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.installation (id, logo_url, logo_dark_url, icon_url, login_logo_url)
SELECT true, b.logo_url, b.logo_dark_url, b.icon_url, b.login_logo_url
FROM public.brands b
WHERE b.id = '60fce5a7-1859-4bbd-a887-9018ed7f17b5'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.installation (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 20260829192349_ff418028-7401-404c-92d9-be9b0e29e2bd.sql
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.briefing_import_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ai_job_id uuid REFERENCES public.ai_jobs(id) ON DELETE SET NULL,
  created_by uuid,
  source_kind text NOT NULL DEFAULT 'document',
  document_id uuid REFERENCES public.client_documents(id) ON DELETE SET NULL,
  raw_text text,
  status text NOT NULL DEFAULT 'queued',
  current_step text,
  attempt integer NOT NULL DEFAULT 0,
  idempotency_key text,
  input_fingerprint text,
  model text,
  provider text,
  base_version_id uuid REFERENCES public.brand_briefing_versions(id) ON DELETE SET NULL,
  applied_version_id uuid REFERENCES public.brand_briefing_versions(id) ON DELETE SET NULL,
  summary text,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric,
  speakers jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  error_kind text,
  tokens_in integer,
  tokens_out integer,
  cost_cents numeric,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT briefing_import_runs_source_kind_chk
    CHECK (source_kind IN ('document','paste','transcript','url')),
  CONSTRAINT briefing_import_runs_status_chk
    CHECK (status IN ('queued','running','proposed','applying','applied','failed','cancelled','discarded'))
);

CREATE INDEX IF NOT EXISTS briefing_import_runs_scope_idx
  ON public.briefing_import_runs (brand_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS briefing_import_runs_document_idx
  ON public.briefing_import_runs (document_id) WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS briefing_import_runs_job_idx
  ON public.briefing_import_runs (ai_job_id) WHERE ai_job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS briefing_import_runs_active_key_idx
  ON public.briefing_import_runs (brand_id, client_id, source_kind, input_fingerprint)
  WHERE input_fingerprint IS NOT NULL
    AND status IN ('queued','running','proposed','applying');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.briefing_import_runs TO authenticated;
GRANT ALL ON public.briefing_import_runs TO service_role;
ALTER TABLE public.briefing_import_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "briefing imports in client scope read" ON public.briefing_import_runs;
CREATE POLICY "briefing imports in client scope read" ON public.briefing_import_runs
  FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));
DROP POLICY IF EXISTS "briefing imports in client scope insert" ON public.briefing_import_runs;
CREATE POLICY "briefing imports in client scope insert" ON public.briefing_import_runs
  FOR INSERT TO authenticated WITH CHECK (public.client_in_scope(client_id, brand_id));
DROP POLICY IF EXISTS "briefing imports in client scope update" ON public.briefing_import_runs;
CREATE POLICY "briefing imports in client scope update" ON public.briefing_import_runs
  FOR UPDATE TO authenticated USING (public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.client_in_scope(client_id, brand_id));
DROP POLICY IF EXISTS "briefing imports in client scope delete" ON public.briefing_import_runs;
CREATE POLICY "briefing imports in client scope delete" ON public.briefing_import_runs
  FOR DELETE TO authenticated USING (public.client_in_scope(client_id, brand_id));

CREATE TABLE IF NOT EXISTS public.briefing_import_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.briefing_import_runs(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  step text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  input_ref text,
  output jsonb,
  error text,
  error_kind text,
  duration_ms integer,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT briefing_import_steps_step_chk
    CHECK (step IN ('ingest','extract','interpret','diff','propose','apply')),
  CONSTRAINT briefing_import_steps_status_chk
    CHECK (status IN ('pending','running','done','failed','skipped')),
  CONSTRAINT briefing_import_steps_unique UNIQUE (run_id, step)
);

CREATE INDEX IF NOT EXISTS briefing_import_steps_run_idx ON public.briefing_import_steps (run_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.briefing_import_steps TO authenticated;
GRANT ALL ON public.briefing_import_steps TO service_role;
ALTER TABLE public.briefing_import_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "briefing import steps in client scope read" ON public.briefing_import_steps;
CREATE POLICY "briefing import steps in client scope read" ON public.briefing_import_steps
  FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));
DROP POLICY IF EXISTS "briefing import steps in client scope insert" ON public.briefing_import_steps;
CREATE POLICY "briefing import steps in client scope insert" ON public.briefing_import_steps
  FOR INSERT TO authenticated WITH CHECK (public.client_in_scope(client_id, brand_id));
DROP POLICY IF EXISTS "briefing import steps in client scope update" ON public.briefing_import_steps;
CREATE POLICY "briefing import steps in client scope update" ON public.briefing_import_steps
  FOR UPDATE TO authenticated USING (public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.client_in_scope(client_id, brand_id));
DROP POLICY IF EXISTS "briefing import steps in client scope delete" ON public.briefing_import_steps;
CREATE POLICY "briefing import steps in client scope delete" ON public.briefing_import_steps
  FOR DELETE TO authenticated USING (public.client_in_scope(client_id, brand_id));

CREATE TABLE IF NOT EXISTS public.briefing_import_changes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.briefing_import_runs(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  field text NOT NULL,
  action text NOT NULL,
  current_value jsonb,
  proposed_value jsonb,
  confidence numeric,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision text NOT NULL DEFAULT 'pending',
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT briefing_import_changes_action_chk
    CHECK (action IN ('create','update','keep','discard')),
  CONSTRAINT briefing_import_changes_decision_chk
    CHECK (decision IN ('pending','accepted','rejected')),
  CONSTRAINT briefing_import_changes_unique UNIQUE (run_id, field)
);

CREATE INDEX IF NOT EXISTS briefing_import_changes_run_idx ON public.briefing_import_changes (run_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.briefing_import_changes TO authenticated;
GRANT ALL ON public.briefing_import_changes TO service_role;
ALTER TABLE public.briefing_import_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "briefing import changes in client scope read" ON public.briefing_import_changes;
CREATE POLICY "briefing import changes in client scope read" ON public.briefing_import_changes
  FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));
DROP POLICY IF EXISTS "briefing import changes in client scope insert" ON public.briefing_import_changes;
CREATE POLICY "briefing import changes in client scope insert" ON public.briefing_import_changes
  FOR INSERT TO authenticated WITH CHECK (public.client_in_scope(client_id, brand_id));
DROP POLICY IF EXISTS "briefing import changes in client scope update" ON public.briefing_import_changes;
CREATE POLICY "briefing import changes in client scope update" ON public.briefing_import_changes
  FOR UPDATE TO authenticated USING (public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.client_in_scope(client_id, brand_id));
DROP POLICY IF EXISTS "briefing import changes in client scope delete" ON public.briefing_import_changes;
CREATE POLICY "briefing import changes in client scope delete" ON public.briefing_import_changes
  FOR DELETE TO authenticated USING (public.client_in_scope(client_id, brand_id));

DROP TRIGGER IF EXISTS briefing_import_runs_touch ON public.briefing_import_runs;
CREATE TRIGGER briefing_import_runs_touch BEFORE UPDATE ON public.briefing_import_runs
  FOR EACH ROW EXECUTE FUNCTION public.brain_touch_updated_at();
DROP TRIGGER IF EXISTS briefing_import_steps_touch ON public.briefing_import_steps;
CREATE TRIGGER briefing_import_steps_touch BEFORE UPDATE ON public.briefing_import_steps
  FOR EACH ROW EXECUTE FUNCTION public.brain_touch_updated_at();
DROP TRIGGER IF EXISTS briefing_import_changes_touch ON public.briefing_import_changes;
CREATE TRIGGER briefing_import_changes_touch BEFORE UPDATE ON public.briefing_import_changes
  FOR EACH ROW EXECUTE FUNCTION public.brain_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 20260830012943_1e8a6c61-a3d6-43be-9d97-12ddc1f27551.sql
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "clients delete in scope" ON public.clients;
CREATE POLICY "clients delete admins only"
ON public.clients FOR DELETE TO authenticated
USING (
  public.can_access_client_row(id, brand_id, owner_user_id, auth.uid())
  AND public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin'])
);

-- ---------------------------------------------------------------------------
-- 20260830013629_7e55f7aa-97a4-41e0-bbd5-bd7bf7bc0e2e.sql
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_create_brand(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    AND (
      -- super admin não tem limite
      public.is_super_admin(_user_id)
      OR (
        -- regra de 1 workspace por conta: bloqueia quem já é owner
        NOT EXISTS (
          SELECT 1 FROM public.brand_members bm
          WHERE bm.user_id = _user_id
            AND bm.is_active
            AND bm.role = 'owner'
        )
        AND (
          EXISTS (
            SELECT 1 FROM public.brand_members bm
            WHERE bm.user_id = _user_id
              AND bm.is_active
              AND bm.role IN ('owner', 'manager', 'user')
          )
          OR NOT EXISTS (
            SELECT 1 FROM public.client_members cm
            WHERE cm.user_id = _user_id
              AND cm.role = 'portal_client'
          )
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_create_brand(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_brand(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 20260830144258_8994d9ad-22b9-42bc-b399-af3ad8ae7f0c.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.monthly_plans DROP CONSTRAINT IF EXISTS monthly_plans_status_check;

ALTER TABLE public.monthly_plans
  ADD CONSTRAINT monthly_plans_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text,
    'pending_client'::text,
    'client_approved'::text,
    'changes_requested'::text,
    'client_rejected'::text,
    'approved'::text,
    'archived'::text
  ]));

-- ---------------------------------------------------------------------------
-- 20260830160743_97d6eec2-f70f-4b06-8575-aa7d56293768.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS overage_policy text NOT NULL DEFAULT 'block';

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS overage_policy text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_overage_policy_check'
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_overage_policy_check
      CHECK (overage_policy IN ('block','warn'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_overage_policy_check'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_overage_policy_check
      CHECK (overage_policy IS NULL OR overage_policy IN ('block','warn'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 20260830213925_52084306-5ed3-4ae9-ab04-ac513317a4b2.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.meta_oauth_sessions ADD COLUMN IF NOT EXISTS state_nonce text;
CREATE UNIQUE INDEX IF NOT EXISTS meta_oauth_sessions_state_nonce_key ON public.meta_oauth_sessions (state_nonce) WHERE state_nonce IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 20260830223040_03d0460b-87ec-497b-9a52-707fa822d041.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.meta_oauth_sessions
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_reason text;

CREATE INDEX IF NOT EXISTS meta_oauth_sessions_brand_active_idx
  ON public.meta_oauth_sessions (brand_id, created_at DESC)
  WHERE revoked_at IS NULL;

UPDATE public.meta_oauth_sessions s
SET revoked_at = now(),
    revoked_reason = 'Backfill: workspace sem canais Meta ativos'
WHERE s.revoked_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.social_connections c
    WHERE c.brand_id = s.brand_id
      AND c.provider = 'meta'
      AND c.status <> 'revoked'
  );

-- ---------------------------------------------------------------------------
-- 20260830231417_2a6e8dc6-b91b-4882-bc5d-c6734500e7e0.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_connections
  ADD COLUMN IF NOT EXISTS meta_business_id text,
  ADD COLUMN IF NOT EXISTS meta_business_name text;

ALTER TABLE public.meta_oauth_sessions
  ADD COLUMN IF NOT EXISTS businesses jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS social_connections_brand_meta_business_idx
  ON public.social_connections (brand_id, provider, meta_business_id);

CREATE INDEX IF NOT EXISTS meta_oauth_sessions_brand_active_idx
  ON public.meta_oauth_sessions (brand_id, created_at DESC)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 20260831002750_03568d12-1609-4489-be77-a9bd7a744b51.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.monthly_plan_topics
  ADD COLUMN IF NOT EXISTS suggested_at timestamptz,
  ADD COLUMN IF NOT EXISTS suggested_slot_rationale text,
  ADD COLUMN IF NOT EXISTS suggested_confidence text;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS schedule_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_approved_by uuid,
  ADD COLUMN IF NOT EXISTS schedule_client_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_client_comment text;

CREATE INDEX IF NOT EXISTS posts_proposed_at_idx
  ON public.posts (brand_id, client_id, proposed_at)
  WHERE proposed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.posts_validate_schedule_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.schedule_status IS NULL THEN
    NEW.schedule_status := 'none';
  END IF;
  IF NEW.schedule_status NOT IN ('none','proposed','internal_approved','client_pending','client_changes','reserved') THEN
    RAISE EXCEPTION 'invalid schedule_status: %', NEW.schedule_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_validate_schedule_status ON public.posts;
CREATE TRIGGER posts_validate_schedule_status
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.posts_validate_schedule_status();

-- ---------------------------------------------------------------------------
-- 20260831014531_67066e9f-80b8-44f8-ac23-2064e851b7e0.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS rate_limit_retries integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deferred_since timestamptz;

CREATE INDEX IF NOT EXISTS social_posts_next_attempt_idx
  ON public.social_posts (status, next_attempt_at)
  WHERE status = 'scheduled';

CREATE OR REPLACE FUNCTION public.claim_scheduled_social_posts(p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, brand_id uuid, client_id uuid, connection_id uuid, provider text, placement text, caption text, hashtags text[], mentions text[], media jsonb, publish_attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT sp.id
    FROM public.social_posts sp
    JOIN public.social_connections sc ON sc.id = sp.connection_id
    WHERE sp.status = 'scheduled'
      AND sp.scheduled_at IS NOT NULL
      AND sp.scheduled_at <= now()
      -- Backoff: item adiado por limite temporário da Meta só volta ao tempo devido.
      AND (sp.next_attempt_at IS NULL OR sp.next_attempt_at <= now())
      AND (sp.publish_locked_at IS NULL OR sp.publish_locked_at < now() - interval '10 minutes')
      AND sp.publish_attempts < 5
      AND sc.brand_id = sp.brand_id
      AND (
        sp.client_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.client_social_accounts csa
          WHERE csa.connection_id = sp.connection_id
            AND csa.client_id = sp.client_id
            AND csa.brand_id = sp.brand_id
        )
      )
    ORDER BY sp.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE OF sp SKIP LOCKED
  ),
  locked AS (
    UPDATE public.social_posts sp
       SET publish_locked_at = now(),
           status = 'publishing',
           updated_at = now()
      FROM candidates c
     WHERE sp.id = c.id
     RETURNING sp.id, sp.brand_id, sp.client_id, sp.connection_id, sp.provider,
               sp.placement, sp.caption, sp.hashtags, sp.mentions, sp.media,
               sp.publish_attempts
  )
  SELECT * FROM locked;
END;
$function$;

-- Adia a publicação sem consumir tentativa (limite temporário da Meta).
-- Depois de 8 adiamentos ou 6h de espera, vira falha visível com mensagem clara.
CREATE OR REPLACE FUNCTION public.mark_social_post_deferred(
  p_post_id uuid,
  p_error text,
  p_retry_at timestamptz
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_since timestamptz;
  v_retries int;
BEGIN
  SELECT COALESCE(deferred_since, now()), rate_limit_retries
    INTO v_since, v_retries
    FROM public.social_posts
   WHERE id = p_post_id;

  IF v_retries IS NULL THEN
    RETURN;
  END IF;

  IF v_retries + 1 >= 8 OR v_since < now() - interval '6 hours' THEN
    UPDATE public.social_posts
       SET status = 'failed',
           publish_locked_at = NULL,
           next_attempt_at = NULL,
           rate_limit_retries = v_retries + 1,
           last_error = 'Limite de requisições da Meta persistiu por várias horas. Reenvie este destino manualmente. Detalhe: ' || COALESCE(p_error, ''),
           updated_at = now()
     WHERE id = p_post_id;
  ELSE
    UPDATE public.social_posts
       SET status = 'scheduled',
           publish_locked_at = NULL,
           next_attempt_at = p_retry_at,
           deferred_since = v_since,
           rate_limit_retries = v_retries + 1,
           last_error = COALESCE(p_error, 'Limite temporário da Meta'),
           updated_at = now()
     WHERE id = p_post_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_social_post_deferred(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_social_post_deferred(uuid, text, timestamptz) TO service_role;

-- Sucesso/nova tentativa manual limpam o estado de backoff.
CREATE OR REPLACE FUNCTION public.mark_social_post_failed(p_post_id uuid, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.social_posts
     SET publish_attempts = publish_attempts + 1,
         last_error = p_error,
         publish_locked_at = NULL,
         next_attempt_at = NULL,
         status = CASE
           WHEN publish_attempts + 1 >= 5 THEN 'failed'
           ELSE 'scheduled'
         END,
         updated_at = now()
   WHERE id = p_post_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 20260831160754_bf8ec7fa-b281-413c-a4fc-6e9475a0d817.sql
-- ---------------------------------------------------------------------------
-- 1) Fonte canônica única de "autoridade de integração" (exclui MANAGER).
CREATE OR REPLACE FUNCTION public.is_brand_integration_authority(_brand_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (
       public.is_super_admin(_user_id)
       OR (_brand_id IS NOT NULL
           AND public.app_access_role(_user_id, _brand_id) IN ('super_admin', 'admin'))
     );
$function$;

GRANT EXECUTE ON FUNCTION public.is_brand_integration_authority(uuid, uuid) TO authenticated, service_role;

-- 2) meta_oauth_sessions: a autorização Meta pertence ao WORKSPACE.
DROP POLICY IF EXISTS "Users can read own meta sessions" ON public.meta_oauth_sessions;
DROP POLICY IF EXISTS "Users can update own meta sessions" ON public.meta_oauth_sessions;
DROP POLICY IF EXISTS "Users can delete own meta sessions" ON public.meta_oauth_sessions;
DROP POLICY IF EXISTS "meta_sessions_select_brand_authority" ON public.meta_oauth_sessions;
DROP POLICY IF EXISTS "meta_sessions_insert_brand_authority" ON public.meta_oauth_sessions;
DROP POLICY IF EXISTS "meta_sessions_update_brand_authority" ON public.meta_oauth_sessions;
DROP POLICY IF EXISTS "meta_sessions_delete_brand_authority" ON public.meta_oauth_sessions;

ALTER TABLE public.meta_oauth_sessions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_oauth_sessions TO authenticated;
GRANT ALL ON public.meta_oauth_sessions TO service_role;

CREATE POLICY "meta_sessions_select_brand_authority"
ON public.meta_oauth_sessions FOR SELECT TO authenticated
USING (
  public.is_brand_integration_authority(brand_id, auth.uid())
  OR user_id = auth.uid()
);

CREATE POLICY "meta_sessions_insert_brand_authority"
ON public.meta_oauth_sessions FOR INSERT TO authenticated
WITH CHECK (public.is_brand_integration_authority(brand_id, auth.uid()));

CREATE POLICY "meta_sessions_update_brand_authority"
ON public.meta_oauth_sessions FOR UPDATE TO authenticated
USING (public.is_brand_integration_authority(brand_id, auth.uid()))
WITH CHECK (public.is_brand_integration_authority(brand_id, auth.uid()));

CREATE POLICY "meta_sessions_delete_brand_authority"
ON public.meta_oauth_sessions FOR DELETE TO authenticated
USING (public.is_brand_integration_authority(brand_id, auth.uid()));

-- 3) social_connections: escrita só com autoridade de integração.
DROP POLICY IF EXISTS "social_connections admins insert" ON public.social_connections;
DROP POLICY IF EXISTS "social_connections admins update" ON public.social_connections;
DROP POLICY IF EXISTS "social_connections admins delete" ON public.social_connections;

CREATE POLICY "social_connections admins insert"
ON public.social_connections FOR INSERT TO authenticated
WITH CHECK (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
);

CREATE POLICY "social_connections admins update"
ON public.social_connections FOR UPDATE TO authenticated
USING (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
)
WITH CHECK (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
);

CREATE POLICY "social_connections admins delete"
ON public.social_connections FOR DELETE TO authenticated
USING (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
);

-- 4) client_social_accounts: mesma autoridade.
DROP POLICY IF EXISTS "csa admins insert" ON public.client_social_accounts;
DROP POLICY IF EXISTS "csa admins update" ON public.client_social_accounts;
DROP POLICY IF EXISTS "csa admins delete" ON public.client_social_accounts;

CREATE POLICY "csa admins insert"
ON public.client_social_accounts FOR INSERT TO authenticated
WITH CHECK (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
);

CREATE POLICY "csa admins update"
ON public.client_social_accounts FOR UPDATE TO authenticated
USING (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
)
WITH CHECK (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
);

CREATE POLICY "csa admins delete"
ON public.client_social_accounts FOR DELETE TO authenticated
USING (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
);

-- 5) brands: configurar o workspace é ação de Owner/Admin/Super Admin.
DROP POLICY IF EXISTS "admin level updates brand" ON public.brands;
CREATE POLICY "admin level updates brand"
ON public.brands FOR UPDATE TO authenticated
USING (public.is_brand_integration_authority(id, auth.uid()))
WITH CHECK (public.is_brand_integration_authority(id, auth.uid()));

-- ---------------------------------------------------------------------------
-- 20260831174049_4d7dd7e3-31fa-4b62-9f6c-dc7f8dbfad8b.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.briefing_import_runs
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS resume_step text;

ALTER TABLE public.briefing_import_steps
  ADD COLUMN IF NOT EXISTS output_ref text,
  ADD COLUMN IF NOT EXISTS content_hash text;

ALTER TABLE public.briefing_import_runs DROP CONSTRAINT IF EXISTS briefing_import_runs_status_chk;
ALTER TABLE public.briefing_import_runs ADD CONSTRAINT briefing_import_runs_status_chk
  CHECK (status = ANY (ARRAY[
    'queued','running','proposed','applying','applied',
    'failed','cancelled','discarded','paused','needs_input','expired'
  ]));

CREATE INDEX IF NOT EXISTS briefing_import_runs_lease_idx
  ON public.briefing_import_runs (status, lease_expires_at)
  WHERE status IN ('queued','running');

-- Reserva atômica de execuções da fila: um único vencedor por run.
CREATE OR REPLACE FUNCTION public.briefing_import_claim_lease(
  _owner text,
  _limit integer DEFAULT 3,
  _lease_seconds integer DEFAULT 120
)
RETURNS TABLE(
  id uuid,
  brand_id uuid,
  client_id uuid,
  created_by uuid,
  source_kind text,
  document_id uuid,
  raw_text text,
  attempt integer,
  max_attempts integer,
  resume_step text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT r.id
    FROM public.briefing_import_runs r
    WHERE r.status = 'queued'
      AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now())
      AND (r.deadline_at IS NULL OR r.deadline_at > now())
    ORDER BY r.created_at
    LIMIT GREATEST(_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.briefing_import_runs r
     SET status = 'running',
         lease_owner = _owner,
         lease_expires_at = now() + make_interval(secs => GREATEST(_lease_seconds, 30)),
         heartbeat_at = now(),
         started_at = COALESCE(r.started_at, now()),
         deadline_at = COALESCE(r.deadline_at, now() + interval '15 minutes'),
         error = NULL,
         error_kind = NULL,
         updated_at = now()
   WHERE r.id IN (SELECT c.id FROM candidates c)
  RETURNING r.id, r.brand_id, r.client_id, r.created_by, r.source_kind,
            r.document_id, r.raw_text, r.attempt, r.max_attempts, r.resume_step;
$$;

REVOKE ALL ON FUNCTION public.briefing_import_claim_lease(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_import_claim_lease(text, integer, integer) TO service_role;

-- Renovação do sinal de vida enquanto a etapa longa executa.
CREATE OR REPLACE FUNCTION public.briefing_import_heartbeat(
  _run_id uuid,
  _owner text,
  _lease_seconds integer DEFAULT 120
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upd AS (
    UPDATE public.briefing_import_runs
       SET heartbeat_at = now(),
           lease_expires_at = now() + make_interval(secs => GREATEST(_lease_seconds, 30)),
           updated_at = now()
     WHERE id = _run_id
       AND status = 'running'
       AND lease_owner = _owner
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM upd);
$$;

REVOKE ALL ON FUNCTION public.briefing_import_heartbeat(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_import_heartbeat(uuid, text, integer) TO service_role;

-- Recuperação de execuções abandonadas (isolate morto, deploy, timeout).
CREATE OR REPLACE FUNCTION public.briefing_import_reap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _requeued integer := 0;
  _expired integer := 0;
BEGIN
  WITH stalled AS (
    SELECT id FROM public.briefing_import_runs
     WHERE status = 'running'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < now()
       AND attempt + 1 < max_attempts
       AND (deadline_at IS NULL OR deadline_at > now())
     LIMIT 50
  ), upd AS (
    UPDATE public.briefing_import_runs r
       SET status = 'queued',
           attempt = r.attempt + 1,
           lease_owner = NULL,
           lease_expires_at = NULL,
           resume_step = COALESCE(r.resume_step, r.current_step),
           error = NULL,
           error_kind = NULL,
           updated_at = now()
     WHERE r.id IN (SELECT id FROM stalled)
    RETURNING 1
  )
  SELECT count(*) INTO _requeued FROM upd;

  WITH dead AS (
    SELECT id FROM public.briefing_import_runs
     WHERE status IN ('queued','running')
       AND (
         (deadline_at IS NOT NULL AND deadline_at < now())
         OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
       )
     LIMIT 50
  ), upd2 AS (
    UPDATE public.briefing_import_runs r
       SET status = 'expired',
           lease_owner = NULL,
           lease_expires_at = NULL,
           finished_at = now(),
           error_kind = 'stalled',
           error = COALESCE(r.error, 'Processamento interrompido antes de concluir. Tente novamente.'),
           updated_at = now()
     WHERE r.id IN (SELECT id FROM dead)
    RETURNING 1
  )
  SELECT count(*) INTO _expired FROM upd2;

  RETURN jsonb_build_object('requeued', _requeued, 'expired', _expired);
END;
$$;

REVOKE ALL ON FUNCTION public.briefing_import_reap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_import_reap() TO service_role;

-- ---------------------------------------------------------------------------
-- 20260831193027_0a9e00ff-ef8f-49cd-9851-454256a63537.sql
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.briefing_import_reap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _requeued integer := 0;
  _expired integer := 0;
BEGIN
  WITH stalled AS (
    SELECT id FROM public.briefing_import_runs
     WHERE status = 'running'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < now()
       AND attempt + 1 < max_attempts
       AND (deadline_at IS NULL OR deadline_at > now())
     LIMIT 50
  ), upd AS (
    UPDATE public.briefing_import_runs r
       SET status = 'queued',
           attempt = r.attempt + 1,
           lease_owner = NULL,
           lease_expires_at = NULL,
           resume_step = COALESCE(r.resume_step, r.current_step),
           error = NULL,
           error_kind = NULL,
           updated_at = now()
     WHERE r.id IN (SELECT id FROM stalled)
    RETURNING 1
  )
  SELECT count(*) INTO _requeued FROM upd;

  WITH dead AS (
    SELECT id FROM public.briefing_import_runs
     WHERE status IN ('queued','running')
       AND (
         (deadline_at IS NOT NULL AND deadline_at < now())
         OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
       )
     LIMIT 50
  ), upd2 AS (
    UPDATE public.briefing_import_runs r
       SET status = 'expired',
           lease_owner = NULL,
           lease_expires_at = NULL,
           finished_at = now(),
           -- Preserva a causa REAL persistida pelo worker; 'stalled' apenas
           -- quando nao ha erro anterior registrado.
           error_kind = COALESCE(NULLIF(r.error_kind, ''), CASE WHEN NULLIF(r.error, '') IS NOT NULL THEN NULL ELSE 'stalled' END, 'stalled'),
           error = COALESCE(NULLIF(r.error, ''), 'Processamento interrompido antes de concluir. Tente novamente.'),
           updated_at = now()
     WHERE r.id IN (SELECT id FROM dead)
    RETURNING 1
  )
  SELECT count(*) INTO _expired FROM upd2;

  RETURN jsonb_build_object('requeued', _requeued, 'expired', _expired);
END;
$$;

REVOKE ALL ON FUNCTION public.briefing_import_reap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_import_reap() TO service_role;

-- ---------------------------------------------------------------------------
-- 20260901120845_56c81d1f-192f-4c9d-9b78-c08530b8430e.sql
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_scope_readable(_client_id uuid, _brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _brand_id IS NOT NULL
     AND public.is_brand_member(_brand_id, auth.uid())
     AND CASE
           WHEN _client_id IS NOT NULL THEN public.can_access_client(_client_id, auth.uid())
           -- Sem cliente definido o registro é brand-level (sensível):
           -- somente autoridade de workspace pode ler.
           ELSE public.app_access_role(auth.uid(), _brand_id)
                  = ANY (ARRAY['super_admin'::text, 'admin'::text])
         END;
$$;

REVOKE ALL ON FUNCTION public.ai_scope_readable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_scope_readable(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "brain_memory select in client scope" ON public.brain_memory;
CREATE POLICY "brain_memory select in client scope"
ON public.brain_memory
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.ai_scope_readable(client_id, brand_id));

DROP POLICY IF EXISTS "brain_insights select in client scope" ON public.brain_insights;
CREATE POLICY "brain_insights select in client scope"
ON public.brain_insights
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.ai_scope_readable(client_id, brand_id));

DROP POLICY IF EXISTS "ai usage in client scope read" ON public.brand_ai_usage;
CREATE POLICY "ai usage in client scope read"
ON public.brand_ai_usage
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.ai_scope_readable(client_id, brand_id));

-- ---------------------------------------------------------------------------
-- 20260901132638_2b18daea-7fb4-425e-a95b-9c990a0c27c0.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_jobs
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

CREATE INDEX IF NOT EXISTS ai_jobs_active_lease_idx
  ON public.ai_jobs (status, lease_expires_at)
  WHERE status IN ('queued','running');

CREATE OR REPLACE FUNCTION public.ai_job_lease_ttl(_kind text)
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _kind
    WHEN 'monthly_plan' THEN interval '12 minutes'
    WHEN 'customer_strategy' THEN interval '15 minutes'
    ELSE interval '5 minutes'
  END
$$;

CREATE OR REPLACE FUNCTION public.ai_job_claim_lease(_job_id uuid, _owner text, _lease_seconds integer DEFAULT 120)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean := false;
BEGIN
  IF _owner IS NULL OR length(btrim(_owner)) = 0 THEN
    RETURN false;
  END IF;
  UPDATE public.ai_jobs
     SET lease_owner = _owner,
         lease_expires_at = now() + make_interval(secs => greatest(_lease_seconds, 10)),
         heartbeat_at = now(),
         updated_at = now()
   WHERE id = _job_id
     AND status IN ('queued','running')
     AND (auth.uid() IS NULL OR user_id = auth.uid())
     AND (
       lease_owner IS NULL
       OR lease_owner = _owner
       OR lease_expires_at IS NULL
       OR lease_expires_at < now()
     );
  ok := FOUND;
  RETURN ok;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_job_heartbeat(_job_id uuid, _owner text, _lease_seconds integer DEFAULT 120)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean := false;
BEGIN
  UPDATE public.ai_jobs
     SET lease_expires_at = now() + make_interval(secs => greatest(_lease_seconds, 10)),
         heartbeat_at = now(),
         updated_at = now()
   WHERE id = _job_id
     AND lease_owner = _owner
     AND status IN ('queued','running')
     AND (auth.uid() IS NULL OR user_id = auth.uid());
  ok := FOUND;
  RETURN ok;
END;
$$;

CREATE OR REPLACE FUNCTION public.reap_stuck_ai_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reaped integer;
BEGIN
  WITH updated AS (
    UPDATE public.ai_jobs
       SET status = 'failed',
           error = COALESCE(error, 'timeout: worker interrompido antes da conclusão'),
           finished_at = now(),
           step_label = NULL,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE status IN ('queued','running')
       AND (
         (lease_expires_at IS NOT NULL AND lease_expires_at < now())
         OR (
           lease_expires_at IS NULL
           AND COALESCE(heartbeat_at, updated_at) < now() - public.ai_job_lease_ttl(kind)
         )
       )
     RETURNING 1
  )
  SELECT count(*) INTO reaped FROM updated;
  RETURN reaped;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stuck_ai_jobs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reap_stuck_ai_jobs() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stuck_ai_jobs() TO service_role;

REVOKE ALL ON FUNCTION public.ai_job_claim_lease(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_job_heartbeat(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_job_claim_lease(uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_job_heartbeat(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_job_claim_lease(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_job_heartbeat(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_job_lease_ttl(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 20260901135346_fc721382-676d-418c-a559-f6cd94d5d101.sql
-- ---------------------------------------------------------------------------
-- ============ brain_reasoning_logs: integridade referencial ============
DELETE FROM public.brain_reasoning_logs WHERE brand_id IS NULL;
DELETE FROM public.brain_reasoning_logs r
  WHERE r.brand_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = r.brand_id);

UPDATE public.brain_reasoning_logs r SET client_id = NULL
  WHERE r.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = r.client_id);
UPDATE public.brain_reasoning_logs r SET user_id = NULL
  WHERE r.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.user_id);
UPDATE public.brain_reasoning_logs r SET conversation_id = NULL
  WHERE r.conversation_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.chat_conversations cc WHERE cc.id = r.conversation_id);

ALTER TABLE public.brain_reasoning_logs ALTER COLUMN brand_id SET NOT NULL;

ALTER TABLE public.brain_reasoning_logs
  ADD CONSTRAINT brain_reasoning_logs_brand_id_fkey
    FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE,
  ADD CONSTRAINT brain_reasoning_logs_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD CONSTRAINT brain_reasoning_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT brain_reasoning_logs_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS brain_reasoning_logs_brand_created_idx
  ON public.brain_reasoning_logs (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brain_reasoning_logs_client_idx
  ON public.brain_reasoning_logs (client_id);
CREATE INDEX IF NOT EXISTS brain_reasoning_logs_user_idx
  ON public.brain_reasoning_logs (user_id);
CREATE INDEX IF NOT EXISTS brain_reasoning_logs_conversation_idx
  ON public.brain_reasoning_logs (conversation_id);

-- ============ brain_learning_queue: vínculo de workspace ============
UPDATE public.brain_learning_queue q
   SET brand_id = e.brand_id
  FROM public.brain_events e
 WHERE e.id = q.event_id AND q.brand_id IS NULL AND e.brand_id IS NOT NULL;

DELETE FROM public.brain_learning_queue q
 WHERE q.brand_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = q.brand_id);

ALTER TABLE public.brain_learning_queue
  ADD CONSTRAINT brain_learning_queue_brand_id_fkey
    FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS brain_learning_queue_brand_status_idx
  ON public.brain_learning_queue (brand_id, status);

-- ============ brand_ai_usage: rastreabilidade do consumidor ============
ALTER TABLE public.brand_ai_usage
  ADD COLUMN IF NOT EXISTS actor_kind text NOT NULL DEFAULT 'user';

UPDATE public.brand_ai_usage SET actor_kind = 'system' WHERE actor_id IS NULL;

ALTER TABLE public.brand_ai_usage
  ADD CONSTRAINT brand_ai_usage_actor_kind_chk
    CHECK (
      actor_kind IN ('user', 'system')
      AND (actor_kind <> 'user' OR actor_id IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS brand_ai_usage_actor_idx
  ON public.brand_ai_usage (actor_id);
CREATE INDEX IF NOT EXISTS brand_ai_usage_brand_created_idx
  ON public.brand_ai_usage (brand_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 20260901141459_53698050-7107-4709-aae0-140c5f44b22c.sql
-- ---------------------------------------------------------------------------
-- 1) Vínculo de cliente na memória semântica
ALTER TABLE public.brain_embeddings
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

UPDATE public.brain_embeddings e
   SET client_id = ev.client_id
  FROM public.brain_events ev
 WHERE ev.id = e.event_id
   AND e.client_id IS DISTINCT FROM ev.client_id;

-- 2) Deduplicação por evento (mantém o mais recente)
DELETE FROM public.brain_embeddings e
 USING public.brain_embeddings keep
 WHERE e.event_id IS NOT NULL
   AND keep.event_id = e.event_id
   AND (keep.created_at, keep.id) > (e.created_at, e.id);

-- 3) Idempotência: um embedding por evento
CREATE UNIQUE INDEX IF NOT EXISTS brain_embeddings_event_uidx
  ON public.brain_embeddings (event_id)
  WHERE event_id IS NOT NULL;

-- 4) Sem registros pela metade
DELETE FROM public.brain_embeddings WHERE brand_id IS NULL OR embedding IS NULL;
ALTER TABLE public.brain_embeddings ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE public.brain_embeddings ALTER COLUMN embedding SET NOT NULL;

-- 5) Índice de escopo
CREATE INDEX IF NOT EXISTS brain_embeddings_client_idx
  ON public.brain_embeddings (client_id) WHERE client_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 20260902101515_71051622-72ef-4f98-a155-bf4269d43f57.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_ai_usage
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS error_kind text,
  ADD COLUMN IF NOT EXISTS step text,
  ADD COLUMN IF NOT EXISTS attempt integer;

COMMENT ON COLUMN public.brand_ai_usage.provider IS 'Provedor BYOK usado na tentativa (openai/gemini/groq/anthropic).';
COMMENT ON COLUMN public.brand_ai_usage.error_kind IS 'Classificacao da falha (provider_rate_limit, provider_unavailable, invalid_output, ...). NULL em sucesso.';
COMMENT ON COLUMN public.brand_ai_usage.step IS 'Etapa/pipeline que originou a chamada, para reconstruir a execucao.';
COMMENT ON COLUMN public.brand_ai_usage.attempt IS 'Numero da tentativa dentro da execucao.';

-- Falha sempre tem classificacao: impede que um erro vire registro indiagnosticavel.
ALTER TABLE public.brand_ai_usage DROP CONSTRAINT IF EXISTS brand_ai_usage_failure_kind_chk;
ALTER TABLE public.brand_ai_usage
  ADD CONSTRAINT brand_ai_usage_failure_kind_chk
  CHECK (success OR error_kind IS NOT NULL) NOT VALID;

CREATE INDEX IF NOT EXISTS brand_ai_usage_failures_idx
  ON public.brand_ai_usage (brand_id, created_at DESC)
  WHERE success = false;

-- ---------------------------------------------------------------------------
-- 20260902221704_7c33df53-3716-4ccb-8f34-cc2505508140.sql
-- ---------------------------------------------------------------------------
CREATE TABLE public.installation_meta_app (
  id boolean NOT NULL DEFAULT true PRIMARY KEY,
  app_type text NOT NULL DEFAULT 'unitos',
  app_id text,
  app_secret_ciphertext text,
  business_config_id text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installation_meta_app_singleton_chk CHECK (id),
  CONSTRAINT installation_meta_app_type_chk CHECK (app_type IN ('unitos', 'client'))
);

GRANT SELECT, UPDATE ON public.installation_meta_app TO authenticated;
GRANT ALL ON public.installation_meta_app TO service_role;

ALTER TABLE public.installation_meta_app ENABLE ROW LEVEL SECURITY;

CREATE POLICY "installation_meta_app_select_super_admin" ON public.installation_meta_app
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "installation_meta_app_update_super_admin" ON public.installation_meta_app
  FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER installation_meta_app_touch_updated_at
  BEFORE UPDATE ON public.installation_meta_app
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.installation_meta_app (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 20260903095115_98c1d1e2-d241-4468-a583-b17284d6b76b.sql
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  domain text,
  supabase_project_ref text,
  supabase_url text,
  git_repo_url text,
  deploy_project text,
  notes text,
  status text NOT NULL DEFAULT 'preparing',
  health text NOT NULL DEFAULT 'unknown',
  current_version text,
  available_version text,
  last_provisioned_at timestamptz,
  last_validated_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.installations TO authenticated;
GRANT ALL ON public.installations TO service_role;
ALTER TABLE public.installations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "installations_super_admin_all" ON public.installations
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.installation_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES public.installations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  summary text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS installation_operations_installation_idx
  ON public.installation_operations (installation_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.installation_operations TO authenticated;
GRANT ALL ON public.installation_operations TO service_role;
ALTER TABLE public.installation_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "installation_operations_super_admin_all" ON public.installation_operations
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER installations_touch_updated_at
  BEFORE UPDATE ON public.installations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 20260903100935_b5f869f9-fa0e-4528-9d96-0a567761bb9f.sql
-- ---------------------------------------------------------------------------
-- 1) Regra: workspace é singleton da instalação
CREATE OR REPLACE FUNCTION public.can_create_brand(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    -- singleton: só é possível criar o workspace quando a instalação não tem nenhum
    AND NOT EXISTS (SELECT 1 FROM public.brands)
    AND NOT EXISTS (
      SELECT 1 FROM public.client_members cm
      WHERE cm.user_id = _user_id
        AND cm.role = 'portal_client'
    );
$$;

-- 2) Barreira dura no banco: nunca mais de um workspace
CREATE OR REPLACE FUNCTION public.enforce_single_brand()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE id <> NEW.id) THEN
    RAISE EXCEPTION 'single_workspace_per_installation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_single_brand ON public.brands;
CREATE TRIGGER trg_enforce_single_brand
  BEFORE INSERT ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_brand();

-- 3) Novos usuários entram automaticamente no workspace único
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_full_name text;
  v_brand uuid;
BEGIN
  v_role := lower(coalesce(NEW.raw_user_meta_data->>'role', ''));
  IF v_role NOT IN ('admin', 'manager', 'user', 'super_admin', 'portal_client') THEN
    v_role := 'user';
  END IF;

  v_full_name := coalesce(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    split_part(coalesce(NEW.email, ''), '@', 1),
    'Usuário'
  );

  BEGIN
    INSERT INTO public.user_profiles (id, full_name, role)
    VALUES (NEW.id, v_full_name, CASE WHEN v_role = 'portal_client' THEN 'user' ELSE v_role END)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: falha ao criar perfil para %: %', NEW.id, SQLERRM;
  END;

  -- Workspace é singleton: vincula o novo usuário interno ao workspace único.
  IF v_role <> 'portal_client' THEN
    BEGIN
      SELECT id INTO v_brand FROM public.brands ORDER BY created_at LIMIT 1;
      IF v_brand IS NOT NULL THEN
        INSERT INTO public.brand_members (brand_id, user_id, role)
        VALUES (v_brand, NEW.id, CASE WHEN v_role = 'super_admin' THEN 'admin' ELSE v_role END::app_role)
        ON CONFLICT (brand_id, user_id) DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: falha ao vincular workspace para %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 20260903100958_fde300cc-e9a1-4b21-9ad3-a70fef538d47.sql
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.enforce_single_brand() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 20260903101302_e5687609-985c-470e-9008-bac927d5d5a8.sql
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_single_brand()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Rotinas internas (instalação/bootstrap e testes automatizados) rodam com a
  -- credencial de serviço e ficam fora da barreira; toda a aplicação (anon /
  -- authenticated) segue limitada a um único workspace por instalação.
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.brands WHERE id <> NEW.id) THEN
    RAISE EXCEPTION 'single_workspace_per_installation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_single_brand() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 20260903102213_d7c0c296-6013-4d3b-8161-1a2f42f40e78.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.installations
  ADD COLUMN IF NOT EXISTS health_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS health_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS active_operation_id uuid;

ALTER TABLE public.installation_operations
  ADD COLUMN IF NOT EXISTS steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS error_kind text,
  ADD COLUMN IF NOT EXISTS run_token_hash text,
  ADD COLUMN IF NOT EXISTS run_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_report_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS installation_operations_one_active
  ON public.installation_operations (installation_id)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS installation_operations_run_token_hash_idx
  ON public.installation_operations (run_token_hash)
  WHERE run_token_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 20260903121116_c61c382c-5188-46ad-848c-d5cae875c73d.sql
-- ---------------------------------------------------------------------------
-- Estado de primeira configuração da instalação (sem expor dado algum).
CREATE OR REPLACE FUNCTION public.installation_setup_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'needs_super_admin', NOT EXISTS (SELECT 1 FROM public.user_profiles),
    'has_workspace', EXISTS (SELECT 1 FROM public.brands)
  );
$$;

REVOKE ALL ON FUNCTION public.installation_setup_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.installation_setup_state() TO anon, authenticated, service_role;

-- Primeiro usuário da instalação = Super Admin + workspace único criado na hora.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_full_name text;
  v_brand uuid;
  v_is_first boolean;
  v_ws_name text;
  v_ws_slug text;
BEGIN
  v_role := lower(coalesce(NEW.raw_user_meta_data->>'role', ''));
  IF v_role NOT IN ('admin', 'manager', 'user', 'super_admin', 'portal_client') THEN
    v_role := 'user';
  END IF;

  -- Primeira configuração: nenhuma conta interna existe ainda nesta instalação.
  SELECT NOT EXISTS (SELECT 1 FROM public.user_profiles) INTO v_is_first;
  IF v_is_first AND v_role <> 'portal_client' THEN
    v_role := 'super_admin';
  END IF;

  v_full_name := coalesce(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    split_part(coalesce(NEW.email, ''), '@', 1),
    'Usuário'
  );

  BEGIN
    INSERT INTO public.user_profiles (id, full_name, role)
    VALUES (NEW.id, v_full_name, CASE WHEN v_role = 'portal_client' THEN 'user' ELSE v_role END)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: falha ao criar perfil para %: %', NEW.id, SQLERRM;
  END;

  IF v_role <> 'portal_client' THEN
    BEGIN
      SELECT id INTO v_brand FROM public.brands ORDER BY created_at LIMIT 1;

      -- Workspace é singleton: o primeiro Super Admin já recebe o workspace da instalação.
      IF v_brand IS NULL AND v_is_first THEN
        v_ws_name := coalesce(
          NULLIF(trim(NEW.raw_user_meta_data->>'workspace_name'), ''),
          'Workspace'
        );
        v_ws_slug := regexp_replace(lower(v_ws_name), '[^a-z0-9]+', '-', 'g');
        v_ws_slug := NULLIF(trim(both '-' from v_ws_slug), '');
        v_ws_slug := coalesce(v_ws_slug, 'workspace') || '-' || substr(NEW.id::text, 1, 8);

        INSERT INTO public.brands (name, slug, created_by)
        VALUES (left(v_ws_name, 80), v_ws_slug, NEW.id)
        RETURNING id INTO v_brand;
      END IF;

      IF v_brand IS NOT NULL THEN
        INSERT INTO public.brand_members (brand_id, user_id, role)
        VALUES (v_brand, NEW.id, CASE WHEN v_role = 'super_admin' THEN 'admin' ELSE v_role END::app_role)
        ON CONFLICT (brand_id, user_id) DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: falha ao vincular workspace para %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 20260904003109_e946ede4-70ec-4dcc-ab46-fcff03508f2a.sql
-- ---------------------------------------------------------------------------
-- 1) Comentários de projeto e job
CREATE TABLE public.work_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.project_jobs(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_comments_project_idx ON public.work_comments (project_id, created_at);
CREATE INDEX work_comments_job_idx ON public.work_comments (job_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_comments TO authenticated;
GRANT ALL ON public.work_comments TO service_role;
ALTER TABLE public.work_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_comments_select" ON public.work_comments
  FOR SELECT TO authenticated
  USING (public.can_access_project(project_id, auth.uid()));
CREATE POLICY "work_comments_insert" ON public.work_comments
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.can_access_project(project_id, auth.uid()));
CREATE POLICY "work_comments_update_own" ON public.work_comments
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid() AND public.can_access_project(project_id, auth.uid()))
  WITH CHECK (author_id = auth.uid());
CREATE POLICY "work_comments_delete_own" ON public.work_comments
  FOR DELETE TO authenticated
  USING (author_id = auth.uid() AND public.can_access_project(project_id, auth.uid()));

CREATE TRIGGER work_comments_touch
  BEFORE UPDATE ON public.work_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Envolvidos no projeto
CREATE TABLE public.project_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX project_participants_project_idx ON public.project_participants (project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_participants TO authenticated;
GRANT ALL ON public.project_participants TO service_role;
ALTER TABLE public.project_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_participants_select" ON public.project_participants
  FOR SELECT TO authenticated
  USING (public.can_access_project(project_id, auth.uid()));
CREATE POLICY "project_participants_insert" ON public.project_participants
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_project(project_id, auth.uid()));
CREATE POLICY "project_participants_delete" ON public.project_participants
  FOR DELETE TO authenticated
  USING (public.can_access_project(project_id, auth.uid()));

-- 3) Status cadastráveis por workspace
CREATE TABLE public.work_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('project', 'job', 'task')),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#8b5cf6',
  position integer NOT NULL DEFAULT 0,
  is_done boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_statuses_brand_scope_idx ON public.work_statuses (brand_id, scope, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_statuses TO authenticated;
GRANT ALL ON public.work_statuses TO service_role;
ALTER TABLE public.work_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_statuses_select" ON public.work_statuses
  FOR SELECT TO authenticated
  USING (public.brand_member_role(auth.uid(), brand_id) IS NOT NULL);
CREATE POLICY "work_statuses_write" ON public.work_statuses
  FOR ALL TO authenticated
  USING (public.brand_member_role(auth.uid(), brand_id) IN ('owner', 'admin'))
  WITH CHECK (public.brand_member_role(auth.uid(), brand_id) IN ('owner', 'admin'));

CREATE TRIGGER work_statuses_touch
  BEFORE UPDATE ON public.work_statuses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Campos adicionais em jobs, projetos e tarefas
ALTER TABLE public.project_jobs
  ADD COLUMN IF NOT EXISTS assignee_id uuid,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS due_at date,
  ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES public.work_statuses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS done_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES public.work_statuses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS done_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES public.work_statuses(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 20260904020708_29c957ce-462d-471e-8ce0-63fb81b6756f.sql
-- ---------------------------------------------------------------------------
CREATE TABLE public.work_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.project_jobs(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES public.monthly_plan_topics(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text,
  source text NOT NULL DEFAULT 'link',
  created_by uuid,
  created_by_client boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_links_url_scheme CHECK (url ~* '^https?://.{3,}$' AND length(url) <= 2000),
  CONSTRAINT work_links_single_target CHECK (
    (CASE WHEN project_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN job_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN task_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN post_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN topic_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);

CREATE INDEX work_links_project_idx ON public.work_links (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX work_links_job_idx ON public.work_links (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX work_links_task_idx ON public.work_links (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX work_links_post_idx ON public.work_links (post_id) WHERE post_id IS NOT NULL;
CREATE INDEX work_links_topic_idx ON public.work_links (topic_id) WHERE topic_id IS NOT NULL;
CREATE INDEX work_links_brand_idx ON public.work_links (brand_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_links TO authenticated;
GRANT ALL ON public.work_links TO service_role;

ALTER TABLE public.work_links ENABLE ROW LEVEL SECURITY;

-- Membros do workspace: escopo herdado do cliente (owner/admin cobrem o workspace;
-- manager/user só clientes atribuídos). Links sem cliente exigem membership no brand.
CREATE POLICY "work_links_select_members" ON public.work_links
  FOR SELECT TO authenticated
  USING (
    (client_id IS NOT NULL AND public.can_access_client(client_id, auth.uid()))
    OR (client_id IS NULL AND public.brand_member_role(auth.uid(), brand_id) IS NOT NULL)
    OR (client_id IS NOT NULL AND public.is_portal_client_of(client_id, auth.uid()))
  );

CREATE POLICY "work_links_insert_members" ON public.work_links
  FOR INSERT TO authenticated
  WITH CHECK (
    (client_id IS NOT NULL AND public.can_access_client(client_id, auth.uid()))
    OR (client_id IS NULL AND public.brand_member_role(auth.uid(), brand_id) IS NOT NULL)
    OR (client_id IS NOT NULL AND public.is_portal_client_of(client_id, auth.uid()) AND created_by_client)
  );

CREATE POLICY "work_links_update_members" ON public.work_links
  FOR UPDATE TO authenticated
  USING (
    (client_id IS NOT NULL AND public.can_access_client(client_id, auth.uid()))
    OR (client_id IS NULL AND public.brand_member_role(auth.uid(), brand_id) IS NOT NULL)
  )
  WITH CHECK (
    (client_id IS NOT NULL AND public.can_access_client(client_id, auth.uid()))
    OR (client_id IS NULL AND public.brand_member_role(auth.uid(), brand_id) IS NOT NULL)
  );

-- Agência apaga qualquer link do seu escopo; cliente do portal apaga só o que ele enviou.
CREATE POLICY "work_links_delete_members" ON public.work_links
  FOR DELETE TO authenticated
  USING (
    (client_id IS NOT NULL AND public.can_access_client(client_id, auth.uid()))
    OR (client_id IS NULL AND public.brand_member_role(auth.uid(), brand_id) IS NOT NULL)
    OR (
      client_id IS NOT NULL
      AND public.is_portal_client_of(client_id, auth.uid())
      AND created_by_client
      AND created_by = auth.uid()
    )
  );

CREATE TRIGGER work_links_touch_updated_at
  BEFORE UPDATE ON public.work_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 20260904115915_6e08f179-be62-4672-b2e3-f11228737de8.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.installations
  ADD COLUMN IF NOT EXISTS pinned_commit_sha text,
  ADD COLUMN IF NOT EXISTS pinned_release text,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS pinned_by uuid;

-- ---------------------------------------------------------------------------
-- 20260904125113_2795b058-5c51-4688-a3a4-38d30dc022c3.sql
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_client_document_ai(_brand_id uuid, _client_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _touched integer := 0;
  _n integer := 0;
BEGIN
  IF _brand_id IS NULL OR _client_id IS NULL THEN
    RETURN 0;
  END IF;
  IF NOT public.can_access_client(_client_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH latest AS (
    SELECT r.document_id, r.status, r.error,
           row_number() OVER (PARTITION BY r.document_id ORDER BY r.created_at DESC) AS rn
      FROM public.briefing_import_runs r
     WHERE r.brand_id = _brand_id
       AND r.client_id = _client_id
       AND r.document_id IS NOT NULL
  ), upd AS (
    UPDATE public.client_documents d
       SET ai_status = 'failed',
           ai_error = COALESCE(NULLIF(l.error, ''), 'A leitura nao foi concluida. Tente analisar novamente.'),
           updated_at = now()
      FROM latest l
     WHERE l.rn = 1
       AND l.document_id = d.id
       AND d.brand_id = _brand_id
       AND d.client_id = _client_id
       AND d.ai_status IN ('queued', 'running')
       AND l.status IN ('failed', 'expired', 'cancelled')
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM upd;
  _touched := _touched + _n;

  WITH upd2 AS (
    UPDATE public.client_documents d
       SET ai_status = 'failed',
           ai_error = COALESCE(NULLIF(d.ai_error, ''), 'A leitura ficou parada e foi encerrada. Clique em Reanalisar para tentar de novo.'),
           updated_at = now()
     WHERE d.brand_id = _brand_id
       AND d.client_id = _client_id
       AND d.ai_status IN ('queued', 'running')
       AND d.updated_at < now() - interval '20 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM public.briefing_import_runs r
          WHERE r.document_id = d.id
            AND r.status IN ('queued', 'running')
       )
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM upd2;
  _touched := _touched + _n;

  RETURN _touched;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_client_document_ai(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_client_document_ai(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_client_document_ai(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.briefing_import_reap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _requeued integer := 0;
  _expired integer := 0;
  _docs integer := 0;
BEGIN
  WITH stalled AS (
    SELECT id FROM public.briefing_import_runs
     WHERE status = 'running'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < now()
       AND attempt + 1 < max_attempts
       AND (deadline_at IS NULL OR deadline_at > now())
     LIMIT 50
  ), upd AS (
    UPDATE public.briefing_import_runs r
       SET status = 'queued',
           attempt = r.attempt + 1,
           lease_owner = NULL,
           lease_expires_at = NULL,
           resume_step = COALESCE(r.resume_step, r.current_step),
           error = NULL,
           error_kind = NULL,
           updated_at = now()
     WHERE r.id IN (SELECT id FROM stalled)
    RETURNING 1
  )
  SELECT count(*) INTO _requeued FROM upd;

  WITH dead AS (
    SELECT id FROM public.briefing_import_runs
     WHERE status IN ('queued','running')
       AND (
         (deadline_at IS NOT NULL AND deadline_at < now())
         OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
       )
     LIMIT 50
  ), upd2 AS (
    UPDATE public.briefing_import_runs r
       SET status = 'expired',
           lease_owner = NULL,
           lease_expires_at = NULL,
           finished_at = now(),
           error_kind = COALESCE(NULLIF(r.error_kind, ''), CASE WHEN NULLIF(r.error, '') IS NOT NULL THEN NULL ELSE 'stalled' END, 'stalled'),
           error = COALESCE(NULLIF(r.error, ''), 'Processamento interrompido antes de concluir. Tente novamente.'),
           updated_at = now()
     WHERE r.id IN (SELECT id FROM dead)
    RETURNING r.id, r.document_id, r.error
  ), docs AS (
    UPDATE public.client_documents d
       SET ai_status = 'failed',
           ai_error = COALESCE(NULLIF(u.error, ''), 'Processamento interrompido antes de concluir. Tente novamente.'),
           updated_at = now()
      FROM upd2 u
     WHERE u.document_id = d.id
       AND d.ai_status IN ('queued','running')
    RETURNING 1
  ), counted AS (
    SELECT (SELECT count(*) FROM upd2) AS runs, (SELECT count(*) FROM docs) AS synced
  )
  SELECT runs, synced INTO _expired, _docs FROM counted;

  -- Documentos presos sem nenhuma execucao viva (kick perdido, isolate morto).
  UPDATE public.client_documents d
     SET ai_status = 'failed',
         ai_error = COALESCE(NULLIF(d.ai_error, ''), 'A leitura ficou parada e foi encerrada. Clique em Reanalisar para tentar de novo.'),
         updated_at = now()
   WHERE d.ai_status IN ('queued','running')
     AND d.updated_at < now() - interval '20 minutes'
     AND NOT EXISTS (
       SELECT 1 FROM public.briefing_import_runs r
        WHERE r.document_id = d.id
          AND r.status IN ('queued','running')
     );

  RETURN jsonb_build_object('requeued', _requeued, 'expired', _expired, 'documents_synced', _docs);
END;
$$;

-- ---------------------------------------------------------------------------
-- 20260904142244_dba3410c-bae3-4b0a-b002-e179789cc6e6.sql
-- ---------------------------------------------------------------------------
CREATE TABLE public.installation_credentials (
  installation_id uuid PRIMARY KEY REFERENCES public.installations(id) ON DELETE CASCADE,
  supabase_management_token_ciphertext text,
  vercel_token_ciphertext text,
  vercel_team_id text,
  github_token_ciphertext text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.installation_credentials TO authenticated;
GRANT ALL ON public.installation_credentials TO service_role;

ALTER TABLE public.installation_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "installation_credentials_super_admin_all" ON public.installation_credentials
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER update_installation_credentials_updated_at
  BEFORE UPDATE ON public.installation_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 20260904204006_816ffe74-cd82-4215-8507-5ea4100ac791.sql
-- ---------------------------------------------------------------------------
-- =============================================================
-- Perfis de acesso + permissões por módulo (RBAC operacional)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.access_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_profiles TO authenticated;
GRANT ALL ON public.access_profiles TO service_role;

ALTER TABLE public.access_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "access_profiles_select_members" ON public.access_profiles;
CREATE POLICY "access_profiles_select_members" ON public.access_profiles
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = access_profiles.brand_id AND bm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "access_profiles_write_admin" ON public.access_profiles;
CREATE POLICY "access_profiles_write_admin" ON public.access_profiles
  FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.brand_member_role(auth.uid(), access_profiles.brand_id) IN ('owner','admin')
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.brand_member_role(auth.uid(), access_profiles.brand_id) IN ('owner','admin')
  );

CREATE OR REPLACE FUNCTION public.access_profiles_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_access_profiles_updated ON public.access_profiles;
CREATE TRIGGER trg_access_profiles_updated
  BEFORE UPDATE ON public.access_profiles
  FOR EACH ROW EXECUTE FUNCTION public.access_profiles_touch_updated_at();

-- Impede remover perfis do sistema
CREATE OR REPLACE FUNCTION public.access_profiles_block_system_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'system_profile_delete_blocked';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_access_profiles_block_system_delete ON public.access_profiles;
CREATE TRIGGER trg_access_profiles_block_system_delete
  BEFORE DELETE ON public.access_profiles
  FOR EACH ROW EXECUTE FUNCTION public.access_profiles_block_system_delete();

-- -------------------------------------------------------------
-- Colunas no membro do workspace
-- -------------------------------------------------------------
ALTER TABLE public.brand_members
  ADD COLUMN IF NOT EXISTS access_profile_id uuid REFERENCES public.access_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS module_permissions jsonb;

ALTER TABLE public.brand_invites
  ADD COLUMN IF NOT EXISTS access_profile_key text,
  ADD COLUMN IF NOT EXISTS module_permissions jsonb;

-- -------------------------------------------------------------
-- Seed dos perfis de sistema
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.access_profiles_system_defaults()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '[
    {"key":"atendimento","name":"Atendimento","permissions":{"clients":"full","briefing":"full","projects":"full","tasks":"full","planning":"full","content":"full","calendar":"view","approvals":"full","media_plans":"view","connections":"none","reports":"view","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"view"}},
    {"key":"criativo","name":"Criativo","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"own","content":"full","calendar":"view","approvals":"own","media_plans":"none","connections":"none","reports":"none","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"trafego","name":"Tráfego","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"view","content":"own","calendar":"view","approvals":"view","media_plans":"full","connections":"view","reports":"full","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"midia","name":"Mídia","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"view","content":"view","calendar":"view","approvals":"view","media_plans":"full","connections":"view","reports":"full","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"producao","name":"Produção","permissions":{"clients":"view","briefing":"view","projects":"own","tasks":"full","planning":"view","content":"own","calendar":"full","approvals":"own","media_plans":"none","connections":"none","reports":"view","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"financeiro","name":"Financeiro","permissions":{"clients":"view","briefing":"none","projects":"view","tasks":"view","planning":"view","content":"none","calendar":"view","approvals":"none","media_plans":"view","connections":"none","reports":"full","users":"none","settings":"none","ai":"none","brain":"none","chat":"view","portal":"none"}},
    {"key":"total","name":"Total","permissions":{"clients":"full","briefing":"full","projects":"full","tasks":"full","planning":"full","content":"full","calendar":"full","approvals":"full","media_plans":"full","connections":"full","reports":"full","users":"full","settings":"full","ai":"full","brain":"full","chat":"full","portal":"full"}}
  ]'::jsonb;
$$;

CREATE OR REPLACE FUNCTION public.seed_access_profiles(_brand_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item jsonb;
  n integer := 0;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(public.access_profiles_system_defaults())
  LOOP
    INSERT INTO public.access_profiles (brand_id, key, name, is_system, permissions)
    VALUES (_brand_id, item->>'key', item->>'name', true, item->'permissions')
    ON CONFLICT (brand_id, key) DO UPDATE
      SET name = CASE WHEN public.access_profiles.is_system THEN EXCLUDED.name ELSE public.access_profiles.name END;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_access_profiles_for_new_brand()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.seed_access_profiles(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brands_seed_access_profiles ON public.brands;
CREATE TRIGGER trg_brands_seed_access_profiles
  AFTER INSERT ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.seed_access_profiles_for_new_brand();

DO $$
DECLARE b record;
BEGIN
  FOR b IN SELECT id FROM public.brands LOOP
    PERFORM public.seed_access_profiles(b.id);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- Resolução efetiva das permissões por módulo
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_module_permissions(_user_id uuid, _brand_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_profile jsonb := '{}'::jsonb;
  v_override jsonb := '{}'::jsonb;
  v_total jsonb;
BEGIN
  IF _user_id IS NULL OR _brand_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT (public.access_profiles_system_defaults() -> 6) -> 'permissions' INTO v_total;

  IF public.is_super_admin(_user_id) THEN
    RETURN v_total;
  END IF;

  SELECT lower(bm.role),
         COALESCE(ap.permissions, '{}'::jsonb),
         COALESCE(bm.module_permissions, '{}'::jsonb)
    INTO v_role, v_profile, v_override
    FROM public.brand_members bm
    LEFT JOIN public.access_profiles ap ON ap.id = bm.access_profile_id
   WHERE bm.brand_id = _brand_id AND bm.user_id = _user_id;

  IF v_role IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  IF v_role IN ('owner','admin','manager') THEN
    RETURN v_total;
  END IF;

  RETURN v_profile || v_override;
END;
$$;

CREATE OR REPLACE FUNCTION public.module_level_rank(_level text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(COALESCE(_level,'none'))
    WHEN 'full' THEN 3
    WHEN 'own' THEN 2
    WHEN 'view' THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_module_access(
  _user_id uuid, _brand_id uuid, _module text, _min_level text DEFAULT 'view'
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.module_level_rank(
           public.effective_module_permissions(_user_id, _brand_id) ->> _module
         ) >= public.module_level_rank(_min_level);
$$;

REVOKE ALL ON FUNCTION public.seed_access_profiles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_access_profiles(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.effective_module_permissions(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_module_access(uuid, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.module_level_rank(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.access_profiles_system_defaults() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 20260904204218_1dbeeacc-a77f-4811-83bd-7be593358210.sql
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.access_profiles_system_defaults()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT '[
    {"key":"atendimento","name":"Atendimento","permissions":{"clients":"full","briefing":"full","projects":"full","tasks":"full","planning":"full","content":"full","calendar":"view","approvals":"full","media_plans":"view","connections":"none","reports":"view","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"view"}},
    {"key":"criativo","name":"Criativo","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"own","content":"full","calendar":"view","approvals":"own","media_plans":"none","connections":"none","reports":"none","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"trafego","name":"Tráfego","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"view","content":"own","calendar":"view","approvals":"view","media_plans":"full","connections":"view","reports":"full","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"midia","name":"Mídia","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"view","content":"view","calendar":"view","approvals":"view","media_plans":"full","connections":"view","reports":"full","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"producao","name":"Produção","permissions":{"clients":"view","briefing":"view","projects":"own","tasks":"full","planning":"view","content":"own","calendar":"full","approvals":"own","media_plans":"none","connections":"none","reports":"view","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"financeiro","name":"Financeiro","permissions":{"clients":"view","briefing":"none","projects":"view","tasks":"view","planning":"view","content":"none","calendar":"view","approvals":"none","media_plans":"view","connections":"none","reports":"full","users":"none","settings":"none","ai":"none","brain":"none","chat":"view","portal":"none"}},
    {"key":"total","name":"Total","permissions":{"clients":"full","briefing":"full","projects":"full","tasks":"full","planning":"full","content":"full","calendar":"full","approvals":"full","media_plans":"full","connections":"full","reports":"full","users":"full","settings":"full","ai":"full","brain":"full","chat":"full","portal":"full"}}
  ]'::jsonb;
$$;

CREATE OR REPLACE FUNCTION public.module_level_rank(_level text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(COALESCE(_level,'none'))
    WHEN 'full' THEN 3
    WHEN 'own' THEN 2
    WHEN 'view' THEN 1
    ELSE 0
  END;
$$;

-- ---------------------------------------------------------------------------
-- 20260904205402_b52283f7-981d-434f-99b0-67d26759dd0e.sql
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_module_permissions(_user_id uuid, _brand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_profile jsonb := '{}'::jsonb;
  v_override jsonb := '{}'::jsonb;
  v_total jsonb;
BEGIN
  IF _user_id IS NULL OR _brand_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT (public.access_profiles_system_defaults() -> 6) -> 'permissions' INTO v_total;

  IF public.is_super_admin(_user_id) THEN
    RETURN v_total;
  END IF;

  SELECT lower(bm.role::text),
         COALESCE(ap.permissions, '{}'::jsonb),
         COALESCE(bm.module_permissions, '{}'::jsonb)
    INTO v_role, v_profile, v_override
    FROM public.brand_members bm
    LEFT JOIN public.access_profiles ap ON ap.id = bm.access_profile_id
   WHERE bm.brand_id = _brand_id AND bm.user_id = _user_id;

  IF v_role IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  IF v_role IN ('owner','admin','manager') THEN
    RETURN v_total;
  END IF;

  RETURN v_profile || v_override;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 20260905131425_0f1a6890-11c3-4fa8-ade5-3eceb0d8e84e.sql
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_portal_access (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  permissions jsonb NOT NULL DEFAULT '{"approvals":"interact","pauta":"interact","calendar":"view","briefing":"interact","files":"view","brand":"view"}'::jsonb,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_portal_access TO authenticated;
GRANT ALL ON public.client_portal_access TO service_role;

ALTER TABLE public.client_portal_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cpa_select ON public.client_portal_access;
CREATE POLICY cpa_select ON public.client_portal_access
  FOR SELECT TO authenticated
  USING (
    public.can_access_client(client_id, auth.uid())
    OR public.is_portal_client_of(client_id, auth.uid())
  );

DROP POLICY IF EXISTS cpa_write ON public.client_portal_access;
CREATE POLICY cpa_write ON public.client_portal_access
  FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (public.is_brand_admin_level(brand_id, auth.uid()) AND public.can_access_client(client_id, auth.uid()))
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (public.is_brand_admin_level(brand_id, auth.uid()) AND public.can_access_client(client_id, auth.uid()))
  );

CREATE OR REPLACE FUNCTION public.client_portal_access_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_portal_access_touch ON public.client_portal_access;
CREATE TRIGGER trg_client_portal_access_touch
  BEFORE UPDATE ON public.client_portal_access
  FOR EACH ROW EXECUTE FUNCTION public.client_portal_access_touch();

-- Permissões efetivas do portal, lidas tanto pela agência quanto pelo cliente final.
CREATE OR REPLACE FUNCTION public.portal_permissions(_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _default jsonb := '{"approvals":"interact","pauta":"interact","calendar":"view","briefing":"interact","files":"view","brand":"view"}'::jsonb;
  _perms jsonb;
BEGIN
  IF NOT (
    public.can_access_client(_client_id, auth.uid())
    OR public.is_portal_client_of(_client_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'client_not_allowed';
  END IF;

  SELECT permissions INTO _perms FROM public.client_portal_access WHERE client_id = _client_id;
  RETURN _default || COALESCE(_perms, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_permissions(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 20260905134315_fe6d8235-dc34-4e9e-8596-f61b4681a0a7.sql
-- ---------------------------------------------------------------------------
-- =========================================================
-- Portal do cliente: pedidos, conversa de aprovação, prazos
-- =========================================================

CREATE TABLE IF NOT EXISTS public.client_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  desired_due_at timestamptz,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','info_needed','accepted','in_production','done','rejected','cancelled')),
  owner_user_id uuid,
  created_by uuid,
  created_by_name text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_requests_client_idx ON public.client_requests (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_requests_brand_idx ON public.client_requests (brand_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_requests TO authenticated;
GRANT ALL ON public.client_requests TO service_role;
ALTER TABLE public.client_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_requests_select" ON public.client_requests;
CREATE POLICY "client_requests_select" ON public.client_requests
  FOR SELECT TO authenticated
  USING (
    public.is_portal_client_of(client_id, auth.uid())
    OR public.can_access_client(client_id, auth.uid())
  );

DROP POLICY IF EXISTS "client_requests_insert" ON public.client_requests;
CREATE POLICY "client_requests_insert" ON public.client_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_portal_client_of(client_id, auth.uid())
    OR public.can_access_client(client_id, auth.uid())
  );

DROP POLICY IF EXISTS "client_requests_update" ON public.client_requests;
CREATE POLICY "client_requests_update" ON public.client_requests
  FOR UPDATE TO authenticated
  USING (
    public.can_access_client(client_id, auth.uid())
    OR (
      public.is_portal_client_of(client_id, auth.uid())
      AND created_by = auth.uid()
      AND status IN ('submitted','info_needed')
    )
  )
  WITH CHECK (
    public.can_access_client(client_id, auth.uid())
    OR (
      public.is_portal_client_of(client_id, auth.uid())
      AND created_by = auth.uid()
      AND status IN ('submitted','info_needed','cancelled')
    )
  );

DROP POLICY IF EXISTS "client_requests_delete" ON public.client_requests;
CREATE POLICY "client_requests_delete" ON public.client_requests
  FOR DELETE TO authenticated
  USING (public.can_access_client(client_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.client_requests_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS client_requests_touch_updated_at ON public.client_requests;
CREATE TRIGGER client_requests_touch_updated_at
  BEFORE UPDATE ON public.client_requests
  FOR EACH ROW EXECUTE FUNCTION public.client_requests_touch();

-- ---------------------------------------------------------
-- Histórico do pedido
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.client_requests(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_name text,
  actor_side text NOT NULL DEFAULT 'team' CHECK (actor_side IN ('client','team')),
  kind text NOT NULL CHECK (kind IN ('created','status','comment','info_needed','cancelled')),
  note text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_request_events_request_idx
  ON public.client_request_events (request_id, created_at);

GRANT SELECT, INSERT ON public.client_request_events TO authenticated;
GRANT ALL ON public.client_request_events TO service_role;
ALTER TABLE public.client_request_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_request_events_select" ON public.client_request_events;
CREATE POLICY "client_request_events_select" ON public.client_request_events
  FOR SELECT TO authenticated
  USING (
    public.is_portal_client_of(client_id, auth.uid())
    OR public.can_access_client(client_id, auth.uid())
  );

DROP POLICY IF EXISTS "client_request_events_insert" ON public.client_request_events;
CREATE POLICY "client_request_events_insert" ON public.client_request_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_portal_client_of(client_id, auth.uid())
    OR public.can_access_client(client_id, auth.uid())
  );

-- ---------------------------------------------------------
-- Conversa e marcação nos conteúdos em aprovação
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.post_client_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_user_id uuid,
  author_name text,
  author_side text NOT NULL DEFAULT 'client' CHECK (author_side IN ('client','team')),
  body text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  anchor jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_client_comments_post_idx
  ON public.post_client_comments (post_id, created_at);

GRANT SELECT, INSERT, UPDATE ON public.post_client_comments TO authenticated;
GRANT ALL ON public.post_client_comments TO service_role;
ALTER TABLE public.post_client_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_client_comments_select" ON public.post_client_comments;
CREATE POLICY "post_client_comments_select" ON public.post_client_comments
  FOR SELECT TO authenticated
  USING (
    public.is_portal_client_of(client_id, auth.uid())
    OR public.can_access_client(client_id, auth.uid())
  );

DROP POLICY IF EXISTS "post_client_comments_insert" ON public.post_client_comments;
CREATE POLICY "post_client_comments_insert" ON public.post_client_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_portal_client_of(client_id, auth.uid())
    OR public.can_access_client(client_id, auth.uid())
  );

DROP POLICY IF EXISTS "post_client_comments_update" ON public.post_client_comments;
CREATE POLICY "post_client_comments_update" ON public.post_client_comments
  FOR UPDATE TO authenticated
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- ---------------------------------------------------------
-- Prazo do cliente no conteúdo
-- ---------------------------------------------------------

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS client_due_at timestamptz;

-- ---------------------------------------------------------
-- Preferências de aviso do contato do portal
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.portal_notification_prefs (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  email_enabled boolean NOT NULL DEFAULT true,
  kinds jsonb NOT NULL DEFAULT '{"approvals":true,"deadlines":true,"requests":true,"comments":true}'::jsonb,
  daily_digest boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_id)
);

GRANT SELECT, INSERT, UPDATE ON public.portal_notification_prefs TO authenticated;
GRANT ALL ON public.portal_notification_prefs TO service_role;
ALTER TABLE public.portal_notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portal_notification_prefs_own" ON public.portal_notification_prefs;
CREATE POLICY "portal_notification_prefs_own" ON public.portal_notification_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.can_access_client(client_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.can_access_client(client_id, auth.uid()));

DROP TRIGGER IF EXISTS portal_notification_prefs_touch ON public.portal_notification_prefs;
CREATE TRIGGER portal_notification_prefs_touch
  BEFORE UPDATE ON public.portal_notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.client_requests_touch();

-- ---------------------------------------------------------------------------
-- 20260905192300_0f13e28b-c1a2-46b5-9c4e-08ada00b0b88.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS email text;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_email_lower_key
  ON public.user_profiles (lower(email)) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_profiles_email_lower_idx
  ON public.user_profiles (lower(email));

UPDATE public.user_profiles up
SET email = u.email
FROM auth.users u
WHERE u.id = up.id
  AND up.email IS DISTINCT FROM u.email;

CREATE OR REPLACE FUNCTION public.sync_user_profile_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_profiles SET email = NEW.email, updated_at = now()
  WHERE id = NEW.id AND email IS DISTINCT FROM NEW.email;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sync_user_profile_email: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_user_profile_email_trg ON auth.users;
CREATE TRIGGER sync_user_profile_email_trg
AFTER INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_user_profile_email();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_full_name text;
  v_brand uuid;
  v_is_first boolean;
  v_ws_name text;
  v_ws_slug text;
  v_is_test boolean;
BEGIN
  v_role := lower(coalesce(NEW.raw_user_meta_data->>'role', ''));
  IF v_role NOT IN ('admin', 'manager', 'user', 'super_admin', 'portal_client') THEN
    v_role := 'user';
  END IF;

  v_is_test := coalesce(NEW.email, '') ~* '@(unitos-tests\.dev|unitos-qa\.test)$';

  SELECT NOT EXISTS (SELECT 1 FROM public.user_profiles) INTO v_is_first;
  IF v_is_first AND v_role <> 'portal_client' AND NOT v_is_test THEN
    v_role := 'super_admin';
  END IF;

  v_full_name := NULLIF(trim(coalesce(NEW.raw_user_meta_data->>'full_name', '')), '');

  BEGIN
    INSERT INTO public.user_profiles (id, full_name, email, role)
    VALUES (
      NEW.id,
      v_full_name,
      NEW.email,
      CASE WHEN v_role = 'portal_client' THEN 'user' ELSE v_role END
    )
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: falha ao criar perfil para %: %', NEW.id, SQLERRM;
  END;

  IF v_role <> 'portal_client' AND NOT v_is_test THEN
    BEGIN
      SELECT id INTO v_brand FROM public.brands ORDER BY created_at LIMIT 1;

      IF v_brand IS NULL AND v_is_first THEN
        v_ws_name := coalesce(
          NULLIF(trim(NEW.raw_user_meta_data->>'workspace_name'), ''),
          'Workspace'
        );
        v_ws_slug := regexp_replace(lower(v_ws_name), '[^a-z0-9]+', '-', 'g');
        v_ws_slug := NULLIF(trim(both '-' from v_ws_slug), '');
        v_ws_slug := coalesce(v_ws_slug, 'workspace') || '-' || substr(NEW.id::text, 1, 8);

        INSERT INTO public.brands (name, slug, created_by)
        VALUES (left(v_ws_name, 80), v_ws_slug, NEW.id)
        RETURNING id INTO v_brand;
      END IF;

      IF v_brand IS NOT NULL THEN
        INSERT INTO public.brand_members (brand_id, user_id, role)
        VALUES (v_brand, NEW.id, CASE WHEN v_role = 'super_admin' THEN 'admin' ELSE v_role END::app_role)
        ON CONFLICT (brand_id, user_id) DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: falha ao vincular workspace para %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 20260905203700_d4177db3-7866-4546-aa76-d7e70f6df3ec.sql
-- ---------------------------------------------------------------------------
-- 1) Limpeza: contatos de portal que ganharam vínculo de equipe por engano.
DELETE FROM public.brand_members bm
WHERE EXISTS (
  SELECT 1 FROM public.client_members cm
  WHERE cm.user_id = bm.user_id AND cm.role = 'portal_client'
);

-- 2) Trava: contato de portal nunca entra em brand_members.
CREATE OR REPLACE FUNCTION public.block_portal_client_team_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.client_members cm
    WHERE cm.user_id = NEW.user_id AND cm.role = 'portal_client'
  ) THEN
    RAISE EXCEPTION 'portal_client_cannot_be_team_member: conta de contato do portal não pode ter vínculo de equipe'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_portal_client_team_link ON public.brand_members;
CREATE TRIGGER trg_block_portal_client_team_link
BEFORE INSERT OR UPDATE OF user_id ON public.brand_members
FOR EACH ROW EXECUTE FUNCTION public.block_portal_client_team_link();

-- 3) Trava simétrica: virar contato de portal remove/impede vínculo de equipe.
CREATE OR REPLACE FUNCTION public.enforce_portal_client_exclusivity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'portal_client' THEN
    DELETE FROM public.brand_members WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_portal_client_exclusivity ON public.client_members;
CREATE TRIGGER trg_enforce_portal_client_exclusivity
BEFORE INSERT OR UPDATE OF role, user_id ON public.client_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_portal_client_exclusivity();

-- ---------------------------------------------------------------------------
-- 20260905203731_cda91113-27e6-4fba-8ba1-5fbfd8d0c998.sql
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.block_portal_client_team_link() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_portal_client_exclusivity() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 20260905211211_a20d47e3-8d1e-4970-956e-ec6fad149d01.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_requests ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 20260905213133_4c1aa03a-8815-4cfe-8a20-bbefec7e6a22.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_requests
  ADD COLUMN IF NOT EXISTS last_team_reply_at timestamptz;

CREATE OR REPLACE FUNCTION public.portal_decide(_token text DEFAULT NULL::text, _post_id uuid DEFAULT NULL::uuid, _decision text DEFAULT NULL::text, _note text DEFAULT NULL::text, _identity text DEFAULT NULL::text, _client_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record; pst record; existing_id uuid; now_ts timestamptz := now();
  _kind public.notification_kind;
  _title text;
  _session_mode boolean := (_token IS NULL OR length(trim(_token)) = 0);
  _uid uuid;
  _who text;
  _dedupe text;
  _note_clean text := NULLIF(trim(COALESCE(_note, '')), '');
BEGIN
  IF _decision NOT IN ('approved','rejected','adjust','comment') THEN RAISE EXCEPTION 'bad_decision'; END IF;
  IF _post_id IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
  -- Pedido de ajuste sem explicacao nao e acionavel pela equipe.
  IF _decision = 'adjust' AND _note_clean IS NULL THEN RAISE EXCEPTION 'note_required'; END IF;
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);

  IF _session_mode THEN
    _uid := auth.uid();
    SELECT NULLIF(trim(COALESCE(_identity, up.full_name, '')), '') INTO _who
      FROM public.user_profiles up WHERE up.id = _uid;
    _who := COALESCE(_who, 'Cliente');
  ELSE
    IF _identity IS NULL OR length(trim(_identity)) = 0 THEN RAISE EXCEPTION 'identity_required'; END IF;
    _who := _identity;
  END IF;

  SELECT id, title, stage, published_at, deleted_at, visible_in_portal
    INTO pst
    FROM public.posts
   WHERE id = _post_id AND brand_id = s.brand_id AND client_id = s.client_id;

  IF pst.id IS NULL OR pst.deleted_at IS NOT NULL OR pst.visible_in_portal IS NOT TRUE THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  IF _decision <> 'comment'
     AND (pst.published_at IS NOT NULL OR pst.stage = 'published') THEN
    RAISE EXCEPTION 'post_already_published';
  END IF;

  IF _decision <> 'comment' THEN
    SELECT id INTO existing_id FROM public.post_approvals WHERE post_id = _post_id;
    IF existing_id IS NOT NULL THEN
      UPDATE public.post_approvals SET
        status = _decision::approval_status,
        -- Ajuste nunca sobrescreve a nota anterior com vazio.
        notes = CASE WHEN _decision = 'adjust' THEN COALESCE(_note_clean, notes) ELSE _note END,
        decided_at = now_ts, decided_by_name = _who,
        decided_by = _uid
      WHERE id = existing_id;
    ELSE
      INSERT INTO public.post_approvals(post_id, status, notes, decided_at, decided_by_name, decided_by)
      VALUES (_post_id, _decision::approval_status,
              CASE WHEN _decision = 'adjust' THEN _note_clean ELSE _note END,
              now_ts, _who, _uid);
    END IF;
    IF _decision = 'approved' THEN
      UPDATE public.posts SET approved_at = now_ts, review_status = 'approved' WHERE id = _post_id;
    ELSIF _decision = 'rejected' THEN
      UPDATE public.posts SET review_status = 'rejected' WHERE id = _post_id;
    ELSIF _decision = 'adjust' THEN
      UPDATE public.posts SET review_status = 'rework',
             rework_notes = COALESCE(_note_clean, rework_notes)
       WHERE id = _post_id;
    END IF;
  END IF;

  INSERT INTO public.activity_events(brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
  VALUES (s.brand_id, s.client_id, _uid, 'post', _post_id, 'portal_' || _decision,
          jsonb_build_object('note', COALESCE(_note,''), 'by', _who, 'title', pst.title,
                             'mode', CASE WHEN _session_mode THEN 'login' ELSE 'token' END));

  _kind := CASE WHEN _decision = 'comment' THEN 'mention'::public.notification_kind ELSE 'approval_decision'::public.notification_kind END;
  _title := CASE _decision
      WHEN 'approved' THEN 'Cliente aprovou um post'
      WHEN 'rejected' THEN 'Cliente rejeitou um post'
      WHEN 'adjust'   THEN 'Cliente pediu ajustes'
      ELSE 'Cliente comentou um post'
    END;

  _dedupe := 'portal_decision:' || _post_id::text || ':' || _decision;

  -- Destinatarios: responsavel pelo cliente, quem esta ligado ao cliente e
  -- TODOS os integrantes internos do espaco (owner, admin, manager, user...).
  -- Contatos do portal jamais recebem avisos internos.
  INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload, dedupe_key)
  SELECT DISTINCT t.user_id, s.brand_id, _kind, _title,
         _who || ': ' || COALESCE(pst.title, 'post'),
         '/customers/' || s.client_id::text,
         jsonb_build_object('source','portal_decision','post_id', _post_id,
                            'client_id', s.client_id, 'decision', _decision, 'by', _who),
         _dedupe
    FROM (
      SELECT c.owner_user_id AS user_id
        FROM public.clients c
       WHERE c.id = s.client_id AND c.owner_user_id IS NOT NULL
      UNION
      SELECT cm.user_id
        FROM public.client_members cm
       WHERE cm.client_id = s.client_id AND cm.role <> 'portal_client'
      UNION
      SELECT bm.user_id
        FROM public.brand_members bm
       WHERE bm.brand_id = s.brand_id
         AND bm.role::text <> 'portal_client'
    ) t
   WHERE t.user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.brand_members bm2
                  WHERE bm2.brand_id = s.brand_id AND bm2.user_id = t.user_id
                    AND bm2.role::text <> 'portal_client')
  ON CONFLICT (user_id, kind, dedupe_key)
    WHERE read_at IS NULL AND dedupe_key IS NOT NULL
    DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END $function$;

-- ---------------------------------------------------------------------------
-- 20260906203602_51eb3c43-3c51-4742-83bd-31d535f4790c.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.installation_credentials
  ADD COLUMN IF NOT EXISTS generated_secrets_ciphertext text;

COMMENT ON COLUMN public.installation_credentials.generated_secrets_ciphertext IS
  'JSON cifrado (AES-256-GCM) com os secrets exclusivos da instalação (CRON_SECRET, BRAND_CREDENTIALS_SECRET, META_STATE_SECRET, META_WEBHOOK_VERIFY_TOKEN). Gerados uma única vez e reutilizados: regerar invalida tokens já cifrados no destino.';

-- ---------------------------------------------------------------------------
-- 20260906210808_c9ee612d-0e7a-4161-8a2e-8a9ba4e25f88.sql
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_members
  ADD COLUMN IF NOT EXISTS hourly_cost_cents integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS task_time_entries_brand_started_idx
  ON public.task_time_entries (brand_id, started_at DESC);
CREATE INDEX IF NOT EXISTS task_time_entries_brand_user_started_idx
  ON public.task_time_entries (brand_id, user_id, started_at DESC);

CREATE OR REPLACE FUNCTION public.timesheet_report_entries(
  _brand_id uuid,
  _from timestamptz,
  _to timestamptz
)
RETURNS TABLE (
  entry_id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  seconds integer,
  is_rework boolean,
  source text,
  description text,
  user_id uuid,
  user_name text,
  user_email text,
  avatar_url text,
  hourly_cost_cents integer,
  task_id uuid,
  task_title text,
  task_estimated_minutes integer,
  project_id uuid,
  project_name text,
  client_id uuid,
  client_name text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _can_cost boolean;
BEGIN
  IF _uid IS NULL OR _brand_id IS NULL THEN
    RETURN;
  END IF;

  _role := public.app_access_role(_uid, _brand_id);

  IF _role IS NULL OR _role = 'client' THEN
    RETURN;
  END IF;

  _can_cost := _role IN ('super_admin', 'admin', 'manager');

  RETURN QUERY
  SELECT
    e.id,
    e.started_at,
    e.ended_at,
    COALESCE(e.seconds, COALESCE(e.minutes, 0) * 60)::int,
    COALESCE(e.is_rework, false),
    COALESCE(e.source, 'timer')::text,
    e.description,
    e.user_id,
    COALESCE(p.full_name, '')::text,
    COALESCE(p.email, '')::text,
    p.avatar_url,
    CASE WHEN _can_cost THEN COALESCE(bm.hourly_cost_cents, 0) ELSE 0 END::int,
    t.id,
    t.title,
    t.estimated_minutes,
    t.project_id,
    pr.name,
    t.client_id,
    c.name
  FROM public.task_time_entries e
  JOIN public.tasks t ON t.id = e.task_id
  LEFT JOIN public.projects pr ON pr.id = t.project_id
  LEFT JOIN public.clients c ON c.id = t.client_id
  LEFT JOIN public.user_profiles p ON p.id = e.user_id
  LEFT JOIN public.brand_members bm ON bm.brand_id = e.brand_id AND bm.user_id = e.user_id
  WHERE e.brand_id = _brand_id
    AND e.ended_at IS NOT NULL
    AND e.started_at >= _from
    AND e.started_at <= _to
    AND (
      _role IN ('super_admin', 'admin')
      OR (_role = 'manager' AND t.client_id IS NOT NULL AND public.can_access_client(t.client_id, _uid))
      OR e.user_id = _uid
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.timesheet_report_entries(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.timesheet_report_entries(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.timesheet_report_entries(uuid, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.set_member_hourly_cost(
  _brand_id uuid,
  _user_id uuid,
  _hourly_cost_cents integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  _role := public.app_access_role(_uid, _brand_id);
  IF _role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _hourly_cost_cents IS NULL OR _hourly_cost_cents < 0 THEN
    RAISE EXCEPTION 'invalid hourly cost';
  END IF;

  UPDATE public.brand_members
     SET hourly_cost_cents = _hourly_cost_cents
   WHERE brand_id = _brand_id AND user_id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found';
  END IF;

  RETURN _hourly_cost_cents;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_member_hourly_cost(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_hourly_cost(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_hourly_cost(uuid, uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 20260906214241_1d0ca3c8-8d8d-4d11-965b-d2afbe48f811.sql
-- ---------------------------------------------------------------------------
-- Regras por cliente: aprovação do cliente por etapa + política de limite de produção.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS approval_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scope_policy jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS approval_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scope_policy jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.clients.approval_policy IS
  'Etapas que exigem aprovação do cliente: {plan|content|schedule: "client"|"internal"}. Vazio herda do workspace; workspace vazio = comportamento histórico (cliente aprova).';
COMMENT ON COLUMN public.clients.scope_policy IS
  'Limite de produção: {"mode":"warn"|"block","applies":["ai","manual"]}. Vazio herda do workspace e depois de overage_policy.';

-- Autoridade: só Owner/Admin do workspace (ou Super Admin) muda essas regras.
CREATE OR REPLACE FUNCTION public.guard_client_policy_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _brand uuid;
  _role text;
BEGIN
  IF NEW.approval_policy IS DISTINCT FROM OLD.approval_policy
     OR NEW.scope_policy IS DISTINCT FROM OLD.scope_policy THEN
    -- Automação/serviço (sem usuário autenticado) segue permitido.
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;
    _brand := CASE WHEN TG_TABLE_NAME = 'brands' THEN NEW.id ELSE NEW.brand_id END;
    _role := public.app_access_role(auth.uid(), _brand);
    IF _role IS NULL OR _role NOT IN ('super_admin', 'admin') THEN
      RAISE EXCEPTION 'client_policy_forbidden';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_clients_policy_authority ON public.clients;
CREATE TRIGGER guard_clients_policy_authority
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_policy_authority();

DROP TRIGGER IF EXISTS guard_brands_policy_authority ON public.brands;
CREATE TRIGGER guard_brands_policy_authority
  BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_policy_authority();

-- ---------------------------------------------------------------------------
-- 20260906215417_069ec94b-7022-41ef-b35e-d5be7c064127.sql
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.guard_client_policy_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_client_policy_authority() FROM anon;
REVOKE ALL ON FUNCTION public.guard_client_policy_authority() FROM authenticated;

-- ---------------------------------------------------------------------------
-- 20260906220147_4a12801e-46fe-4f8f-a2dc-8e65e1b729fa.sql
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'team',
  event text NOT NULL DEFAULT 'sign_in',
  provider text,
  email text,
  user_agent text,
  device text,
  os text,
  browser text,
  ip_prefix text,
  city text,
  country text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_login_events TO authenticated;
GRANT ALL ON public.user_login_events TO service_role;

ALTER TABLE public.user_login_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace admins read login events"
ON public.user_login_events
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    brand_id IS NOT NULL
    AND lower(coalesce(public.app_access_role(auth.uid(), brand_id), '')) IN ('owner','admin','super_admin')
  )
);

CREATE INDEX user_login_events_brand_created_idx ON public.user_login_events (brand_id, created_at DESC);
CREATE INDEX user_login_events_user_created_idx ON public.user_login_events (user_id, created_at DESC);
CREATE INDEX user_login_events_email_idx ON public.user_login_events (lower(email));

-- ---------------------------------------------------------------------------
-- 20260906221742_07ff5201-ff79-4156-b01f-0f15f22162cc.sql
-- ---------------------------------------------------------------------------
-- =========================================================
-- Comunicador interno (Mensagens): equipe, clientes e portal
-- =========================================================

ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'message';

-- ---------- Conversas ----------
CREATE TABLE public.message_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('client', 'team_dm', 'project')),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  subject text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'shared_with_client')),
  created_by uuid,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Coerência estrutural: cada tipo de conversa exige seu vínculo.
  CONSTRAINT message_threads_scope_link CHECK (
    (scope = 'client'   AND client_id IS NOT NULL) OR
    (scope = 'project'  AND project_id IS NOT NULL) OR
    (scope = 'team_dm'  AND client_id IS NULL AND project_id IS NULL)
  ),
  -- Conversa interna nunca é compartilhada com o cliente.
  CONSTRAINT message_threads_visibility_scope CHECK (
    visibility = 'internal' OR scope = 'client'
  )
);

GRANT SELECT, INSERT, UPDATE ON public.message_threads TO authenticated;
GRANT ALL ON public.message_threads TO service_role;

CREATE INDEX message_threads_brand_recent_idx
  ON public.message_threads (brand_id, last_message_at DESC);
CREATE INDEX message_threads_client_recent_idx
  ON public.message_threads (client_id, last_message_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX message_threads_project_idx
  ON public.message_threads (project_id) WHERE project_id IS NOT NULL;

-- ---------- Participantes ----------
CREATE TABLE public.message_thread_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role_in_thread text NOT NULL DEFAULT 'team' CHECK (role_in_thread IN ('team', 'portal_client')),
  notify boolean NOT NULL DEFAULT true,
  last_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_thread_participants TO authenticated;
GRANT ALL ON public.message_thread_participants TO service_role;

CREATE INDEX message_thread_participants_user_idx
  ON public.message_thread_participants (user_id, thread_id);

-- ---------- Mensagens ----------
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  author_kind text NOT NULL DEFAULT 'team' CHECK (author_kind IN ('team', 'portal_client')),
  body text NOT NULL,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  mentions uuid[] NOT NULL DEFAULT '{}'::uuid[],
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

CREATE INDEX messages_thread_created_idx ON public.messages (thread_id, created_at DESC);

-- ---------- Guard de acesso (fail-closed, sem recursão) ----------
CREATE OR REPLACE FUNCTION public.is_message_thread_participant(_thread_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _thread_id IS NOT NULL AND _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.message_thread_participants p
     WHERE p.thread_id = _thread_id AND p.user_id = _user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_message_thread_participant(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.is_message_thread_participant(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_message_thread_participant(uuid, uuid) TO authenticated, service_role;

-- Escopo canônico de uma conversa. Cliente do portal só alcança conversa
-- compartilhada do próprio cliente e na qual foi incluído.
CREATE OR REPLACE FUNCTION public.can_access_message_thread(_thread_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.message_threads;
BEGIN
  IF _thread_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO t FROM public.message_threads WHERE id = _thread_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Contato do portal: só conversa compartilhada, do próprio cliente,
  -- e somente se estiver na lista de participantes.
  IF public.is_portal_client_of(t.client_id, _user_id) THEN
    RETURN t.scope = 'client'
       AND t.visibility = 'shared_with_client'
       AND public.is_message_thread_participant(_thread_id, _user_id);
  END IF;

  -- Equipe: precisa ser membro do workspace.
  IF NOT public.is_brand_member(t.brand_id, _user_id) THEN
    RETURN false;
  END IF;

  IF t.scope = 'client' THEN
    RETURN public.can_access_client(t.client_id, _user_id);
  ELSIF t.scope = 'project' THEN
    RETURN public.can_access_project(t.project_id, _user_id);
  END IF;

  -- Conversa direta: apenas os participantes.
  RETURN public.is_message_thread_participant(_thread_id, _user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_message_thread(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.can_access_message_thread(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_message_thread(uuid, uuid) TO authenticated, service_role;

-- ---------- RLS ----------
ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_thread_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "threads read in scope" ON public.message_threads
FOR SELECT TO authenticated
USING (public.can_access_message_thread(id, auth.uid()));

-- Somente equipe cria conversa, e dentro do próprio escopo.
CREATE POLICY "threads insert by team in scope" ON public.message_threads
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.is_brand_member(brand_id, auth.uid())
  AND (client_id IS NULL OR public.can_access_client(client_id, auth.uid()))
  AND (project_id IS NULL OR public.can_access_project(project_id, auth.uid()))
);

CREATE POLICY "threads update in scope" ON public.message_threads
FOR UPDATE TO authenticated
USING (public.can_access_message_thread(id, auth.uid()) AND public.is_brand_member(brand_id, auth.uid()))
WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

CREATE POLICY "thread participants read in scope" ON public.message_thread_participants
FOR SELECT TO authenticated
USING (public.can_access_message_thread(thread_id, auth.uid()));

-- Só equipe com acesso à conversa gerencia participantes.
CREATE POLICY "thread participants managed by team" ON public.message_thread_participants
FOR INSERT TO authenticated
WITH CHECK (
  public.can_access_message_thread(thread_id, auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.message_threads t
     WHERE t.id = thread_id AND public.is_brand_member(t.brand_id, auth.uid())
  )
);

CREATE POLICY "thread participants delete by team" ON public.message_thread_participants
FOR DELETE TO authenticated
USING (
  public.can_access_message_thread(thread_id, auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.message_threads t
     WHERE t.id = thread_id AND public.is_brand_member(t.brand_id, auth.uid())
  )
);

-- Cada pessoa atualiza a própria marcação de leitura; equipe ajusta a conversa.
CREATE POLICY "thread participants update self or team" ON public.message_thread_participants
FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  OR (
    public.can_access_message_thread(thread_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.message_threads t
       WHERE t.id = thread_id AND public.is_brand_member(t.brand_id, auth.uid())
    )
  )
)
WITH CHECK (public.can_access_message_thread(thread_id, auth.uid()));

CREATE POLICY "messages read in scope" ON public.messages
FOR SELECT TO authenticated
USING (public.can_access_message_thread(thread_id, auth.uid()));

CREATE POLICY "messages insert by participant" ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND public.can_access_message_thread(thread_id, auth.uid())
  AND public.is_message_thread_participant(thread_id, auth.uid())
);

-- Histórico é preservado: só marcar a própria mensagem como removida.
CREATE POLICY "messages soft delete by author" ON public.messages
FOR UPDATE TO authenticated
USING (author_id = auth.uid() AND public.can_access_message_thread(thread_id, auth.uid()))
WITH CHECK (author_id = auth.uid());

-- ---------- Atualização automática da conversa ----------
CREATE OR REPLACE FUNCTION public.bump_message_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.message_threads
     SET last_message_at = NEW.created_at,
         last_message_preview = left(NEW.body, 280),
         updated_at = now()
   WHERE id = NEW.thread_id;

  -- Autor já leu o que acabou de escrever.
  UPDATE public.message_thread_participants
     SET last_read_at = NEW.created_at
   WHERE thread_id = NEW.thread_id AND user_id = NEW.author_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_bump_thread
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.bump_message_thread();

CREATE TRIGGER message_threads_touch_updated_at
BEFORE UPDATE ON public.message_threads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Tempo real ----------
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_threads REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_threads;

-- ---------------------------------------------------------------------------
-- 20260906221905_59be4d6a-bc51-45f0-9d04-535d0265762a.sql
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bump_message_thread() FROM public;
REVOKE ALL ON FUNCTION public.bump_message_thread() FROM anon;
REVOKE ALL ON FUNCTION public.bump_message_thread() FROM authenticated;

-- ---------------------------------------------------------------------------
-- 20260906222307_f549ee09-e473-4116-afd3-2c13eb350d5a.sql
-- ---------------------------------------------------------------------------
-- Não lidas por conversa (só conversas em que a pessoa participa e pode ver).
CREATE OR REPLACE FUNCTION public.message_unread_counts(_brand_id uuid)
RETURNS TABLE(thread_id uuid, unread integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.thread_id,
         COUNT(m.id)::int AS unread
    FROM public.message_thread_participants p
    JOIN public.message_threads t ON t.id = p.thread_id
    LEFT JOIN public.messages m
           ON m.thread_id = p.thread_id
          AND m.author_id <> p.user_id
          AND m.removed_at IS NULL
          AND m.created_at > COALESCE(p.last_read_at, 'epoch'::timestamptz)
   WHERE p.user_id = auth.uid()
     AND (_brand_id IS NULL OR t.brand_id = _brand_id)
     AND t.archived_at IS NULL
     AND public.can_access_message_thread(p.thread_id, auth.uid())
   GROUP BY p.thread_id;
$$;

REVOKE ALL ON FUNCTION public.message_unread_counts(uuid) FROM public;
REVOKE ALL ON FUNCTION public.message_unread_counts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.message_unread_counts(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.message_unread_total(_brand_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(unread), 0)::int FROM public.message_unread_counts(_brand_id);
$$;

REVOKE ALL ON FUNCTION public.message_unread_total(uuid) FROM public;
REVOKE ALL ON FUNCTION public.message_unread_total(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.message_unread_total(uuid) TO authenticated, service_role;
