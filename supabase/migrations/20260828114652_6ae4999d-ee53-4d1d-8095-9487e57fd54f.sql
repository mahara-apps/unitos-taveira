-- 1) Autoridade canônica: owner e admin compartilham o nível "admin".
CREATE OR REPLACE FUNCTION public.app_access_role(_user_id uuid, _brand_id uuid DEFAULT NULL::uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id IS NULL THEN NULL
    WHEN public.is_super_admin(_user_id) THEN 'super_admin'
    WHEN _brand_id IS NULL THEN (
      SELECT 'client'
        FROM public.client_members cm
       WHERE cm.user_id = _user_id AND cm.role = 'portal_client'
       LIMIT 1
    )
    ELSE COALESCE(
      (SELECT CASE bm.role
                WHEN 'owner'   THEN 'admin'
                WHEN 'admin'   THEN 'admin'
                WHEN 'manager' THEN 'manager'
                WHEN 'client'  THEN 'client'
                ELSE 'user'
              END
         FROM public.brand_members bm
        WHERE bm.user_id = _user_id
          AND bm.is_active
          AND bm.brand_id = _brand_id
        ORDER BY CASE bm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'manager' THEN 3
                              WHEN 'client' THEN 5 ELSE 4 END,
                 bm.user_id
        LIMIT 1),
      (SELECT 'client'
         FROM public.client_members cm
        WHERE cm.user_id = _user_id AND cm.role = 'portal_client'
        LIMIT 1)
    )
  END;
$function$;

-- 2) Papel de membership bruto (owner vs admin) para UI/backend.
CREATE OR REPLACE FUNCTION public.brand_member_role(_user_id uuid, _brand_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT bm.role::text
    FROM public.brand_members bm
   WHERE bm.user_id = _user_id
     AND bm.brand_id = _brand_id
     AND bm.is_active
   ORDER BY CASE bm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'manager' THEN 3
                         WHEN 'client' THEN 5 ELSE 4 END
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.brand_member_role(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.brand_member_role(uuid, uuid) TO authenticated, service_role;

-- 3) Matriz canônica de concessão de papéis.
CREATE OR REPLACE FUNCTION public.can_invite_brand_role(_brand_id uuid, _actor_id uuid, _role app_role, _email text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_actor_email text;
BEGIN
  IF _actor_id IS NULL OR _brand_id IS NULL OR _role IS NULL THEN
    RETURN false;
  END IF;

  IF _role NOT IN ('owner', 'admin', 'manager', 'user') THEN
    RETURN false;
  END IF;

  -- Somente SUPER ADMIN concede OWNER.
  IF public.is_super_admin(_actor_id) THEN
    RETURN true;
  END IF;

  SELECT lower(u.email) INTO v_actor_email FROM auth.users u WHERE u.id = _actor_id;
  IF v_actor_email IS NOT NULL AND v_actor_email = lower(coalesce(_email, '')) THEN
    RETURN false;
  END IF;

  v_role := public.app_access_role(_actor_id, _brand_id);

  -- OWNER e ADMIN: concedem admin/manager/user, nunca owner.
  IF v_role = 'admin' THEN
    RETURN _role IN ('admin', 'manager', 'user');
  END IF;

  IF v_role = 'manager' THEN
    RETURN _role = 'user';
  END IF;

  RETURN false;
END;
$function$;

-- 4) Aceite de convite reconhece admin.
CREATE OR REPLACE FUNCTION public.accept_brand_invite(_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text := lower(coalesce((auth.jwt() ->> 'email'), ''));
  v_invite public.brand_invites%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_invite FROM public.brand_invites WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found'; END IF;
  IF v_invite.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'invite_revoked'; END IF;
  IF v_invite.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'invite_already_accepted'; END IF;
  IF v_invite.expires_at < now() THEN RAISE EXCEPTION 'invite_expired'; END IF;
  IF lower(v_invite.email) <> v_user_email THEN RAISE EXCEPTION 'invite_email_mismatch'; END IF;

  IF v_invite.role NOT IN ('owner', 'admin', 'manager', 'user') THEN
    RAISE EXCEPTION 'invite_role_not_allowed';
  END IF;

  IF v_invite.invited_by = v_user_id AND NOT public.is_super_admin(v_user_id) THEN
    RAISE EXCEPTION 'invite_self_escalation';
  END IF;

  IF NOT public.can_invite_brand_role(
        v_invite.brand_id, v_invite.invited_by, v_invite.role, v_invite.email) THEN
    RAISE EXCEPTION 'invite_authority_invalid';
  END IF;

  INSERT INTO public.brand_members (brand_id, user_id, role, permissions)
  VALUES (v_invite.brand_id, v_user_id, v_invite.role, v_invite.permissions)
  ON CONFLICT (brand_id, user_id)
    DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions;

  UPDATE public.brand_invites SET accepted_at = now(), accepted_by = v_user_id WHERE id = v_invite.id;
  RETURN v_invite.brand_id;
END;
$function$;

-- 5) Vínculo de conta existente reconhece admin como ator autorizado.
CREATE OR REPLACE FUNCTION public.link_existing_user_to_brand(_brand_id uuid, _email text, _role app_role, _permissions jsonb DEFAULT '[]'::jsonb)
RETURNS TABLE(status text, email text, user_id uuid, full_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $function$
#variable_conflict use_column
DECLARE
  v_actor uuid := auth.uid();
  v_target uuid;
  v_existing record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.brand_members bm
    WHERE bm.brand_id = _brand_id
      AND bm.user_id = v_actor
      AND bm.is_active
      AND bm.role IN ('owner', 'admin', 'manager')
  ) AND NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT public.can_invite_brand_role(_brand_id, v_actor, _role, _email) THEN
    RAISE EXCEPTION 'role_authority_invalid';
  END IF;

  SELECT public.find_user_id_by_email(_email) INTO v_target;

  IF v_target IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, lower(trim(_email))::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_target = v_actor AND NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'self_promotion_blocked';
  END IF;

  SELECT bm.role::text AS role, bm.permissions
  INTO v_existing
  FROM public.brand_members bm
  WHERE bm.brand_id = _brand_id
    AND bm.user_id = v_target;

  -- Owner existente só pode ser rebaixado/alterado por super admin.
  IF v_existing.role = 'owner' AND NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'owner_change_requires_super_admin';
  END IF;

  INSERT INTO public.brand_members (brand_id, user_id, role, permissions)
  VALUES (_brand_id, v_target, _role, COALESCE(_permissions, '[]'::jsonb))
  ON CONFLICT (brand_id, user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    permissions = EXCLUDED.permissions;

  RETURN QUERY
  SELECT
    CASE
      WHEN v_existing IS NULL THEN 'added'::text
      WHEN v_existing.role = _role::text AND COALESCE(v_existing.permissions, '[]'::jsonb) = COALESCE(_permissions, '[]'::jsonb) THEN 'already_member'::text
      ELSE 'updated'::text
    END,
    lower(trim(_email))::text,
    v_target,
    up.full_name
  FROM public.user_profiles up
  WHERE up.id = v_target;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      CASE
        WHEN v_existing IS NULL THEN 'added'::text
        WHEN v_existing.role = _role::text AND COALESCE(v_existing.permissions, '[]'::jsonb) = COALESCE(_permissions, '[]'::jsonb) THEN 'already_member'::text
        ELSE 'updated'::text
      END,
      lower(trim(_email))::text,
      v_target,
      NULL::text;
  END IF;
END;
$function$;

-- 6) Funções auxiliares que listavam papéis administrativos.
CREATE OR REPLACE FUNCTION public.can_manage_brand_ai_limits(_brand_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_members m
       WHERE m.brand_id = _brand_id AND m.user_id = _user_id AND m.is_active
         AND m.role IN ('owner','admin','manager')
    );
$function$;

CREATE OR REPLACE FUNCTION public.can_create_brand(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
    AND (
      public.is_super_admin(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.brand_members bm
         WHERE bm.user_id = _user_id
           AND bm.is_active
           AND bm.role IN ('owner', 'admin', 'manager', 'user')
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.client_members cm
         WHERE cm.user_id = _user_id
           AND cm.role = 'portal_client'
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.my_access(_brand_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT auth.uid() AS uid),
  su AS (SELECT public.is_super_admin((SELECT uid FROM me)) AS is_su),
  role AS (SELECT public.app_access_role((SELECT uid FROM me), _brand_id) AS r)
  SELECT jsonb_build_object(
    'user_id', (SELECT uid FROM me),
    'brand_id', _brand_id,
    'role', (SELECT r FROM role),
    'is_super_admin', (SELECT is_su FROM su),
    'brand_role', CASE WHEN _brand_id IS NULL THEN NULL
      ELSE public.brand_member_role((SELECT uid FROM me), _brand_id) END,
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

-- 7) RLS de brand_members alinhada à matriz.
DROP POLICY IF EXISTS "owners manage brand members" ON public.brand_members;
DROP POLICY IF EXISTS "managers manage non-owner members" ON public.brand_members;
DROP POLICY IF EXISTS "admins manage non-owner members" ON public.brand_members;
DROP POLICY IF EXISTS "managers manage user members" ON public.brand_members;

CREATE POLICY "owners manage brand members"
  ON public.brand_members FOR ALL TO authenticated
  USING (public.has_brand_role(brand_id, auth.uid(), 'owner'::app_role))
  WITH CHECK (public.has_brand_role(brand_id, auth.uid(), 'owner'::app_role));

CREATE POLICY "admins manage non-owner members"
  ON public.brand_members FOR ALL TO authenticated
  USING (
    public.app_access_role(auth.uid(), brand_id) = 'admin'
    AND role <> 'owner'::app_role
  )
  WITH CHECK (
    public.app_access_role(auth.uid(), brand_id) = 'admin'
    AND role <> 'owner'::app_role
  );

CREATE POLICY "managers manage user members"
  ON public.brand_members FOR ALL TO authenticated
  USING (
    public.app_access_role(auth.uid(), brand_id) = 'manager'
    AND role = 'user'::app_role
  )
  WITH CHECK (
    public.app_access_role(auth.uid(), brand_id) = 'manager'
    AND role = 'user'::app_role
  );

-- 8) RLS de brand_invites reconhece admin (nível administrativo canônico).
DROP POLICY IF EXISTS "brand admins read invites" ON public.brand_invites;
DROP POLICY IF EXISTS "brand admins update invites" ON public.brand_invites;
DROP POLICY IF EXISTS "brand admins delete invites" ON public.brand_invites;

CREATE POLICY "brand admins read invites"
  ON public.brand_invites FOR SELECT TO authenticated
  USING (public.is_brand_admin_level(brand_id, auth.uid()));

CREATE POLICY "brand admins update invites"
  ON public.brand_invites FOR UPDATE TO authenticated
  USING (public.is_brand_admin_level(brand_id, auth.uid()))
  WITH CHECK (public.can_invite_brand_role(brand_id, auth.uid(), role, email));

CREATE POLICY "brand admins delete invites"
  ON public.brand_invites FOR DELETE TO authenticated
  USING (public.is_brand_admin_level(brand_id, auth.uid()));