
-- 1. Add client_id + channel columns
ALTER TABLE public.monthly_plans ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.monthly_plan_topics ADD COLUMN IF NOT EXISTS channel text;

-- 2. Backfill legacy plans: assign to first client of the brand
UPDATE public.monthly_plans mp
SET client_id = (
  SELECT c.id FROM public.clients c
  WHERE c.brand_id = mp.brand_id AND c.archived_at IS NULL
  ORDER BY c.created_at ASC LIMIT 1
)
WHERE mp.client_id IS NULL;

-- Archive any rows still without a client (brand has no clients)
UPDATE public.monthly_plans SET status = 'archived' WHERE client_id IS NULL;
DELETE FROM public.monthly_plans WHERE client_id IS NULL;

-- 3. Enforce NOT NULL + index
ALTER TABLE public.monthly_plans ALTER COLUMN client_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS monthly_plans_brand_client_created_idx
  ON public.monthly_plans (brand_id, client_id, created_at DESC);

-- 4. Tighten RLS to require client membership
DROP POLICY IF EXISTS "Brand members can read monthly_plans" ON public.monthly_plans;
DROP POLICY IF EXISTS "Brand members can insert monthly_plans" ON public.monthly_plans;
DROP POLICY IF EXISTS "Brand members can update monthly_plans" ON public.monthly_plans;
DROP POLICY IF EXISTS "Brand members can delete monthly_plans" ON public.monthly_plans;

CREATE POLICY "Client members access monthly_plans"
  ON public.monthly_plans FOR ALL
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));
