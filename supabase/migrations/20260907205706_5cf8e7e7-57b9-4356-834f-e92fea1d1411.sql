-- ============================================================ AD ACCOUNTS
CREATE TABLE public.ad_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'meta',
  external_id text NOT NULL,
  name text,
  currency text,
  timezone text,
  account_status integer,
  business_name text,
  meta_session_id uuid REFERENCES public.meta_oauth_sessions(id) ON DELETE SET NULL,
  last_synced_at timestamptz,
  sync_status text NOT NULL DEFAULT 'not_loaded',
  sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_accounts_provider_chk CHECK (provider IN ('meta','google')),
  CONSTRAINT ad_accounts_sync_status_chk CHECK (sync_status IN ('not_loaded','loaded','empty','error','rate_limited')),
  CONSTRAINT ad_accounts_unique UNIQUE (brand_id, provider, external_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_accounts TO authenticated;
GRANT ALL ON public.ad_accounts TO service_role;
ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;

-- ==================================================== CLIENT <-> AD ACCOUNT
CREATE TABLE public.client_ad_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_ad_accounts_unique UNIQUE (client_id, ad_account_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_ad_accounts TO authenticated;
GRANT ALL ON public.client_ad_accounts TO service_role;
ALTER TABLE public.client_ad_accounts ENABLE ROW LEVEL SECURITY;

-- ============================================================ AD ENTITIES
CREATE TABLE public.ad_entities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  level text NOT NULL,
  external_id text NOT NULL,
  parent_external_id text,
  name text,
  objective text,
  status text,
  effective_status text,
  daily_budget numeric,
  lifetime_budget numeric,
  start_time timestamptz,
  stop_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_entities_level_chk CHECK (level IN ('campaign','adset','ad')),
  CONSTRAINT ad_entities_unique UNIQUE (ad_account_id, level, external_id)
);
CREATE INDEX ad_entities_parent_idx ON public.ad_entities (ad_account_id, level, parent_external_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_entities TO authenticated;
GRANT ALL ON public.ad_entities TO service_role;
ALTER TABLE public.ad_entities ENABLE ROW LEVEL SECURITY;

-- =========================================================== AD CREATIVES
CREATE TABLE public.ad_creatives (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  ad_external_id text NOT NULL,
  creative_external_id text,
  title text,
  body text,
  thumbnail_url text,
  image_url text,
  video_id text,
  link_url text,
  call_to_action text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_creatives_unique UNIQUE (ad_account_id, ad_external_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_creatives TO authenticated;
GRANT ALL ON public.ad_creatives TO service_role;
ALTER TABLE public.ad_creatives ENABLE ROW LEVEL SECURITY;

-- ======================================================= AD INSIGHTS DAILY
CREATE TABLE public.ad_insights_daily (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  level text NOT NULL,
  entity_external_id text NOT NULL,
  stat_date date NOT NULL,
  breakdown_kind text NOT NULL DEFAULT 'none',
  breakdown_value text NOT NULL DEFAULT '',
  spend numeric NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  reach bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  link_clicks bigint NOT NULL DEFAULT 0,
  results numeric NOT NULL DEFAULT 0,
  result_kind text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_insights_level_chk CHECK (level IN ('account','campaign','adset','ad')),
  CONSTRAINT ad_insights_breakdown_chk CHECK (breakdown_kind IN ('none','platform','placement')),
  CONSTRAINT ad_insights_unique UNIQUE (ad_account_id, level, entity_external_id, stat_date, breakdown_kind, breakdown_value)
);
CREATE INDEX ad_insights_daily_lookup_idx
  ON public.ad_insights_daily (ad_account_id, level, stat_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_insights_daily TO authenticated;
GRANT ALL ON public.ad_insights_daily TO service_role;
ALTER TABLE public.ad_insights_daily ENABLE ROW LEVEL SECURITY;

-- ================================================================ HELPERS
-- Leitura de dados de anúncio: autoridade de integração cobre o workspace;
-- manager/user só enxergam contas ligadas a clientes no seu escopo.
CREATE OR REPLACE FUNCTION public.can_read_ad_account(_ad_account_id uuid, _brand_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(_user_id)
     OR public.is_brand_integration_authority(_brand_id, _user_id)
     OR EXISTS (
       SELECT 1
       FROM public.client_ad_accounts ca
       WHERE ca.ad_account_id = _ad_account_id
         AND public.client_in_scope(ca.client_id, ca.brand_id)
     )
$$;

-- ============================================================== POLICIES
CREATE POLICY "ad_accounts read in scope" ON public.ad_accounts
  FOR SELECT TO authenticated
  USING (public.can_read_ad_account(id, brand_id, auth.uid()));
CREATE POLICY "ad_accounts authority write" ON public.ad_accounts
  FOR ALL TO authenticated
  USING (public.is_brand_integration_authority(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_integration_authority(brand_id, auth.uid()));
CREATE POLICY "ad_accounts super admin" ON public.ad_accounts
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "client_ad_accounts read in scope" ON public.client_ad_accounts
  FOR SELECT TO authenticated
  USING (public.client_in_scope(client_id, brand_id));
CREATE POLICY "client_ad_accounts authority write" ON public.client_ad_accounts
  FOR ALL TO authenticated
  USING (public.is_brand_integration_authority(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.is_brand_integration_authority(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));
CREATE POLICY "client_ad_accounts super admin" ON public.client_ad_accounts
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "ad_entities read in scope" ON public.ad_entities
  FOR SELECT TO authenticated
  USING (public.can_read_ad_account(ad_account_id, brand_id, auth.uid()));
CREATE POLICY "ad_entities authority write" ON public.ad_entities
  FOR ALL TO authenticated
  USING (public.is_brand_integration_authority(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_integration_authority(brand_id, auth.uid()));
CREATE POLICY "ad_entities super admin" ON public.ad_entities
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "ad_creatives read in scope" ON public.ad_creatives
  FOR SELECT TO authenticated
  USING (public.can_read_ad_account(ad_account_id, brand_id, auth.uid()));
CREATE POLICY "ad_creatives authority write" ON public.ad_creatives
  FOR ALL TO authenticated
  USING (public.is_brand_integration_authority(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_integration_authority(brand_id, auth.uid()));
CREATE POLICY "ad_creatives super admin" ON public.ad_creatives
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "ad_insights read in scope" ON public.ad_insights_daily
  FOR SELECT TO authenticated
  USING (public.can_read_ad_account(ad_account_id, brand_id, auth.uid()));
CREATE POLICY "ad_insights authority write" ON public.ad_insights_daily
  FOR ALL TO authenticated
  USING (public.is_brand_integration_authority(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_integration_authority(brand_id, auth.uid()));
CREATE POLICY "ad_insights super admin" ON public.ad_insights_daily
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- ================================================================ TRIGGERS
CREATE OR REPLACE FUNCTION public.ads_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ad_accounts_touch BEFORE UPDATE ON public.ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.ads_touch_updated_at();
CREATE TRIGGER client_ad_accounts_touch BEFORE UPDATE ON public.client_ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.ads_touch_updated_at();
CREATE TRIGGER ad_entities_touch BEFORE UPDATE ON public.ad_entities
  FOR EACH ROW EXECUTE FUNCTION public.ads_touch_updated_at();
CREATE TRIGGER ad_creatives_touch BEFORE UPDATE ON public.ad_creatives
  FOR EACH ROW EXECUTE FUNCTION public.ads_touch_updated_at();
CREATE TRIGGER ad_insights_daily_touch BEFORE UPDATE ON public.ad_insights_daily
  FOR EACH ROW EXECUTE FUNCTION public.ads_touch_updated_at();