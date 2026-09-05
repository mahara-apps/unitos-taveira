CREATE TABLE IF NOT EXISTS public.client_portal_access (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  permissions jsonb NOT NULL DEFAULT '{"approvals":"interact","pauta":"interact","calendar":"view","briefing":"interact","files":"view","brand":"view"}'::jsonb,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_portal_access TO authenticated;
GRANT ALL ON public.client_portal_access TO service_role;

ALTER TABLE public.client_portal_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cpa_select ON public.client_portal_access;
CREATE POLICY cpa_select ON public.client_portal_access
  FOR SELECT TO authenticated
  USING (
    public.can_access_client(client_id, auth.uid())
    OR public.is_portal_client_of(client_id, auth.uid())
  );

DROP POLICY IF EXISTS cpa_write ON public.client_portal_access;
CREATE POLICY cpa_write ON public.client_portal_access
  FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (public.is_brand_admin_level(brand_id, auth.uid()) AND public.can_access_client(client_id, auth.uid()))
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (public.is_brand_admin_level(brand_id, auth.uid()) AND public.can_access_client(client_id, auth.uid()))
  );

CREATE OR REPLACE FUNCTION public.client_portal_access_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_portal_access_touch ON public.client_portal_access;
CREATE TRIGGER trg_client_portal_access_touch
  BEFORE UPDATE ON public.client_portal_access
  FOR EACH ROW EXECUTE FUNCTION public.client_portal_access_touch();

-- Permissões efetivas do portal, lidas tanto pela agência quanto pelo cliente final.
CREATE OR REPLACE FUNCTION public.portal_permissions(_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _default jsonb := '{"approvals":"interact","pauta":"interact","calendar":"view","briefing":"interact","files":"view","brand":"view"}'::jsonb;
  _perms jsonb;
BEGIN
  IF NOT (
    public.can_access_client(_client_id, auth.uid())
    OR public.is_portal_client_of(_client_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'client_not_allowed';
  END IF;

  SELECT permissions INTO _perms FROM public.client_portal_access WHERE client_id = _client_id;
  RETURN _default || COALESCE(_perms, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_permissions(uuid) TO authenticated, service_role;