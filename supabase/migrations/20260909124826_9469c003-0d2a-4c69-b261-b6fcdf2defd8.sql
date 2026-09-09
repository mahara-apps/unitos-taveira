REVOKE EXECUTE ON FUNCTION public.post_copy_queue_drain_on() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.post_copy_queue_drain_off() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.post_copy_queue_notify() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.post_copy_queue_drain_on() TO service_role;
GRANT EXECUTE ON FUNCTION public.post_copy_queue_drain_off() TO service_role;