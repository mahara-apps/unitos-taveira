ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS email text;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_email_lower_key
  ON public.user_profiles (lower(email)) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_profiles_email_lower_idx
  ON public.user_profiles (lower(email));

UPDATE public.user_profiles up
SET email = u.email
FROM auth.users u
WHERE u.id = up.id
  AND up.email IS DISTINCT FROM u.email;

CREATE OR REPLACE FUNCTION public.sync_user_profile_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_profiles SET email = NEW.email, updated_at = now()
  WHERE id = NEW.id AND email IS DISTINCT FROM NEW.email;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sync_user_profile_email: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_user_profile_email_trg ON auth.users;
CREATE TRIGGER sync_user_profile_email_trg
AFTER INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_user_profile_email();

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

  v_full_name := NULLIF(trim(coalesce(NEW.raw_user_meta_data->>'full_name', '')), '');

  BEGIN
    INSERT INTO public.user_profiles (id, full_name, email, role)
    VALUES (
      NEW.id,
      v_full_name,
      NEW.email,
      CASE WHEN v_role = 'portal_client' THEN 'user' ELSE v_role END
    )
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: falha ao criar perfil para %: %', NEW.id, SQLERRM;
  END;

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