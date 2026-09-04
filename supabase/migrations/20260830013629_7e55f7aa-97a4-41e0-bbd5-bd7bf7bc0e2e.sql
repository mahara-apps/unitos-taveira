CREATE OR REPLACE FUNCTION public.can_create_brand(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    AND (
      -- super admin não tem limite
      public.is_super_admin(_user_id)
      OR (
        -- regra de 1 workspace por conta: bloqueia quem já é owner
        NOT EXISTS (
          SELECT 1 FROM public.brand_members bm
          WHERE bm.user_id = _user_id
            AND bm.is_active
            AND bm.role = 'owner'
        )
        AND (
          EXISTS (
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
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_create_brand(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_brand(uuid) TO authenticated, service_role;