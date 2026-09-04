-- V6 — block_unusable_scheduled_social_posts: remover EXECUTE herdado de PUBLIC
--
-- Contexto: public.block_unusable_scheduled_social_posts() é SECURITY DEFINER e
-- faz sweep fail-closed de agendamentos vencidos cujo destino não é mais
-- utilizável (conexão removida/inativa, token ausente, conta desvinculada),
-- marcando-os como `blocked`/`connection_required`.
--
-- A migration histórica 20260817175958 fez apenas
--   REVOKE ALL ... FROM anon, authenticated;
-- o que NÃO remove o privilégio efetivo: no PostgreSQL funções recebem EXECUTE
-- para PUBLIC por padrão, e anon/authenticated herdam de PUBLIC. Por isso o
-- scanner segue reportando EXECUTE para anon.
--
-- Escopo desta migration: SOMENTE privilégios de EXECUTE desta função.
-- Não altera a implementação da função, nenhuma função canônica, nenhuma RLS
-- de tabela e nenhum grant de tabela. Não toca V1–V5.
--
-- Caller legítimo: src/routes/api/public/meta/publish-scheduled.ts, via
-- supabaseAdmin (service_role) — protegido por CRON_SECRET.

REVOKE ALL ON FUNCTION public.block_unusable_scheduled_social_posts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_unusable_scheduled_social_posts() FROM anon;
REVOKE ALL ON FUNCTION public.block_unusable_scheduled_social_posts() FROM authenticated;

GRANT EXECUTE ON FUNCTION public.block_unusable_scheduled_social_posts() TO service_role;

COMMENT ON FUNCTION public.block_unusable_scheduled_social_posts() IS
  'Uso interno (service_role / worker publish-scheduled). EXECUTE revogado de PUBLIC, anon e authenticated (V6).';
