
-- Junction table linking social connections (global at brand level) to specific clients.
CREATE TABLE public.client_social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.social_connections(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, connection_id)
);

CREATE INDEX idx_client_social_accounts_client ON public.client_social_accounts(client_id);
CREATE INDEX idx_client_social_accounts_connection ON public.client_social_accounts(connection_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_social_accounts TO authenticated;
GRANT ALL ON public.client_social_accounts TO service_role;

ALTER TABLE public.client_social_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "csa brand members read"
  ON public.client_social_accounts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = client_social_accounts.brand_id AND bm.user_id = auth.uid()));

CREATE POLICY "csa brand members write"
  ON public.client_social_accounts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = client_social_accounts.brand_id AND bm.user_id = auth.uid()));

CREATE POLICY "csa brand members delete"
  ON public.client_social_accounts FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = client_social_accounts.brand_id AND bm.user_id = auth.uid()));

CREATE POLICY "csa super admin"
  ON public.client_social_accounts FOR ALL TO authenticated
  USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

-- Backfill: existing social_connections with a client_id become assignments.
INSERT INTO public.client_social_accounts (brand_id, client_id, connection_id)
SELECT brand_id, client_id, id FROM public.social_connections
WHERE client_id IS NOT NULL
ON CONFLICT DO NOTHING;
