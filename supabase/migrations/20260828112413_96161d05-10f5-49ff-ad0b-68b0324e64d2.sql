CREATE OR REPLACE FUNCTION public.can_invite_brand_role(_brand_id uuid, _actor_id uuid, _role app_role, _email text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- ADMIN (owner) da marca pode conceder qualquer papel interno, incluindo
  -- outro ADMIN: não existe regra de "apenas um Admin" por workspace.
  IF v_role = 'admin' THEN
    RETURN _role IN ('owner', 'manager', 'user');
  END IF;

  IF v_role = 'manager' THEN
    RETURN _role = 'user';
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_invite_brand_role(uuid, uuid, app_role, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_invite_brand_role(uuid, uuid, app_role, text) TO authenticated, service_role;