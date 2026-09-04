ALTER TABLE public.monthly_plan_topics
  ADD COLUMN IF NOT EXISTS target_audience text,
  ADD COLUMN IF NOT EXISTS rationale text;

ALTER TABLE public.monthly_plans
  ADD COLUMN IF NOT EXISTS context_sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS monthly_plans_project_id_idx ON public.monthly_plans (project_id);