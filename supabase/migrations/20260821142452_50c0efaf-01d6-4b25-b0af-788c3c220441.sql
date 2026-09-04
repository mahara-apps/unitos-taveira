-- Papel global "admin" em public.user_profiles.role => autoridade de ADMIN da agência.
-- NÃO confere poderes de super_admin (que segue exclusivo de is_super_admin).
CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT lower(up.role) = 'admin'
       FROM public.user_profiles up
      WHERE up.id = _user_id),
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.is_global_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_global_admin(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.app_access_role(_user_id uuid, _brand_id uuid DEFAULT NULL::uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id IS NULL THEN NULL
    WHEN public.is_super_admin(_user_id) THEN 'super_admin'
    WHEN public.is_global_admin(_user_id) THEN 'admin'
    ELSE COALESCE(
      (SELECT CASE bm.role
                WHEN 'owner'   THEN 'admin'
                WHEN 'manager' THEN 'manager'
                WHEN 'client'  THEN 'client'
                ELSE 'user'
              END
         FROM public.brand_members bm
        WHERE bm.user_id = _user_id
          AND bm.is_active
          AND (_brand_id IS NULL OR bm.brand_id = _brand_id)
        ORDER BY CASE bm.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 WHEN 'client' THEN 4 ELSE 3 END
        LIMIT 1),
      (SELECT 'client'
         FROM public.client_members cm
        WHERE cm.user_id = _user_id AND cm.role = 'portal_client'
        LIMIT 1)
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.is_brand_member(_brand_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin(_user_id)
    OR public.is_global_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_members
       WHERE brand_id = _brand_id AND user_id = _user_id AND is_active
    );
$function$;

CREATE OR REPLACE FUNCTION public.can_access_client_row(_client_id uuid, _brand_id uuid, _owner_user_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  IF _user_id IS NULL OR _brand_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_super_admin(_user_id) OR public.is_global_admin(_user_id) THEN
    RETURN true;
  END IF;

  -- Escopo INTERNO apenas. Usuários do Portal (client_members.role =
  -- 'portal_client') NÃO entram por aqui.
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_members
     WHERE brand_id = _brand_id AND user_id = _user_id AND is_active
  ) THEN
    RETURN false;
  END IF;

  v_role := public.app_access_role(_user_id, _brand_id);

  IF v_role IN ('admin', 'manager') THEN
    RETURN true;
  END IF;

  IF _owner_user_id = _user_id THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.client_members
     WHERE client_id = _client_id AND user_id = _user_id AND role <> 'portal_client'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_brand_ai_limits(_brand_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin(_user_id)
    OR public.is_global_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_members m
       WHERE m.brand_id = _brand_id AND m.user_id = _user_id
         AND m.role IN ('owner','manager')
    );
$function$;

CREATE OR REPLACE FUNCTION public.my_access(_brand_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT auth.uid() AS uid
  ), su AS (
    SELECT public.is_super_admin((SELECT uid FROM me)) AS is_su
  ), ga AS (
    SELECT public.is_global_admin((SELECT uid FROM me)) AS is_ga
  ), role AS (
    SELECT public.app_access_role((SELECT uid FROM me), _brand_id) AS r
  )
  SELECT jsonb_build_object(
    'user_id', (SELECT uid FROM me),
    'brand_id', _brand_id,
    'role', (SELECT r FROM role),
    'is_super_admin', (SELECT is_su FROM su),
    'brand_role', (SELECT bm.role::text FROM public.brand_members bm
                    WHERE bm.user_id = (SELECT uid FROM me)
                      AND bm.is_active
                      AND (_brand_id IS NULL OR bm.brand_id = _brand_id)
                    LIMIT 1),
    'client_ids', COALESCE((
      SELECT jsonb_agg(c.id)
        FROM public.clients c
       WHERE (_brand_id IS NULL OR c.brand_id = _brand_id)
         AND (
           (SELECT is_su FROM su)
           OR (SELECT is_ga FROM ga)
           OR (
             EXISTS (
               SELECT 1 FROM public.brand_members bm
                WHERE bm.brand_id = c.brand_id
                  AND bm.user_id = (SELECT uid FROM me)
                  AND bm.is_active
             )
             AND (
               (SELECT r FROM role) IN ('admin', 'manager')
               OR c.owner_user_id = (SELECT uid FROM me)
               OR EXISTS (
                 SELECT 1 FROM public.client_members cm
                  WHERE cm.client_id = c.id
                    AND cm.user_id = (SELECT uid FROM me)
                    AND cm.role <> 'portal_client'
               )
             )
           )
         )
    ), '[]'::jsonb),
    'brand_ids', COALESCE((
      CASE WHEN (SELECT is_su FROM su) OR (SELECT is_ga FROM ga)
        THEN (SELECT jsonb_agg(b.id) FROM public.brands b)
        ELSE (SELECT jsonb_agg(bm.brand_id) FROM public.brand_members bm
               WHERE bm.user_id = (SELECT uid FROM me) AND bm.is_active)
      END
    ), '[]'::jsonb)
  );
$function$;