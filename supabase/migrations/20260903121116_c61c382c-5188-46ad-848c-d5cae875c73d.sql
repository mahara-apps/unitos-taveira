-- Estado de primeira configuração da instalação (sem expor dado algum).
CREATE OR REPLACE FUNCTION public.installation_setup_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'needs_super_admin', NOT EXISTS (SELECT 1 FROM public.user_profiles),
    'has_workspace', EXISTS (SELECT 1 FROM public.brands)
  );
$$;

REVOKE ALL ON FUNCTION public.installation_setup_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.installation_setup_state() TO anon, authenticated, service_role;

-- Primeiro usuário da instalação = Super Admin + workspace único criado na hora.
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
BEGIN
  v_role := lower(coalesce(NEW.raw_user_meta_data->>'role', ''));
  IF v_role NOT IN ('admin', 'manager', 'user', 'super_admin', 'portal_client') THEN
    v_role := 'user';
  END IF;

  -- Primeira configuração: nenhuma conta interna existe ainda nesta instalação.
  SELECT NOT EXISTS (SELECT 1 FROM public.user_profiles) INTO v_is_first;
  IF v_is_first AND v_role <> 'portal_client' THEN
    v_role := 'super_admin';
  END IF;

  v_full_name := coalesce(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    split_part(coalesce(NEW.email, ''), '@', 1),
    'Usuário'
  );

  BEGIN
    INSERT INTO public.user_profiles (id, full_name, role)
    VALUES (NEW.id, v_full_name, CASE WHEN v_role = 'portal_client' THEN 'user' ELSE v_role END)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: falha ao criar perfil para %: %', NEW.id, SQLERRM;
  END;

  IF v_role <> 'portal_client' THEN
    BEGIN
      SELECT id INTO v_brand FROM public.brands ORDER BY created_at LIMIT 1;

      -- Workspace é singleton: o primeiro Super Admin já recebe o workspace da instalação.
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