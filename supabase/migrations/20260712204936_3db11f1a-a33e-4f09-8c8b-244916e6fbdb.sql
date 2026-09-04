
-- Global AI jobs registry: durable background processing state for any AI generation
CREATE TABLE public.ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL, -- e.g. 'copilot_draft', 'one_click_pipeline', 'agent_run'
  title text NOT NULL,
  subtitle text,
  status text NOT NULL DEFAULT 'queued', -- queued | running | succeeded | failed | cancelled
  progress smallint NOT NULL DEFAULT 0, -- 0..100
  step_label text,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  target_route text, -- optional deep-link when finished
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_jobs_user_status_idx ON public.ai_jobs (user_id, status, created_at DESC);
CREATE INDEX ai_jobs_brand_idx ON public.ai_jobs (brand_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_jobs TO authenticated;
GRANT ALL ON public.ai_jobs TO service_role;

ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;

-- Members of the brand can see jobs for their brand
CREATE POLICY "brand members read ai_jobs"
  ON public.ai_jobs FOR SELECT TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()));

-- Users can create their own jobs within their brand
CREATE POLICY "brand members create ai_jobs"
  ON public.ai_jobs FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_brand_member(brand_id, auth.uid())
  );

-- Owner of the job can update or delete
CREATE POLICY "owner updates ai_jobs"
  ON public.ai_jobs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner deletes ai_jobs"
  ON public.ai_jobs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_ai_jobs_updated_at
  BEFORE UPDATE ON public.ai_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_jobs;
ALTER TABLE public.ai_jobs REPLICA IDENTITY FULL;
