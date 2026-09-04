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