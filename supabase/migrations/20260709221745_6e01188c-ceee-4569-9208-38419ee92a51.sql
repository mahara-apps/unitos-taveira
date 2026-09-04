-- Ensure Data API privileges exist for authenticated app tables
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.brands TO service_role;
GRANT ALL ON public.brand_members TO service_role;
GRANT ALL ON public.clients TO service_role;

-- Helper functions used by RLS policies must be callable by authenticated users.
GRANT EXECUTE ON FUNCTION public.is_brand_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_brand_role(uuid, uuid, app_role) TO authenticated;

-- Keep add_brand_owner as internal DB automation but make it robust/idempotent.
CREATE OR REPLACE FUNCTION public.add_brand_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.brand_members (brand_id, user_id, role)
    VALUES (NEW.id, NEW.created_by, 'owner')
    ON CONFLICT (brand_id, user_id) DO UPDATE SET role = 'owner';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.add_brand_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_brand_owner() TO service_role;

DROP TRIGGER IF EXISTS on_brand_created_add_owner ON public.brands;
DROP TRIGGER IF EXISTS trg_brands_add_owner ON public.brands;
CREATE TRIGGER trg_brands_add_owner
AFTER INSERT ON public.brands
FOR EACH ROW
EXECUTE FUNCTION public.add_brand_owner();

-- Tighten brand_members policies: users can read relevant memberships; only owners can manage members.
DROP POLICY IF EXISTS "members read own memberships" ON public.brand_members;
DROP POLICY IF EXISTS "owner manages members" ON public.brand_members;
DROP POLICY IF EXISTS "owners manage brand members" ON public.brand_members;

CREATE POLICY "members read brand memberships"
ON public.brand_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_brand_member(brand_id, auth.uid()));

CREATE POLICY "owners manage brand members"
ON public.brand_members
FOR ALL
TO authenticated
USING (public.has_brand_role(brand_id, auth.uid(), 'owner'))
WITH CHECK (public.has_brand_role(brand_id, auth.uid(), 'owner'));
