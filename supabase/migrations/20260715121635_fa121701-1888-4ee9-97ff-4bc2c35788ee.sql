
CREATE TABLE IF NOT EXISTS public.media_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Plano de mídia',
  period_start date,
  period_end date,
  monthly_budget numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  share_token text UNIQUE,
  share_expires_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_plans_status_check CHECK (status IN ('draft','approved','archived'))
);
CREATE INDEX IF NOT EXISTS media_plans_client_idx ON public.media_plans (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS media_plans_brand_idx ON public.media_plans (brand_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_plans TO authenticated;
GRANT ALL ON public.media_plans TO service_role;

ALTER TABLE public.media_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand members manage media plans"
  ON public.media_plans FOR ALL
  TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE TRIGGER media_plans_updated_at
  BEFORE UPDATE ON public.media_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.media_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.media_plans(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  product_service text,
  campaign_type text,
  funnel_stage text CHECK (funnel_stage IN ('topo','meio','fundo')),
  objective text,
  main_kpi text,
  channel text,
  audience text,
  budget_pct numeric(6,2) NOT NULL DEFAULT 0,
  budget_amount numeric(14,2) NOT NULL DEFAULT 0,
  keywords text[] NOT NULL DEFAULT ARRAY[]::text[],
  benchmark text,
  other_refs text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_plan_items_plan_pos_idx ON public.media_plan_items (plan_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_plan_items TO authenticated;
GRANT ALL ON public.media_plan_items TO service_role;

ALTER TABLE public.media_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand members manage media plan items"
  ON public.media_plan_items FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.media_plans p
                 WHERE p.id = plan_id
                   AND (public.is_brand_member(p.brand_id, auth.uid()) OR public.is_super_admin(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.media_plans p
                      WHERE p.id = plan_id
                        AND (public.is_brand_member(p.brand_id, auth.uid()) OR public.is_super_admin(auth.uid()))));

CREATE TRIGGER media_plan_items_updated_at
  BEFORE UPDATE ON public.media_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Recalculate budget_amount whenever budget_pct changes
CREATE OR REPLACE FUNCTION public.recalc_media_plan_item_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mb numeric(14,2);
BEGIN
  SELECT monthly_budget INTO mb FROM public.media_plans WHERE id = NEW.plan_id;
  NEW.budget_amount := ROUND(COALESCE(mb, 0) * COALESCE(NEW.budget_pct, 0) / 100.0, 2);
  RETURN NEW;
END;
$$;

CREATE TRIGGER media_plan_items_amount_trg
  BEFORE INSERT OR UPDATE OF budget_pct, plan_id ON public.media_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.recalc_media_plan_item_amount();

-- Recalculate all items when the plan monthly_budget changes
CREATE OR REPLACE FUNCTION public.recalc_media_plan_items_on_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.monthly_budget IS DISTINCT FROM OLD.monthly_budget THEN
    UPDATE public.media_plan_items
       SET budget_amount = ROUND(NEW.monthly_budget * COALESCE(budget_pct,0) / 100.0, 2),
           updated_at = now()
     WHERE plan_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER media_plans_budget_trg
  AFTER UPDATE OF monthly_budget ON public.media_plans
  FOR EACH ROW EXECUTE FUNCTION public.recalc_media_plan_items_on_plan();

-- Public resolve (security definer, token-based)
CREATE OR REPLACE FUNCTION public.media_plan_public_resolve(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p record; c record; b record;
BEGIN
  IF _token IS NULL OR length(_token) < 8 THEN RAISE EXCEPTION 'invalid_token'; END IF;
  SELECT * INTO p FROM public.media_plans WHERE share_token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF p.share_expires_at IS NOT NULL AND p.share_expires_at < now() THEN RAISE EXCEPTION 'token_expired'; END IF;
  SELECT id, name INTO c FROM public.clients WHERE id = p.client_id;
  SELECT id, name INTO b FROM public.brands WHERE id = p.brand_id;
  RETURN jsonb_build_object(
    'plan', jsonb_build_object(
      'id', p.id, 'title', p.title, 'status', p.status,
      'period_start', p.period_start, 'period_end', p.period_end,
      'monthly_budget', p.monthly_budget,
      'updated_at', p.updated_at
    ),
    'client', jsonb_build_object('id', c.id, 'name', c.name),
    'brand',  jsonb_build_object('id', b.id, 'name', b.name)
  );
END $$;

CREATE OR REPLACE FUNCTION public.media_plan_public_items(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p record; rows jsonb;
BEGIN
  IF _token IS NULL OR length(_token) < 8 THEN RAISE EXCEPTION 'invalid_token'; END IF;
  SELECT id, share_expires_at INTO p FROM public.media_plans WHERE share_token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF p.share_expires_at IS NOT NULL AND p.share_expires_at < now() THEN RAISE EXCEPTION 'token_expired'; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.position ASC), '[]'::jsonb) INTO rows FROM (
    SELECT id, position, product_service, campaign_type, funnel_stage, objective,
           main_kpi, channel, audience, budget_pct, budget_amount, keywords,
           benchmark, other_refs
      FROM public.media_plan_items WHERE plan_id = p.id
     ORDER BY position ASC
  ) x;
  RETURN rows;
END $$;

REVOKE EXECUTE ON FUNCTION public.media_plan_public_resolve(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.media_plan_public_items(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_plan_public_resolve(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_plan_public_items(text) TO anon, authenticated;
