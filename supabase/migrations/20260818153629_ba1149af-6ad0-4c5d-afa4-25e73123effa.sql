-- FASE 5.1: bloquear escrita do CLIENTE (portal_client) na tabela clients
DROP POLICY IF EXISTS "clients update in scope" ON public.clients;

CREATE POLICY "clients update staff in scope"
ON public.clients
FOR UPDATE
TO authenticated
USING (
  public.can_access_client_row(id, brand_id, owner_user_id, auth.uid())
  AND public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin','manager'])
)
WITH CHECK (
  public.can_access_client_row(id, brand_id, owner_user_id, auth.uid())
  AND public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin','manager'])
);

DROP POLICY IF EXISTS "clients delete admins" ON public.clients;
CREATE POLICY "clients delete admins"
ON public.clients
FOR DELETE
TO authenticated
USING (
  public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin','manager'])
);

DROP POLICY IF EXISTS "clients insert admins" ON public.clients;
CREATE POLICY "clients insert admins"
ON public.clients
FOR INSERT
TO authenticated
WITH CHECK (
  public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin','manager'])
);

-- FASE 5.2: vocabulario canonico de roles nas policies de briefing
DROP POLICY IF EXISTS "briefing_requests_write_staff" ON public.brand_briefing_requests;
CREATE POLICY "briefing_requests_write_staff"
ON public.brand_briefing_requests
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_access_client(client_id, auth.uid())
  AND public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin','manager'])
);

DROP POLICY IF EXISTS "briefing_requests_update_staff" ON public.brand_briefing_requests;
CREATE POLICY "briefing_requests_update_staff"
ON public.brand_briefing_requests
FOR UPDATE
TO authenticated
USING (
  public.can_access_client(client_id, auth.uid())
  AND public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin','manager'])
)
WITH CHECK (
  public.can_access_client(client_id, auth.uid())
  AND public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin','manager'])
);

DROP POLICY IF EXISTS "briefing_reviews_insert_staff" ON public.brand_briefing_reviews;
CREATE POLICY "briefing_reviews_insert_staff"
ON public.brand_briefing_reviews
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_access_client(client_id, auth.uid())
  AND public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin','manager'])
);

-- versoes do briefing: somente staff pode gravar snapshot
DROP POLICY IF EXISTS "briefing versions insert in scope" ON public.brand_briefing_versions;
CREATE POLICY "briefing versions insert staff"
ON public.brand_briefing_versions
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_access_client(client_id, auth.uid())
  AND public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin','manager'])
);