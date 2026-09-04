-- V3 — public.emit_brain_event(...)
--
-- Problema: a função é SECURITY DEFINER e estava com EXECUTE concedido a
-- `authenticated` (concedido em massa pela migration 20260812124704 via
-- `auth_keep`). Como ela aceita `p_brand_id` e `p_actor_id` arbitrários e
-- insere direto em public.brain_events com privilégios do owner, qualquer
-- usuário autenticado podia gravar eventos em OUTRA marca e falsificar o ator.
--
-- Decisão: REVOGAR EXECUTE de PUBLIC/anon/authenticated e manter apenas
-- service_role. Auditoria de callers mostrou que NENHUM caminho do frontend
-- chama esta RPC: o único caminho de escrita da aplicação é o event-bus
-- (`src/lib/brain/event-bus`), que faz INSERT direto em brain_events sob RLS.
-- Os demais callers são triggers internos (brain_trg_*), todos SECURITY
-- DEFINER, que executam a função com os privilégios do owner e portanto
-- continuam funcionando após a revogação.
--
-- Não forçamos `actor_id = auth.uid()` dentro da função porque os triggers
-- legítimos precisam registrar o ator real do domínio (NEW.author_id em
-- task_comments, NEW.reviewer_id em post_approvals), o que quebraria a
-- rastreabilidade. Sem EXECUTE para authenticated não existe mais caminho de
-- chamada com brand_id/actor_id arbitrários.
--
-- Idempotente e independente de assinatura: itera por nome em pg_proc.
-- Não altera a lógica da função, RLS do Brain, grants de tabelas nem V1/V2.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'emit_brain_event'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.emit_brain_event(uuid,text,text,uuid,text,uuid,text,uuid,uuid,jsonb,numeric,uuid)
IS 'Event bus interno do Brain. EXECUTE restrito a service_role e a triggers SECURITY DEFINER (V3): aceita brand_id/actor_id arbitrários, portanto NUNCA deve ser exposta a anon/authenticated.';
