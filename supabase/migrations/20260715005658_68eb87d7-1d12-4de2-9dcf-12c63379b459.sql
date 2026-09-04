
-- 1. Flag
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS user_profiles_is_super_admin_idx
  ON public.user_profiles (is_super_admin) WHERE is_super_admin;

-- 2. Helper (SECURITY DEFINER evita recursão em RLS)
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_super_admin FROM public.user_profiles WHERE id = _user_id), false);
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

-- 3. Esconder super admins das listagens de perfis
DROP POLICY IF EXISTS "Users see profiles of shared brand members" ON public.user_profiles;
CREATE POLICY "Users see profiles of shared brand members"
  ON public.user_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_members bm_self
      JOIN public.brand_members bm_other ON bm_other.brand_id = bm_self.brand_id
      WHERE bm_self.user_id = auth.uid()
        AND bm_other.user_id = user_profiles.id
    )
    AND (
      NOT public.is_super_admin(user_profiles.id)
      OR public.is_super_admin(auth.uid())
    )
  );

-- 4. Esconder super admins das listagens de membros de brand
DROP POLICY IF EXISTS "members read brand memberships" ON public.brand_members;
CREATE POLICY "members read brand memberships"
  ON public.brand_members FOR SELECT
  USING (
    (
      user_id = auth.uid()
      OR public.is_brand_member(brand_id, auth.uid())
    )
    AND (
      NOT public.is_super_admin(brand_members.user_id)
      OR public.is_super_admin(auth.uid())
    )
  );
