CREATE OR REPLACE FUNCTION public.ai_scope_readable(_client_id uuid, _brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _brand_id IS NOT NULL
     AND public.is_brand_member(_brand_id, auth.uid())
     AND CASE
           WHEN _client_id IS NOT NULL THEN public.can_access_client(_client_id, auth.uid())
           -- Sem cliente definido o registro é brand-level (sensível):
           -- somente autoridade de workspace pode ler.
           ELSE public.app_access_role(auth.uid(), _brand_id)
                  = ANY (ARRAY['super_admin'::text, 'admin'::text])
         END;
$$;

REVOKE ALL ON FUNCTION public.ai_scope_readable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_scope_readable(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "brain_memory select in client scope" ON public.brain_memory;
CREATE POLICY "brain_memory select in client scope"
ON public.brain_memory
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.ai_scope_readable(client_id, brand_id));

DROP POLICY IF EXISTS "brain_insights select in client scope" ON public.brain_insights;
CREATE POLICY "brain_insights select in client scope"
ON public.brain_insights
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.ai_scope_readable(client_id, brand_id));

DROP POLICY IF EXISTS "ai usage in client scope read" ON public.brand_ai_usage;
CREATE POLICY "ai usage in client scope read"
ON public.brand_ai_usage
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.ai_scope_readable(client_id, brand_id));