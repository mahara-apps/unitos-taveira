CREATE TABLE public.user_login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'team',
  event text NOT NULL DEFAULT 'sign_in',
  provider text,
  email text,
  user_agent text,
  device text,
  os text,
  browser text,
  ip_prefix text,
  city text,
  country text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_login_events TO authenticated;
GRANT ALL ON public.user_login_events TO service_role;

ALTER TABLE public.user_login_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace admins read login events"
ON public.user_login_events
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    brand_id IS NOT NULL
    AND lower(coalesce(public.app_access_role(auth.uid(), brand_id), '')) IN ('owner','admin','super_admin')
  )
);

CREATE INDEX user_login_events_brand_created_idx ON public.user_login_events (brand_id, created_at DESC);
CREATE INDEX user_login_events_user_created_idx ON public.user_login_events (user_id, created_at DESC);
CREATE INDEX user_login_events_email_idx ON public.user_login_events (lower(email));