-- =============================================================================
-- PROMOÇÃO BASELINE — FORWARD-ONLY (validado em ambiente descartável)
-- Consolida:
--   20260821090000_fix_user_profiles_role_and_signup
--   20260821090100_storage_buckets_baseline
--   20260821090300_fix_user_profiles_privilege_escalation
-- =============================================================================

-- 1. role: DEFAULT e CHECK ----------------------------------------------------
ALTER TABLE public.user_profiles ALTER COLUMN role SET DEFAULT 'user';

UPDATE public.user_profiles
   SET role = 'user'
 WHERE role IS NULL
    OR role NOT IN ('admin', 'manager', 'user', 'super_admin');

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'manager', 'user', 'super_admin'));

-- 2. handle_new_user() --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_full_name text;
BEGIN
  v_role := lower(coalesce(NEW.raw_user_meta_data->>'role', ''));
  IF v_role NOT IN ('admin', 'manager', 'user', 'super_admin') THEN
    v_role := 'user';
  END IF;

  v_full_name := coalesce(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    split_part(coalesce(NEW.email, ''), '@', 1),
    'Usuário'
  );

  BEGIN
    INSERT INTO public.user_profiles (id, full_name, role)
    VALUES (NEW.id, v_full_name, v_role)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: falha ao criar perfil para %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Privilégios de public.user_profiles --------------------------------------
REVOKE ALL ON TABLE public.user_profiles FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_profiles FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_profiles TO authenticated;
GRANT ALL ON TABLE public.user_profiles TO service_role;

-- 5. Correção de escalação de privilégio em user_profiles --------------------
CREATE OR REPLACE FUNCTION public.guard_super_admin_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_privileged boolean := v_actor IS NULL OR public.is_super_admin(v_actor);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (COALESCE(NEW.is_super_admin, false) = true
        OR COALESCE(NEW.role, 'user') = 'super_admin')
       AND NOT v_privileged THEN
      RAISE EXCEPTION 'Forbidden: apenas super admin cria perfil privilegiado'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_super_admin, false) IS DISTINCT FROM COALESCE(OLD.is_super_admin, false)
     AND NOT v_privileged THEN
    RAISE EXCEPTION 'Forbidden: apenas super admin altera is_super_admin'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(NEW.role, '') IS DISTINCT FROM COALESCE(OLD.role, '')
     AND NOT v_privileged THEN
    RAISE EXCEPTION 'Forbidden: apenas super admin altera role do perfil'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_super_admin_flag ON public.user_profiles;
CREATE TRIGGER trg_guard_super_admin_flag
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_flag();

DROP TRIGGER IF EXISTS trg_guard_super_admin_flag_insert ON public.user_profiles;
CREATE TRIGGER trg_guard_super_admin_flag_insert
  BEFORE INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_flag();

COMMENT ON FUNCTION public.guard_super_admin_flag() IS
  'Guarda de campos privilegiados de user_profiles (role, is_super_admin): grava somente quando auth.uid() e nulo (rotina interna/service_role) ou o ator e super admin.';