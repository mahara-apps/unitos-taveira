-- =============================================================================
-- BASELINE PRÉ-VERSIONAMENTO  (Unitos)
-- ARQUIVO EM STAGING: ver supabase/baseline/README.md antes de usar.
-- Nome-alvo final: supabase/migrations/20260101000000_baseline_pre_versioning.sql
-- =============================================================================
-- Objetivo: recriar, em uma instância Supabase VAZIA, os objetos que existem no
-- banco de produção mas nunca foram versionados em supabase/migrations/.
-- Foram criados manualmente antes do início do versionamento (04/07/2026) e são
-- pré-requisito da primeira migration versionada (20260707030537_...), que já os
-- assume existentes.
--
-- Objetos cobertos:
--   1. public.update_updated_at_column()  -- usada por 30+ triggers desde a 1a migration
--   2. public.user_profiles               -- unica tabela com ALTER sem CREATE no repo
--
-- PROPRIEDADES:
--   * 100% IDEMPOTENTE: aplicar em producao seria no-op.
--   * NAO reproduz o ACL historico insaguro (anon = ALL).
--   * Contem SOMENTE o estado anterior a primeira migration que altera
--     user_profiles. Colunas adicionadas depois (requires_password_change, phone,
--     timezone, locale, job_title, bio, is_super_admin, whatsapp, notify_whatsapp,
--     notification_prefs), o CHECK de role e as policies posteriores NAO entram
--     aqui: sao responsabilidade das migrations historicas.
--
-- EM PRODUCAO: seguro. Todo o conteudo e idempotente e a policy historica
-- permissiva so e recriada quando a tabela nao possui nenhuma outra policy
-- (cenario exclusivo de instalacao limpa).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. public.update_updated_at_column()
-- -----------------------------------------------------------------------------
-- Definicao identica a existente hoje em producao (verificada via
-- pg_get_functiondef). Nao simplificar: 30+ triggers BEFORE UPDATE dependem do
-- comportamento exato (NEW.updated_at = now(); RETURN NEW).
-- O search_path ja vem definido aqui; a migration historica 20260707030621
-- executa `ALTER FUNCTION ... SET search_path = public` sobre ela (idempotente).
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

-- Privilegios minimos: triggers rodam como owner da tabela; nenhuma role
-- anonima ou autenticada precisa de EXECUTE direto.
-- (As migrations 20260715030950 e 20260715161725 reforcam esses REVOKEs.)
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;

-- -----------------------------------------------------------------------------
-- 2. public.user_profiles
-- -----------------------------------------------------------------------------
-- Estrutura original (reconstruida a partir do primeiro types.ts gerado e do
-- estado atual do banco), com uma unica correcao deliberada: o DEFAULT de `role`
-- passa a ser 'user' em vez do historico 'editor', incompativel com o CHECK
-- introduzido por 20260819150650 (admin|manager|user|super_admin).
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text        NOT NULL,
  role        text        NOT NULL DEFAULT 'user',
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- RLS e a camada de seguranca efetiva desta tabela.
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Trigger historico de updated_at (nome preservado; migrations posteriores
-- assumem esta tabela com o trigger ja ativo).
DROP TRIGGER IF EXISTS update_user_profiles_modtime ON public.user_profiles;
CREATE TRIGGER update_user_profiles_modtime
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Policy historica de leitura. Existia no banco pre-versionamento e e removida
-- pela migration 20260710020307 (`-- Policy historica de leitura. Existia no banco pre-versionamento e e removida
-- pela migration 20260710020307. Recriada APENAS quando a tabela acabou de ser
-- criada por este arquivo (instalacao limpa): em producao, onde as policies
-- restritas de 20260710020307 ja estao ativas, este bloco e um no-op absoluto.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'user_profiles'
       AND policyname <> 'Autenticados veem perfis'
  ) THEN
    DROP POLICY IF EXISTS "Autenticados veem perfis" ON public.user_profiles;
    CREATE POLICY "Autenticados veem perfis"
      ON public.user_profiles
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- Privilegios minimos (NAO replicar o ACL historico: anon tinha arwdDxtm).
REVOKE ALL ON TABLE public.user_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_profiles TO authenticated;
GRANT ALL ON TABLE public.user_profiles TO service_role;
