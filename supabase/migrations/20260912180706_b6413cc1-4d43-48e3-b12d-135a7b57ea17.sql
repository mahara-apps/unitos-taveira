REVOKE ALL ON FUNCTION public.clean_mention_tokens(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clean_mention_tokens(text) TO service_role;

REVOKE ALL ON FUNCTION public.sanitize_mention_body() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_mention_body() TO service_role;

REVOKE ALL ON FUNCTION public.bump_message_thread() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_message_thread() TO service_role;