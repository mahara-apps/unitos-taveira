-- 1) Anti-escalonamento: is_super_admin não pode ser alterado pelo próprio usuário.
CREATE OR REPLACE FUNCTION public.guard_super_admin_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.is_super_admin, false) IS DISTINCT FROM COALESCE(OLD.is_super_admin, false) THEN
    -- auth.uid() nulo = rotina interna (service role / SQL administrativo).
    IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Forbidden: apenas super admin altera is_super_admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_super_admin_flag ON public.user_profiles;
CREATE TRIGGER trg_guard_super_admin_flag
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_flag();

-- 2) Portal do cliente é leitura: escrita em projects/tasks só para a equipe.
CREATE OR REPLACE FUNCTION public.is_agency_operator(_user_id uuid, _brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.app_access_role(_user_id, _brand_id) IN ('super_admin', 'admin', 'manager', 'user');
$function$;

REVOKE ALL ON FUNCTION public.is_agency_operator(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_agency_operator(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "brand members manage tasks" ON public.tasks;
CREATE POLICY "tasks read in scope"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    CASE WHEN client_id IS NULL THEN public.is_brand_member(brand_id, auth.uid())
         ELSE public.can_access_client(client_id, auth.uid()) END
  );
CREATE POLICY "tasks write agency only"
  ON public.tasks FOR ALL TO authenticated
  USING (
    public.is_agency_operator(auth.uid(), brand_id)
    AND (CASE WHEN client_id IS NULL THEN public.is_brand_member(brand_id, auth.uid())
              ELSE public.can_access_client(client_id, auth.uid()) END)
  )
  WITH CHECK (
    public.is_agency_operator(auth.uid(), brand_id)
    AND (CASE WHEN client_id IS NULL THEN public.is_brand_member(brand_id, auth.uid())
              ELSE public.can_access_client(client_id, auth.uid()) END)
  );

DROP POLICY IF EXISTS "brand members manage projects" ON public.projects;
CREATE POLICY "projects read in scope"
  ON public.projects FOR SELECT TO authenticated
  USING (
    CASE WHEN client_id IS NULL THEN public.is_brand_member(brand_id, auth.uid())
         ELSE public.can_access_client(client_id, auth.uid()) END
  );
CREATE POLICY "projects write agency only"
  ON public.projects FOR ALL TO authenticated
  USING (
    public.is_agency_operator(auth.uid(), brand_id)
    AND (CASE WHEN client_id IS NULL THEN public.is_brand_member(brand_id, auth.uid())
              ELSE public.can_access_client(client_id, auth.uid()) END)
  )
  WITH CHECK (
    public.is_agency_operator(auth.uid(), brand_id)
    AND (CASE WHEN client_id IS NULL THEN public.is_brand_member(brand_id, auth.uid())
              ELSE public.can_access_client(client_id, auth.uid()) END)
  );