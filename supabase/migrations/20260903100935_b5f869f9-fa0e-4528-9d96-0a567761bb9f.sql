-- 1) Regra: workspace é singleton da instalação
CREATE OR REPLACE FUNCTION public.can_create_brand(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    -- singleton: só é possível criar o workspace quando a instalação não tem nenhum
    AND NOT EXISTS (SELECT 1 FROM public.brands)
    AND NOT EXISTS (
      SELECT 1 FROM public.client_members cm
      WHERE cm.user_id = _user_id
        AND cm.role = 'portal_client'
    );
$$;

-- 2) Barreira dura no banco: nunca mais de um workspace
CREATE OR REPLACE FUNCTION public.enforce_single_brand()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE id <> NEW.id) THEN
    RAISE EXCEPTION 'single_workspace_per_installation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_single_brand ON public.brands;
CREATE TRIGGER trg_enforce_single_brand
  BEFORE INSERT ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_brand();

-- 3) Novos usuários entram automaticamente no workspace único
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
BEGIN
  v_role := lower(coalesce(NEW.raw_user_meta_data->>'role', ''));
  IF v_role NOT IN ('admin', 'manager', 'user', 'super_admin', 'portal_client') THEN
    v_role := 'user';
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

  -- Workspace é singleton: vincula o novo usuário interno ao workspace único.
  IF v_role <> 'portal_client' THEN
    BEGIN
      SELECT id INTO v_brand FROM public.brands ORDER BY created_at LIMIT 1;
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