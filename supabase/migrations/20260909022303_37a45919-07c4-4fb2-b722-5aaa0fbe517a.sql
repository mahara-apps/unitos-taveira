CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_full_name text;
  v_brand uuid;
  v_is_first boolean;
  v_ws_name text;
  v_ws_slug text;
  v_is_test boolean;
BEGIN
  v_role := lower(coalesce(NEW.raw_user_meta_data->>'role', ''));
  IF v_role NOT IN ('admin', 'manager', 'user', 'super_admin', 'portal_client') THEN
    v_role := 'user';
  END IF;

  v_is_test := coalesce(NEW.email, '') ~* '@(unitos-tests\.dev|unitos-qa\.test)$';

  SELECT NOT EXISTS (SELECT 1 FROM public.user_profiles) INTO v_is_first;
  IF v_is_first AND v_role <> 'portal_client' AND NOT v_is_test THEN
    v_role := 'super_admin';
  END IF;

  v_full_name := coalesce(
    NULLIF(trim(coalesce(NEW.raw_user_meta_data->>'full_name', '')), ''),
    NULLIF(trim(split_part(coalesce(NEW.email, ''), '@', 1)), ''),
    'Usuário'
  );

  INSERT INTO public.user_profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    v_full_name,
    NEW.email,
    CASE WHEN v_role = 'portal_client' THEN 'user' ELSE v_role END
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email;

  IF v_role <> 'portal_client' AND NOT v_is_test THEN
    BEGIN
      SELECT id INTO v_brand FROM public.brands ORDER BY created_at LIMIT 1;

      IF v_brand IS NULL AND v_is_first THEN
        v_ws_name := coalesce(
          NULLIF(trim(NEW.raw_user_meta_data->>'workspace_name'), ''),
          'Workspace'
        );
        v_ws_slug := regexp_replace(lower(v_ws_name), '[^a-z0-9]+', '-', 'g');
        v_ws_slug := NULLIF(trim(both '-' from v_ws_slug), '');
        v_ws_slug := coalesce(v_ws_slug, 'workspace') || '-' || substr(NEW.id::text, 1, 8);

        INSERT INTO public.brands (name, slug, created_by)
        VALUES (left(v_ws_name, 80), v_ws_slug, NEW.id)
        RETURNING id INTO v_brand;
      END IF;

      IF v_brand IS NOT NULL THEN
        INSERT INTO public.brand_members (brand_id, user_id, role)
        VALUES (v_brand, NEW.id, CASE WHEN v_role = 'super_admin' THEN 'admin' ELSE v_role END::app_role)
        ON CONFLICT (brand_id, user_id) DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: falha ao vincular workspace para %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

INSERT INTO public.user_profiles (id, full_name, email, role, requires_password_change)
SELECT
  u.id,
  coalesce(
    NULLIF(trim(coalesce(u.raw_user_meta_data->>'full_name', '')), ''),
    NULLIF(trim(split_part(coalesce(u.email, ''), '@', 1)), ''),
    'Usuário'
  ),
  u.email,
  'user',
  false
FROM auth.users u
LEFT JOIN public.user_profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;