REVOKE ALL ON FUNCTION public.can_access_project(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_project(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_project(uuid, uuid) TO authenticated, service_role;