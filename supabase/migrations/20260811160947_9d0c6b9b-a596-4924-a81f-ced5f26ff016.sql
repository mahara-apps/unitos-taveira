ALTER TABLE public.monthly_plans
  ADD COLUMN IF NOT EXISTS client_decision_mode text;

ALTER TABLE public.monthly_plan_topics
  ADD COLUMN IF NOT EXISTS client_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS client_comment text,
  ADD COLUMN IF NOT EXISTS client_decision_at timestamptz;