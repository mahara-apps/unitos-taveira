CREATE OR REPLACE FUNCTION public.can_create_brand(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    AND (
      public.is_super_admin(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.brand_members bm
         WHERE bm.user_id = _user_id
           AND bm.is_active
           AND bm.role IN ('owner', 'manager', 'user')
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.client_members cm
         WHERE cm.user_id = _user_id
           AND cm.role = 'portal_client'
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_create_brand(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_brand(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "any auth creates brand" ON public.brands;
DROP POLICY IF EXISTS "internal users create brand" ON public.brands;

CREATE POLICY "internal users create brand"
ON public.brands
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.can_create_brand(auth.uid())
);