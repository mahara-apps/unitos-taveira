-- =============================================================================
-- Promoção do lote de segurança validado (forward-only).
-- 1/3 — brand_invites: bloqueia escalação de papel via convite
-- =============================================================================
CREATE OR REPLACE FUNCTION public.can_invite_brand_role(
  _brand_id uuid,
  _actor_id uuid,
  _role public.app_role,
  _email text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_actor_email text;
BEGIN
  IF _actor_id IS NULL OR _brand_id IS NULL OR _role IS NULL THEN
    RETURN false;
  END IF;

  IF _role NOT IN ('owner', 'manager', 'user') THEN
    RETURN false;
  END IF;

  IF public.is_super_admin(_actor_id) THEN
    RETURN true;
  END IF;

  SELECT lower(u.email) INTO v_actor_email FROM auth.users u WHERE u.id = _actor_id;
  IF v_actor_email IS NOT NULL AND v_actor_email = lower(coalesce(_email, '')) THEN
    RETURN false;
  END IF;

  v_role := public.app_access_role(_actor_id, _brand_id);

  IF v_role = 'admin' THEN
    RETURN _role IN ('manager', 'user');
  END IF;

  IF v_role = 'manager' THEN
    RETURN _role = 'user';
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.can_invite_brand_role(uuid, uuid, public.app_role, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_invite_brand_role(uuid, uuid, public.app_role, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "brand admins manage invites" ON public.brand_invites;
DROP POLICY IF EXISTS "brand admins read invites" ON public.brand_invites;
DROP POLICY IF EXISTS "brand admins create invites" ON public.brand_invites;
DROP POLICY IF EXISTS "brand admins update invites" ON public.brand_invites;
DROP POLICY IF EXISTS "brand admins delete invites" ON public.brand_invites;

CREATE POLICY "brand admins read invites"
  ON public.brand_invites FOR SELECT TO authenticated
  USING (
    has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
    OR has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
  );

CREATE POLICY "brand admins create invites"
  ON public.brand_invites FOR INSERT TO authenticated
  WITH CHECK (
    public.can_invite_brand_role(brand_id, auth.uid(), role, email)
  );

CREATE POLICY "brand admins update invites"
  ON public.brand_invites FOR UPDATE TO authenticated
  USING (
    has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
    OR has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
  )
  WITH CHECK (
    public.can_invite_brand_role(brand_id, auth.uid(), role, email)
  );

CREATE POLICY "brand admins delete invites"
  ON public.brand_invites FOR DELETE TO authenticated
  USING (
    has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
    OR has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
  );

CREATE OR REPLACE FUNCTION public.accept_brand_invite(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  IF v_invite.role NOT IN ('owner', 'manager', 'user') THEN
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

-- =============================================================================
-- 2/3 — portal_tokens: escopo real de cliente
-- =============================================================================
DROP POLICY IF EXISTS "brand members manage portal tokens" ON public.portal_tokens;
DROP POLICY IF EXISTS "scoped members manage portal tokens" ON public.portal_tokens;

CREATE POLICY "scoped members manage portal tokens"
  ON public.portal_tokens FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.id = portal_tokens.client_id
         AND public.can_access_client_row(c.id, c.brand_id, c.owner_user_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.id = portal_tokens.client_id
         AND public.can_access_client_row(c.id, c.brand_id, c.owner_user_id, auth.uid())
    )
  );

-- =============================================================================
-- 3/3 — anon: remove privilégios de tabela em public (defesa em profundidade)
-- =============================================================================
DO $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon',
      r.relname
    );
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'anon table privileges revoked on % public tables', v_count;
END $$;

REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon;

GRANT USAGE ON SCHEMA public TO anon;