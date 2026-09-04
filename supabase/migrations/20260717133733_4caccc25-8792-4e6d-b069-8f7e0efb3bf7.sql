CREATE OR REPLACE FUNCTION public.find_user_id_by_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(_email))
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.find_user_id_by_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.link_existing_user_to_brand(
  _brand_id uuid,
  _email text,
  _role public.app_role,
  _permissions jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(status text, email text, user_id uuid, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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
      AND bm.role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT public.find_user_id_by_email(_email) INTO v_target;

  IF v_target IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, lower(trim(_email))::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT bm.role::text AS role, bm.permissions
  INTO v_existing
  FROM public.brand_members bm
  WHERE bm.brand_id = _brand_id
    AND bm.user_id = v_target;

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
$$;

REVOKE ALL ON FUNCTION public.link_existing_user_to_brand(uuid, text, public.app_role, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_existing_user_to_brand(uuid, text, public.app_role, jsonb) TO authenticated;