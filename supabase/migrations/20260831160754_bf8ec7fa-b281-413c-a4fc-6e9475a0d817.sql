-- 1) Fonte canônica única de "autoridade de integração" (exclui MANAGER).
CREATE OR REPLACE FUNCTION public.is_brand_integration_authority(_brand_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (
       public.is_super_admin(_user_id)
       OR (_brand_id IS NOT NULL
           AND public.app_access_role(_user_id, _brand_id) IN ('super_admin', 'admin'))
     );
$function$;

GRANT EXECUTE ON FUNCTION public.is_brand_integration_authority(uuid, uuid) TO authenticated, service_role;

-- 2) meta_oauth_sessions: a autorização Meta pertence ao WORKSPACE.
DROP POLICY IF EXISTS "Users can read own meta sessions" ON public.meta_oauth_sessions;
DROP POLICY IF EXISTS "Users can update own meta sessions" ON public.meta_oauth_sessions;
DROP POLICY IF EXISTS "Users can delete own meta sessions" ON public.meta_oauth_sessions;
DROP POLICY IF EXISTS "meta_sessions_select_brand_authority" ON public.meta_oauth_sessions;
DROP POLICY IF EXISTS "meta_sessions_insert_brand_authority" ON public.meta_oauth_sessions;
DROP POLICY IF EXISTS "meta_sessions_update_brand_authority" ON public.meta_oauth_sessions;
DROP POLICY IF EXISTS "meta_sessions_delete_brand_authority" ON public.meta_oauth_sessions;

ALTER TABLE public.meta_oauth_sessions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_oauth_sessions TO authenticated;
GRANT ALL ON public.meta_oauth_sessions TO service_role;

CREATE POLICY "meta_sessions_select_brand_authority"
ON public.meta_oauth_sessions FOR SELECT TO authenticated
USING (
  public.is_brand_integration_authority(brand_id, auth.uid())
  OR user_id = auth.uid()
);

CREATE POLICY "meta_sessions_insert_brand_authority"
ON public.meta_oauth_sessions FOR INSERT TO authenticated
WITH CHECK (public.is_brand_integration_authority(brand_id, auth.uid()));

CREATE POLICY "meta_sessions_update_brand_authority"
ON public.meta_oauth_sessions FOR UPDATE TO authenticated
USING (public.is_brand_integration_authority(brand_id, auth.uid()))
WITH CHECK (public.is_brand_integration_authority(brand_id, auth.uid()));

CREATE POLICY "meta_sessions_delete_brand_authority"
ON public.meta_oauth_sessions FOR DELETE TO authenticated
USING (public.is_brand_integration_authority(brand_id, auth.uid()));

-- 3) social_connections: escrita só com autoridade de integração.
DROP POLICY IF EXISTS "social_connections admins insert" ON public.social_connections;
DROP POLICY IF EXISTS "social_connections admins update" ON public.social_connections;
DROP POLICY IF EXISTS "social_connections admins delete" ON public.social_connections;

CREATE POLICY "social_connections admins insert"
ON public.social_connections FOR INSERT TO authenticated
WITH CHECK (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
);

CREATE POLICY "social_connections admins update"
ON public.social_connections FOR UPDATE TO authenticated
USING (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
)
WITH CHECK (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
);

CREATE POLICY "social_connections admins delete"
ON public.social_connections FOR DELETE TO authenticated
USING (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
);

-- 4) client_social_accounts: mesma autoridade.
DROP POLICY IF EXISTS "csa admins insert" ON public.client_social_accounts;
DROP POLICY IF EXISTS "csa admins update" ON public.client_social_accounts;
DROP POLICY IF EXISTS "csa admins delete" ON public.client_social_accounts;

CREATE POLICY "csa admins insert"
ON public.client_social_accounts FOR INSERT TO authenticated
WITH CHECK (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
);

CREATE POLICY "csa admins update"
ON public.client_social_accounts FOR UPDATE TO authenticated
USING (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
)
WITH CHECK (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
);

CREATE POLICY "csa admins delete"
ON public.client_social_accounts FOR DELETE TO authenticated
USING (
  public.is_brand_integration_authority(brand_id, auth.uid())
  AND public.client_in_scope(client_id, brand_id)
);

-- 5) brands: configurar o workspace é ação de Owner/Admin/Super Admin.
DROP POLICY IF EXISTS "admin level updates brand" ON public.brands;
CREATE POLICY "admin level updates brand"
ON public.brands FOR UPDATE TO authenticated
USING (public.is_brand_integration_authority(id, auth.uid()))
WITH CHECK (public.is_brand_integration_authority(id, auth.uid()));