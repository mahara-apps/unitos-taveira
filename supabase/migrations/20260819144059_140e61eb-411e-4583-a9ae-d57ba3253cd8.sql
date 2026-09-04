-- 1) Status de membro (ativo/inativo) no vínculo da marca
ALTER TABLE public.brand_members
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid;

-- 2) RBAC canônico passa a ignorar membros inativos
CREATE OR REPLACE FUNCTION public.app_access_role(_user_id uuid, _brand_id uuid DEFAULT NULL::uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id IS NULL THEN NULL
    WHEN public.is_super_admin(_user_id) THEN 'super_admin'
    ELSE COALESCE(
      (SELECT CASE bm.role
                WHEN 'owner'   THEN 'admin'
                WHEN 'manager' THEN 'manager'
                ELSE 'user'
              END
         FROM public.brand_members bm
        WHERE bm.user_id = _user_id
          AND bm.is_active
          AND (_brand_id IS NULL OR bm.brand_id = _brand_id)
        ORDER BY CASE bm.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END
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
    OR EXISTS (
      SELECT 1 FROM public.brand_members
       WHERE brand_id = _brand_id AND user_id = _user_id AND is_active
    );
$function$;

CREATE OR REPLACE FUNCTION public.has_brand_role(_brand_id uuid, _user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_members
       WHERE brand_id = _brand_id AND user_id = _user_id AND role = _role AND is_active
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

  IF public.is_super_admin(_user_id) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.client_members
     WHERE client_id = _client_id AND user_id = _user_id AND role = 'portal_client'
  ) THEN
    RETURN true;
  END IF;

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

  IF EXISTS (
    SELECT 1 FROM public.client_members
     WHERE client_id = _client_id AND user_id = _user_id AND role <> 'portal_client'
  ) THEN
    RETURN true;
  END IF;

  RETURN _owner_user_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.client_members
        WHERE client_id = _client_id AND role <> 'portal_client'
     );
END;
$function$;

CREATE OR REPLACE FUNCTION public.my_access(_brand_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'user_id', auth.uid(),
    'brand_id', _brand_id,
    'role', public.app_access_role(auth.uid(), _brand_id),
    'is_super_admin', public.is_super_admin(auth.uid()),
    'brand_role', (SELECT bm.role::text FROM public.brand_members bm
                    WHERE bm.user_id = auth.uid()
                      AND bm.is_active
                      AND (_brand_id IS NULL OR bm.brand_id = _brand_id)
                    LIMIT 1),
    'client_ids', COALESCE((
      SELECT jsonb_agg(c.id)
        FROM public.clients c
       WHERE (_brand_id IS NULL OR c.brand_id = _brand_id)
         AND public.can_access_client(c.id, auth.uid())
    ), '[]'::jsonb),
    'brand_ids', COALESCE((
      SELECT jsonb_agg(bm.brand_id) FROM public.brand_members bm
       WHERE bm.user_id = auth.uid() AND bm.is_active
    ), '[]'::jsonb)
  );
$function$;

-- 3) Reativação segura de acesso do portal (respeita 1 link ativo por cliente)
CREATE OR REPLACE FUNCTION public.reactivate_portal_token(_token_id uuid)
RETURNS TABLE(id uuid, token text, label text, expires_at timestamptz, revoked_at timestamptz, last_seen_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client uuid;
  v_brand uuid;
BEGIN
  SELECT pt.client_id, c.brand_id INTO v_client, v_brand
    FROM public.portal_tokens pt
    JOIN public.clients c ON c.id = pt.client_id
   WHERE pt.id = _token_id;
  IF v_client IS NULL THEN RAISE EXCEPTION 'portal_token_not_found'; END IF;
  IF NOT public.is_brand_admin_level(v_brand, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.portal_tokens
     WHERE client_id = v_client AND revoked_at IS NULL AND id <> _token_id
  ) THEN
    RAISE EXCEPTION 'active_token_exists';
  END IF;

  UPDATE public.portal_tokens pt
     SET revoked_at = NULL
   WHERE pt.id = _token_id;

  RETURN QUERY
    SELECT pt.id, pt.token, pt.label, pt.expires_at, pt.revoked_at, pt.last_seen_at, pt.created_at
      FROM public.portal_tokens pt WHERE pt.id = _token_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reactivate_portal_token(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reactivate_portal_token(uuid) TO authenticated;