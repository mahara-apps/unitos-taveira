-- V4 — public.brain_memory_decay_and_archive()
--
-- Problema: função global de manutenção (aplica decay e arquiva memórias de
-- TODAS as marcas) estava com EXECUTE concedido a `authenticated` (migration
-- 20260812124704, lista `auth_keep`). Sem validação de ator ou de tenant,
-- qualquer usuário autenticado podia disparar o arquivamento global.
--
-- Decisão: REVOGAR EXECUTE de PUBLIC/anon/authenticated, mantendo apenas
-- service_role. A lógica interna NÃO é alterada — é exclusivamente
-- worker/manutenção. Auditoria de callers: o único consumidor é
-- `src/lib/brain/memory/index.ts` -> `decay(ctx)` (exposto como
-- `brain.decayMemories`), que não é chamado por nenhuma rota/UI e roda apenas
-- em contexto de servidor (service_role). Nenhum caller de frontend.
--
-- Idempotente e independente de assinatura: itera por nome em pg_proc.
-- Não altera RLS do Brain, grants de tabelas, funções canônicas nem V1/V2/V3.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'brain_memory_decay_and_archive'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
