-- Autoridade para excluir workspace: somente OWNER da marca ou SUPER ADMIN.
CREATE OR REPLACE FUNCTION public.can_delete_brand(_brand_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(_user_id)
      OR public.brand_member_role(_user_id, _brand_id) = 'owner';
$$;

REVOKE ALL ON FUNCTION public.can_delete_brand(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_delete_brand(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_brand(uuid, uuid) TO service_role;

DROP POLICY IF EXISTS "owner or super admin deletes brand" ON public.brands;
CREATE POLICY "owner or super admin deletes brand"
ON public.brands
FOR DELETE
TO authenticated
USING (public.can_delete_brand(id, auth.uid()));
