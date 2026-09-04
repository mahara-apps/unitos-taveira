CREATE TABLE public.plan_overage_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  channel text NOT NULL,
  period_month date NOT NULL,
  quota integer NOT NULL DEFAULT 0,
  requested integer NOT NULL DEFAULT 0,
  overage integer NOT NULL DEFAULT 0,
  justification text,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_overage_requests TO authenticated;
GRANT ALL ON public.plan_overage_requests TO service_role;

ALTER TABLE public.plan_overage_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brand members read overage requests"
ON public.plan_overage_requests FOR SELECT TO authenticated
USING (public.is_brand_member(brand_id, auth.uid()));

CREATE POLICY "Brand members request overage"
ON public.plan_overage_requests FOR INSERT TO authenticated
WITH CHECK (public.is_brand_member(brand_id, auth.uid()) AND requested_by = auth.uid());

CREATE POLICY "Owners and managers decide overage"
ON public.plan_overage_requests FOR UPDATE TO authenticated
USING (
  public.has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
  OR public.has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
)
WITH CHECK (
  public.has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
  OR public.has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
);

CREATE POLICY "Owners and managers delete overage"
ON public.plan_overage_requests FOR DELETE TO authenticated
USING (
  public.has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
  OR public.has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
);

CREATE INDEX plan_overage_requests_lookup_idx
ON public.plan_overage_requests (client_id, channel, period_month, status);

CREATE TRIGGER plan_overage_requests_updated_at
BEFORE UPDATE ON public.plan_overage_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.plan_overage_requests
ADD CONSTRAINT plan_overage_requests_status_check
CHECK (status IN ('pending','approved','rejected'));