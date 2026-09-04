REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_task_activity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_post_activity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_brand_owner() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.log_task_activity() TO service_role;
GRANT EXECUTE ON FUNCTION public.log_post_activity() TO service_role;
GRANT EXECUTE ON FUNCTION public.add_brand_owner() TO service_role;
