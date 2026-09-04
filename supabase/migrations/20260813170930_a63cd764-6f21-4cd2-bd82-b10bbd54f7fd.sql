ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS monthly_plan_id uuid REFERENCES public.monthly_plans(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS projects_monthly_plan_id_key
  ON public.projects (monthly_plan_id)
  WHERE monthly_plan_id IS NOT NULL;