DROP POLICY IF EXISTS "clients delete in scope" ON public.clients;
CREATE POLICY "clients delete admins only"
ON public.clients FOR DELETE TO authenticated
USING (
  public.can_access_client_row(id, brand_id, owner_user_id, auth.uid())
  AND public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin'])
);