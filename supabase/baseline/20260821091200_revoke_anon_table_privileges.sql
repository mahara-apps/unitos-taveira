-- =============================================================================
-- FORWARD-ONLY (staging) — Defesa em profundidade: remove privilégios de tabela
-- do role `anon` no schema public.
--
-- Contexto: ~89 tabelas de public tinham SELECT/INSERT/UPDATE/DELETE concedidos
-- a `anon` por herança histórica. Hoje o RLS nega o acesso (nenhuma policy
-- concede `anon`; as policies `{public}` existentes dependem de auth.uid()),
-- mas qualquer policy futura mal escrita passaria a expor dados a não
-- autenticados.
--
-- Verificação prévia (auditoria): nenhuma tabela de public precisa de acesso
-- direto por `anon`. O Portal público usa exclusivamente RPCs SECURITY DEFINER
-- (portal_resolve, portal_rate_status, portal_rate_register_failure, portal_*,
-- _portal_session*), e as rotas públicas por token usam server functions com
-- service_role. A única exceção é `storage.objects`
-- (policy portal_anon_read_brand_assets), que NÃO é tocada aqui.
--
-- Preservado: privilégios de `authenticated` e `service_role`, RLS, policies,
-- USAGE no schema public para `anon` e EXECUTE das funções públicas do Portal.
-- =============================================================================

DO $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')          -- tabelas e tabelas particionadas
  LOOP
    EXECUTE format(
      'REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon',
      r.relname
    );
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'anon table privileges revoked on % public tables', v_count;
END $$;

-- Sequências: `anon` não insere em nenhuma tabela de public.
REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Impede que novos objetos criados por estes roles voltem a conceder `anon`.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon;

-- `anon` continua com USAGE no schema para poder chamar as RPCs do Portal.
GRANT USAGE ON SCHEMA public TO anon;
