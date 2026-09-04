-- 1) clients DELETE: exigir escopo do cliente (manager não pode apagar cliente não atribuído)
DROP POLICY IF EXISTS "clients delete admins" ON public.clients;
CREATE POLICY "clients delete in scope"
ON public.clients FOR DELETE TO authenticated
USING (
  public.can_access_client_row(id, brand_id, owner_user_id, auth.uid())
  AND public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin','admin','manager'])
);

-- 2) brand_members SELECT: restringir a authenticated (era PUBLIC)
DROP POLICY IF EXISTS "members read brand memberships" ON public.brand_members;
CREATE POLICY "members read brand memberships"
ON public.brand_members FOR SELECT TO authenticated
USING (
  ((user_id = auth.uid()) OR public.is_brand_member(brand_id, auth.uid()))
  AND ((NOT public.is_super_admin(user_id)) OR public.is_super_admin(auth.uid()))
);

-- 3) Sem elevação silenciosa: brand_role só existe dentro de um workspace
CREATE OR REPLACE FUNCTION public.my_access(_brand_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT auth.uid() AS uid),
  su AS (SELECT public.is_super_admin((SELECT uid FROM me)) AS is_su),
  role AS (SELECT public.app_access_role((SELECT uid FROM me), _brand_id) AS r)
  SELECT jsonb_build_object(
    'user_id', (SELECT uid FROM me),
    'brand_id', _brand_id,
    'role', (SELECT r FROM role),
    'is_super_admin', (SELECT is_su FROM su),
    'brand_role', CASE WHEN _brand_id IS NULL THEN NULL ELSE (
        SELECT bm.role::text FROM public.brand_members bm
         WHERE bm.user_id = (SELECT uid FROM me)
           AND bm.is_active
           AND bm.brand_id = _brand_id
         ORDER BY CASE bm.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2
                               WHEN 'client' THEN 4 ELSE 3 END, bm.brand_id
         LIMIT 1) END,
    'client_ids', COALESCE((
      SELECT jsonb_agg(c.id ORDER BY c.id)
        FROM public.clients c
       WHERE (_brand_id IS NULL OR c.brand_id = _brand_id)
         AND public.can_access_client_row(c.id, c.brand_id, c.owner_user_id, (SELECT uid FROM me))
    ), '[]'::jsonb),
    'brand_ids', COALESCE((
      CASE WHEN (SELECT is_su FROM su)
        THEN (SELECT jsonb_agg(b.id) FROM public.brands b)
        ELSE (SELECT jsonb_agg(bm.brand_id) FROM public.brand_members bm
               WHERE bm.user_id = (SELECT uid FROM me) AND bm.is_active)
      END
    ), '[]'::jsonb)
  );
$function$;

-- 4) Helpers de escopo não precisam ser executáveis por anon
REVOKE ALL ON FUNCTION public.client_in_scope(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_client_assigned(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_in_scope(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_client_assigned(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.client_in_scope(uuid, uuid) IS 'Predicado de escopo de cliente (RLS). EXECUTE apenas authenticated/service_role.';