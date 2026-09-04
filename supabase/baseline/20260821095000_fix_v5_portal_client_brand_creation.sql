-- V5 — PORTAL_CLIENT não pode criar Brand (e portanto não vira OWNER).
--
-- Problema: a policy "any auth creates brand" permitia INSERT em public.brands
-- para QUALQUER usuário autenticado. Um usuário exclusivamente do Portal
-- (client_members.role = 'portal_client', sem vínculo interno em brand_members)
-- conseguia criar uma Brand e o trigger add_brand_owner() o promovia a OWNER,
-- rompendo o isolamento entre Portal e área interna.
--
-- Regra de produto: criação de Brand é exclusiva de usuários internos
-- (user, manager, owner) e de super admins. Usuários sem nenhum vínculo
-- continuam podendo criar a primeira Brand (onboarding self-serve); apenas
-- quem é portal_client e não tem vínculo interno é bloqueado.
--
-- Forward-only. Nenhuma migration histórica é alterada.

CREATE OR REPLACE FUNCTION public.can_create_brand(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    AND (
      public.is_super_admin(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.brand_members bm
         WHERE bm.user_id = _user_id
           AND bm.is_active
           AND bm.role IN ('owner', 'manager', 'user')
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.client_members cm
         WHERE cm.user_id = _user_id
           AND cm.role = 'portal_client'
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_create_brand(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_brand(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "any auth creates brand" ON public.brands;
DROP POLICY IF EXISTS "internal users create brand" ON public.brands;

CREATE POLICY "internal users create brand"
ON public.brands
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.can_create_brand(auth.uid())
);
