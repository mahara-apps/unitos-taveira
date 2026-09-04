-- FASE 10D.2 — fechamento do escopo NULL (workspace-level) em
-- projects / tasks / activity_events. Nenhuma função nova: reutiliza
-- app_access_role + can_access_client + is_agency_operator.

-- 1) projects
DROP POLICY IF EXISTS "projects read in scope" ON public.projects;
CREATE POLICY "projects read in scope" ON public.projects
  FOR SELECT TO authenticated
  USING (
    CASE WHEN client_id IS NULL
      THEN public.app_access_role(auth.uid(), brand_id) IN ('super_admin', 'admin')
      ELSE public.can_access_client(client_id, auth.uid())
    END
  );

DROP POLICY IF EXISTS "projects write agency only" ON public.projects;
CREATE POLICY "projects write agency only" ON public.projects
  FOR ALL TO authenticated
  USING (
    public.is_agency_operator(auth.uid(), brand_id)
    AND CASE WHEN client_id IS NULL
      THEN public.app_access_role(auth.uid(), brand_id) IN ('super_admin', 'admin')
      ELSE public.can_access_client(client_id, auth.uid())
    END
  )
  WITH CHECK (
    public.is_agency_operator(auth.uid(), brand_id)
    AND CASE WHEN client_id IS NULL
      THEN public.app_access_role(auth.uid(), brand_id) IN ('super_admin', 'admin')
      ELSE public.can_access_client(client_id, auth.uid())
    END
  );

-- 2) tasks
DROP POLICY IF EXISTS "tasks read in scope" ON public.tasks;
CREATE POLICY "tasks read in scope" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    CASE WHEN client_id IS NULL
      THEN public.app_access_role(auth.uid(), brand_id) IN ('super_admin', 'admin')
      ELSE public.can_access_client(client_id, auth.uid())
    END
  );

DROP POLICY IF EXISTS "tasks write agency only" ON public.tasks;
CREATE POLICY "tasks write agency only" ON public.tasks
  FOR ALL TO authenticated
  USING (
    public.is_agency_operator(auth.uid(), brand_id)
    AND CASE WHEN client_id IS NULL
      THEN public.app_access_role(auth.uid(), brand_id) IN ('super_admin', 'admin')
      ELSE public.can_access_client(client_id, auth.uid())
    END
  )
  WITH CHECK (
    public.is_agency_operator(auth.uid(), brand_id)
    AND CASE WHEN client_id IS NULL
      THEN public.app_access_role(auth.uid(), brand_id) IN ('super_admin', 'admin')
      ELSE public.can_access_client(client_id, auth.uid())
    END
  );

-- 3) activity_events (somente leitura para authenticated; escrita via
--    triggers SECURITY DEFINER / service_role)
DROP POLICY IF EXISTS "brand members read activity" ON public.activity_events;
CREATE POLICY "brand members read activity" ON public.activity_events
  FOR SELECT TO authenticated
  USING (
    CASE WHEN client_id IS NULL
      THEN public.app_access_role(auth.uid(), brand_id) IN ('super_admin', 'admin')
      ELSE public.can_access_client(client_id, auth.uid())
    END
  );

-- 4) Cadeia herdada: can_access_project / can_access_task deixam de
--    conceder acesso a registro NULL por simples membership.
CREATE OR REPLACE FUNCTION public.can_access_project(_project_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = _project_id
       AND public.is_brand_member(p.brand_id, _user_id)
       AND CASE WHEN p.client_id IS NULL
             THEN public.app_access_role(_user_id, p.brand_id) IN ('super_admin', 'admin')
             ELSE public.can_access_client(p.client_id, _user_id)
           END
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_access_task(_task_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
     WHERE t.id = _task_id
       AND public.is_brand_member(t.brand_id, _user_id)
       AND CASE WHEN t.client_id IS NULL
             THEN public.app_access_role(_user_id, t.brand_id) IN ('super_admin', 'admin')
             ELSE public.can_access_client(t.client_id, _user_id)
           END
       AND (t.project_id IS NULL OR public.can_access_project(t.project_id, _user_id))
  );
$function$;