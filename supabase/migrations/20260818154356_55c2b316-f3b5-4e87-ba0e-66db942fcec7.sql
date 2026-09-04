-- Ajuste: bloquear apenas o CLIENTE (portal_client) na escrita de clients,
-- preservando a matriz RBAC canônica para membros da marca (admin/manager/user).
DROP POLICY IF EXISTS "clients update staff in scope" ON public.clients;

CREATE POLICY "clients update staff in scope"
ON public.clients
FOR UPDATE
TO authenticated
USING (
  public.can_access_client_row(id, brand_id, owner_user_id, auth.uid())
  AND public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin','manager','user'])
)
WITH CHECK (
  public.can_access_client_row(id, brand_id, owner_user_id, auth.uid())
  AND public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin','manager','user'])
);