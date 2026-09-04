
-- search_path fix para função pré-existente
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;

-- Revogar EXECUTE público em todas as SECURITY DEFINER
REVOKE ALL ON FUNCTION public.is_brand_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_brand_role(uuid, uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_brand_owner() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_task_activity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_post_activity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_brand_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_brand_role(uuid, uuid, public.app_role) TO authenticated, service_role;
-- triggers são invocados pelo owner, service_role é suficiente
GRANT EXECUTE ON FUNCTION public.add_brand_owner() TO service_role;
GRANT EXECUTE ON FUNCTION public.log_task_activity() TO service_role;
GRANT EXECUTE ON FUNCTION public.log_post_activity() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
