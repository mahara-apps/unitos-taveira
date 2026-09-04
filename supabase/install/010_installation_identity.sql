-- =============================================================================
-- 010_installation_identity.sql — identidade da PRÓPRIA instalação.
-- Idempotente. Não copia dado de negócio. Não cria marca, cliente ou usuário.
--
-- Requer a variável psql :app_url (origem https da própria instalação).
--   psql "$SUPABASE_DB_URL" -v app_url="https://minha-instalacao.com" -f 010_installation_identity.sql
-- =============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_url text := :'app_url';
BEGIN
  IF v_url IS NULL OR btrim(v_url) = '' THEN
    RAISE EXCEPTION 'app_url ausente: informe a URL pública desta instalação';
  END IF;
  IF v_url !~ '^https://[a-zA-Z0-9._-]+(:[0-9]+)?$' THEN
    RAISE EXCEPTION 'app_url inválida (%): use somente a origem https, sem path/query', v_url;
  END IF;
  -- Guard anti-MASTER: nenhuma instalação nova pode herdar a identidade do MASTER.
  IF lower(v_url) LIKE '%unitos-master.lovable.app%'
     OR lower(v_url) LIKE '%tkjbhttylouamqxnbfgv%' THEN
    RAISE EXCEPTION 'app_url aponta para o MASTER (%): instalação não é independente', v_url;
  END IF;

  INSERT INTO public.installation (id, app_url)
  VALUES (true, v_url)
  ON CONFLICT (id) DO UPDATE SET app_url = EXCLUDED.app_url, updated_at = now();
END $$;

-- Confirmação legível (read-only).
SELECT 'installation.app_url' AS item, app_url AS value FROM public.installation;
