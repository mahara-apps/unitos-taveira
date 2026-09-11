REVOKE ALL ON FUNCTION public.protect_pipeline_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_pipeline_delete() TO service_role;