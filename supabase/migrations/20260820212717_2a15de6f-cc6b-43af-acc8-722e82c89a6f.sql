-- V6 — block_unusable_scheduled_social_posts: remover EXECUTE herdado de PUBLIC
-- Escopo: SOMENTE privilégios de EXECUTE desta função. Não altera implementação,
-- RLS, policies, tabelas, outras funções ou dados.
REVOKE ALL ON FUNCTION public.block_unusable_scheduled_social_posts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_unusable_scheduled_social_posts() FROM anon;
REVOKE ALL ON FUNCTION public.block_unusable_scheduled_social_posts() FROM authenticated;

GRANT EXECUTE ON FUNCTION public.block_unusable_scheduled_social_posts() TO service_role;

COMMENT ON FUNCTION public.block_unusable_scheduled_social_posts() IS
  'Uso interno (service_role / worker publish-scheduled). EXECUTE revogado de PUBLIC, anon e authenticated (V6).';