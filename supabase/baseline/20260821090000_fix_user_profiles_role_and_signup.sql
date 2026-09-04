-- =============================================================================
-- FORWARD-ONLY  (posterior a TODAS as migrations historicas; a ultima e
-- 20260820134714_...). ARQUIVO EM STAGING: ver supabase/baseline/README.md.
-- Nome-alvo final:
--   supabase/migrations/20260821090000_fix_user_profiles_role_and_signup.sql
-- =============================================================================
-- Corrige, de forma definitiva e idempotente:
--   1. DEFAULT de public.user_profiles.role  ('editor' -> 'user')
--   2. CHECK de role (garante admin|manager|user|super_admin)
--   3. public.handle_new_user() (fallback 'user'; nunca 'member'/'editor')
--   4. Privilegios de public.user_profiles (remove excedentes de anon/authenticated)
--
-- NAO recria nem substitui o enum public.app_role (fora de escopo, risco alto).
-- NAO executar em producao antes da validacao em Supabase descartavel.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 + 2. role: DEFAULT e CHECK
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_profiles ALTER COLUMN role SET DEFAULT 'user';

-- Rede de seguranca: hoje afeta 0 linhas em producao (user=99, admin=2,
-- super_admin=1), mas garante consistencia em qualquer ambiente.
UPDATE public.user_profiles
   SET role = 'user'
 WHERE role IS NULL
    OR role NOT IN ('admin', 'manager', 'user', 'super_admin');

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'manager', 'user', 'super_admin'));

-- -----------------------------------------------------------------------------
-- 3. handle_new_user(): AFTER INSERT ON auth.users, SECURITY DEFINER
-- -----------------------------------------------------------------------------
-- Mantem o comportamento ja presente em producao (fallback 'user'), agora
-- versionado explicitamente para que uma instalacao limpa termine no mesmo estado.
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

-- -----------------------------------------------------------------------------
-- 4. Privilegios de public.user_profiles
-- -----------------------------------------------------------------------------
-- ACL atual em producao: anon=arwdDxtm (herdado da criacao manual). Nenhuma
-- policy concede acesso a anon; o Portal usa RPCs SECURITY DEFINER.
REVOKE ALL ON TABLE public.user_profiles FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_profiles FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_profiles TO authenticated;
GRANT ALL ON TABLE public.user_profiles TO service_role;
