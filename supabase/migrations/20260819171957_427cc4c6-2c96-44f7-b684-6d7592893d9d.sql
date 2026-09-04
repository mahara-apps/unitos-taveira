CREATE OR REPLACE FUNCTION public.is_portal_client_of(_client_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _client_id IS NOT NULL AND _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.client_members cm
     WHERE cm.client_id = _client_id
       AND cm.user_id = _user_id
       AND cm.role = 'portal_client'
  );
$$;

REVOKE ALL ON FUNCTION public.is_portal_client_of(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.is_portal_client_of(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_portal_client_of(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "clients read in scope" ON public.clients;
CREATE POLICY "clients read in scope" ON public.clients
FOR SELECT TO authenticated
USING (
  public.can_access_client_row(id, brand_id, owner_user_id, auth.uid())
  OR public.is_portal_client_of(id, auth.uid())
);

DROP POLICY IF EXISTS "posts read scoped" ON public.posts;
CREATE POLICY "posts read scoped" ON public.posts
FOR SELECT TO authenticated
USING (
  (public.can_access_client(client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), brand_id))
  OR (
    public.is_portal_client_of(client_id, auth.uid())
    AND visible_in_portal IS TRUE
    AND deleted_at IS NULL
  )
);

DROP POLICY IF EXISTS "approvals read scoped" ON public.post_approvals;
CREATE POLICY "approvals read scoped" ON public.post_approvals
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.posts p
     WHERE p.id = post_approvals.post_id
       AND (
         (public.can_access_client(p.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), p.brand_id))
         OR (
           public.is_portal_client_of(p.client_id, auth.uid())
           AND p.visible_in_portal IS TRUE
           AND p.deleted_at IS NULL
         )
       )
  )
);

DROP POLICY IF EXISTS "plans read scoped" ON public.monthly_plans;
CREATE POLICY "plans read scoped" ON public.monthly_plans
FOR SELECT TO authenticated
USING (
  public.can_access_client(client_id, auth.uid())
  OR public.is_portal_client_of(client_id, auth.uid())
);

DROP POLICY IF EXISTS "brand members access briefings" ON public.brand_briefings;
CREATE POLICY "brand members access briefings" ON public.brand_briefings
FOR ALL TO authenticated
USING (public.can_access_client(client_id, auth.uid()))
WITH CHECK (public.can_access_client(client_id, auth.uid()));

DROP POLICY IF EXISTS "portal client reads own briefing" ON public.brand_briefings;
CREATE POLICY "portal client reads own briefing" ON public.brand_briefings
FOR SELECT TO authenticated
USING (public.is_portal_client_of(client_id, auth.uid()));
