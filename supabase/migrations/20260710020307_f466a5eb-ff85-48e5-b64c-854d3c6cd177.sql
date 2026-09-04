
-- Restrict user_profiles SELECT to self + users sharing a brand membership
DROP POLICY IF EXISTS "Autenticados veem perfis" ON public.user_profiles;

CREATE POLICY "Users see own profile"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Users see profiles of shared brand members"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.brand_members bm_self
    JOIN public.brand_members bm_other
      ON bm_other.brand_id = bm_self.brand_id
    WHERE bm_self.user_id = auth.uid()
      AND bm_other.user_id = public.user_profiles.id
  )
);

-- Lock down SECURITY DEFINER functions from anon / PUBLIC
REVOKE ALL ON FUNCTION public.accept_brand_invite(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_brand_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_brand_role(uuid, uuid, public.app_role) FROM PUBLIC, anon;

-- Helper functions used by RLS must stay callable only by authenticated (already the case);
-- ensure grants are explicit and minimal
GRANT EXECUTE ON FUNCTION public.accept_brand_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_brand_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_brand_role(uuid, uuid, public.app_role) TO authenticated;
