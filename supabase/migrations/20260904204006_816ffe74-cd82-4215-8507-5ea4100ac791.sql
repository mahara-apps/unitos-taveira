-- =============================================================
-- Perfis de acesso + permissões por módulo (RBAC operacional)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.access_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_profiles TO authenticated;
GRANT ALL ON public.access_profiles TO service_role;

ALTER TABLE public.access_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "access_profiles_select_members" ON public.access_profiles;
CREATE POLICY "access_profiles_select_members" ON public.access_profiles
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = access_profiles.brand_id AND bm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "access_profiles_write_admin" ON public.access_profiles;
CREATE POLICY "access_profiles_write_admin" ON public.access_profiles
  FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.brand_member_role(auth.uid(), access_profiles.brand_id) IN ('owner','admin')
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.brand_member_role(auth.uid(), access_profiles.brand_id) IN ('owner','admin')
  );

CREATE OR REPLACE FUNCTION public.access_profiles_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_access_profiles_updated ON public.access_profiles;
CREATE TRIGGER trg_access_profiles_updated
  BEFORE UPDATE ON public.access_profiles
  FOR EACH ROW EXECUTE FUNCTION public.access_profiles_touch_updated_at();

-- Impede remover perfis do sistema
CREATE OR REPLACE FUNCTION public.access_profiles_block_system_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'system_profile_delete_blocked';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_access_profiles_block_system_delete ON public.access_profiles;
CREATE TRIGGER trg_access_profiles_block_system_delete
  BEFORE DELETE ON public.access_profiles
  FOR EACH ROW EXECUTE FUNCTION public.access_profiles_block_system_delete();

-- -------------------------------------------------------------
-- Colunas no membro do workspace
-- -------------------------------------------------------------
ALTER TABLE public.brand_members
  ADD COLUMN IF NOT EXISTS access_profile_id uuid REFERENCES public.access_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS module_permissions jsonb;

ALTER TABLE public.brand_invites
  ADD COLUMN IF NOT EXISTS access_profile_key text,
  ADD COLUMN IF NOT EXISTS module_permissions jsonb;

-- -------------------------------------------------------------
-- Seed dos perfis de sistema
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.access_profiles_system_defaults()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '[
    {"key":"atendimento","name":"Atendimento","permissions":{"clients":"full","briefing":"full","projects":"full","tasks":"full","planning":"full","content":"full","calendar":"view","approvals":"full","media_plans":"view","connections":"none","reports":"view","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"view"}},
    {"key":"criativo","name":"Criativo","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"own","content":"full","calendar":"view","approvals":"own","media_plans":"none","connections":"none","reports":"none","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"trafego","name":"Tráfego","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"view","content":"own","calendar":"view","approvals":"view","media_plans":"full","connections":"view","reports":"full","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"midia","name":"Mídia","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"view","content":"view","calendar":"view","approvals":"view","media_plans":"full","connections":"view","reports":"full","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"producao","name":"Produção","permissions":{"clients":"view","briefing":"view","projects":"own","tasks":"full","planning":"view","content":"own","calendar":"full","approvals":"own","media_plans":"none","connections":"none","reports":"view","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"financeiro","name":"Financeiro","permissions":{"clients":"view","briefing":"none","projects":"view","tasks":"view","planning":"view","content":"none","calendar":"view","approvals":"none","media_plans":"view","connections":"none","reports":"full","users":"none","settings":"none","ai":"none","brain":"none","chat":"view","portal":"none"}},
    {"key":"total","name":"Total","permissions":{"clients":"full","briefing":"full","projects":"full","tasks":"full","planning":"full","content":"full","calendar":"full","approvals":"full","media_plans":"full","connections":"full","reports":"full","users":"full","settings":"full","ai":"full","brain":"full","chat":"full","portal":"full"}}
  ]'::jsonb;
$$;

CREATE OR REPLACE FUNCTION public.seed_access_profiles(_brand_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item jsonb;
  n integer := 0;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(public.access_profiles_system_defaults())
  LOOP
    INSERT INTO public.access_profiles (brand_id, key, name, is_system, permissions)
    VALUES (_brand_id, item->>'key', item->>'name', true, item->'permissions')
    ON CONFLICT (brand_id, key) DO UPDATE
      SET name = CASE WHEN public.access_profiles.is_system THEN EXCLUDED.name ELSE public.access_profiles.name END;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_access_profiles_for_new_brand()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.seed_access_profiles(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brands_seed_access_profiles ON public.brands;
CREATE TRIGGER trg_brands_seed_access_profiles
  AFTER INSERT ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.seed_access_profiles_for_new_brand();

DO $$
DECLARE b record;
BEGIN
  FOR b IN SELECT id FROM public.brands LOOP
    PERFORM public.seed_access_profiles(b.id);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- Resolução efetiva das permissões por módulo
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_module_permissions(_user_id uuid, _brand_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_profile jsonb := '{}'::jsonb;
  v_override jsonb := '{}'::jsonb;
  v_total jsonb;
BEGIN
  IF _user_id IS NULL OR _brand_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT (public.access_profiles_system_defaults() -> 6) -> 'permissions' INTO v_total;

  IF public.is_super_admin(_user_id) THEN
    RETURN v_total;
  END IF;

  SELECT lower(bm.role),
         COALESCE(ap.permissions, '{}'::jsonb),
         COALESCE(bm.module_permissions, '{}'::jsonb)
    INTO v_role, v_profile, v_override
    FROM public.brand_members bm
    LEFT JOIN public.access_profiles ap ON ap.id = bm.access_profile_id
   WHERE bm.brand_id = _brand_id AND bm.user_id = _user_id;

  IF v_role IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  IF v_role IN ('owner','admin','manager') THEN
    RETURN v_total;
  END IF;

  RETURN v_profile || v_override;
END;
$$;

CREATE OR REPLACE FUNCTION public.module_level_rank(_level text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(COALESCE(_level,'none'))
    WHEN 'full' THEN 3
    WHEN 'own' THEN 2
    WHEN 'view' THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_module_access(
  _user_id uuid, _brand_id uuid, _module text, _min_level text DEFAULT 'view'
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.module_level_rank(
           public.effective_module_permissions(_user_id, _brand_id) ->> _module
         ) >= public.module_level_rank(_min_level);
$$;

REVOKE ALL ON FUNCTION public.seed_access_profiles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_access_profiles(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.effective_module_permissions(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_module_access(uuid, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.module_level_rank(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.access_profiles_system_defaults() TO authenticated, service_role;