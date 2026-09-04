
-- Meta (Facebook/Instagram) integration storage.
CREATE TABLE public.meta_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  meta_user_id TEXT NOT NULL,
  meta_user_name TEXT,
  page_id TEXT NOT NULL,
  page_name TEXT,
  page_access_token_ciphertext TEXT NOT NULL,
  ig_business_id TEXT,
  ig_username TEXT,
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  token_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, page_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_connections TO authenticated;
GRANT ALL ON public.meta_connections TO service_role;
ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brand members read meta connections"
  ON public.meta_connections FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = meta_connections.brand_id AND bm.user_id = auth.uid()));

CREATE POLICY "Brand members manage meta connections"
  ON public.meta_connections FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = meta_connections.brand_id AND bm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = meta_connections.brand_id AND bm.user_id = auth.uid()));

CREATE INDEX idx_meta_connections_brand ON public.meta_connections(brand_id);

CREATE TRIGGER trg_meta_connections_updated_at
  BEFORE UPDATE ON public.meta_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Short-lived OAuth state (CSRF).
CREATE TABLE public.meta_oauth_states (
  state TEXT PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  redirect_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes')
);

GRANT SELECT, INSERT, DELETE ON public.meta_oauth_states TO authenticated;
GRANT ALL ON public.meta_oauth_states TO service_role;
ALTER TABLE public.meta_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own oauth states"
  ON public.meta_oauth_states FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
