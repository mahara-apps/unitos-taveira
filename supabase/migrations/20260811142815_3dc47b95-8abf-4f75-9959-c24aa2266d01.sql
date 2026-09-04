ALTER TABLE public.monthly_plans DROP CONSTRAINT IF EXISTS monthly_plans_status_check;
ALTER TABLE public.monthly_plans ADD CONSTRAINT monthly_plans_status_check CHECK (status = ANY (ARRAY['draft','pending_client','client_approved','changes_requested','approved','archived']));
ALTER TABLE public.monthly_plans
  ADD COLUMN IF NOT EXISTS internal_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS internal_approved_by uuid,
  ADD COLUMN IF NOT EXISTS client_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_feedback text;

ALTER TABLE public.monthly_plan_topics
  ADD COLUMN IF NOT EXISTS previous_title text,
  ADD COLUMN IF NOT EXISTS previous_angle text;

CREATE TABLE IF NOT EXISTS public.monthly_plan_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_plan_id uuid NOT NULL REFERENCES public.monthly_plans(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_plan_tokens TO authenticated;
GRANT ALL ON public.monthly_plan_tokens TO service_role;

ALTER TABLE public.monthly_plan_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brand members manage monthly plan tokens"
ON public.monthly_plan_tokens FOR ALL TO authenticated
USING (public.is_brand_member(brand_id, auth.uid()))
WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

CREATE INDEX IF NOT EXISTS monthly_plan_tokens_plan_idx ON public.monthly_plan_tokens (monthly_plan_id);

CREATE TRIGGER update_monthly_plan_tokens_updated_at
BEFORE UPDATE ON public.monthly_plan_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();