-- =============================================================================
-- FORWARD-ONLY. ARQUIVO EM STAGING: ver supabase/baseline/README.md.
-- Nome-alvo final:
--   supabase/migrations/20260821090300_fix_user_profiles_privilege_escalation.sql
-- =============================================================================
-- VULNERABILIDADE CORRIGIDA (critica, escalacao de privilegio)
-- -----------------------------------------------------------------------------
-- Reproduzida em clone descartavel; os objetos sao identicos em producao.
--
--   -- autenticado como USER comum:
--   UPDATE public.user_profiles SET role = 'super_admin' WHERE id = auth.uid();
--   -- => SUCESSO, virava super admin global
--
-- Causa raiz (3 fatores combinados):
--   1. Policy de UPDATE "Usuarios atualizam proprio perfil" e apenas
--      auth.uid() = id, em USING e WITH CHECK. RLS nao restringe COLUNAS, logo
--      o dono da linha podia gravar qualquer coluna, inclusive `role`.
--   2. GRANT UPDATE para `authenticated` e a nivel de TABELA (todas as colunas,
--      incluindo `role` e `is_super_admin`).
--   3. O trigger trg_guard_super_admin_flag / guard_super_admin_flag() so
--      comparava a coluna `is_super_admin`; `role` ficava sem qualquer guarda.
--      E public.is_super_admin(uuid) considera
--      `is_super_admin = true OR role = 'super_admin'`, entao gravar `role`
--      concedia acesso global imediato (policy super_admin_full_access).
--
-- CAMPOS PROTEGIDOS (privilegiados)
-- -----------------------------------------------------------------------------
--   public.user_profiles.role
--   public.user_profiles.is_super_admin
--
-- Continuam livremente editaveis pelo proprio usuario (auto-servico), pois nao
-- concedem privilegio: full_name, avatar_url, phone, timezone, locale,
-- job_title, bio, whatsapp, notify_whatsapp, notification_prefs,
-- requires_password_change.
--
-- REGRA DE AUTORIZACAO APLICADA (defesa no BANCO, nao no frontend)
-- -----------------------------------------------------------------------------
-- Alterar (UPDATE) ou gravar valor privilegiado (INSERT) em `role` /
-- `is_super_admin` so e permitido quando:
--   a) auth.uid() IS NULL  -> rotina interna: service_role, server functions
--      com admin client, migrations, seeds e o trigger de signup; ou
--   b) public.is_super_admin(auth.uid()) -> super admin.
-- Qualquer outro ator (user, manager, admin/owner de marca) recebe EXCEPTION,
-- inclusive quando tenta alterar os dois campos na mesma operacao, alterar o
-- perfil de outro usuario, ou passar pela policy super_admin_full_access.
--
-- Papeis internos de marca (owner/manager/user) continuam sendo administrados
-- em public.brand_members pelas RPCs existentes -> nenhuma permissao nova e
-- criada aqui e nenhuma regra de RBAC atual e alterada.
--
-- Como BEFORE trigger, roda em toda gravacao vinda de PostgREST, RPC ou SQL
-- direto: nao existe caminho de bypass para o role `authenticated`.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.guard_super_admin_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_privileged boolean := v_actor IS NULL OR public.is_super_admin(v_actor);
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Bloqueia criacao de perfil ja privilegiado por ator nao autorizado.
    IF (COALESCE(NEW.is_super_admin, false) = true
        OR COALESCE(NEW.role, 'user') = 'super_admin')
       AND NOT v_privileged THEN
      RAISE EXCEPTION 'Forbidden: apenas super admin cria perfil privilegiado'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_super_admin, false) IS DISTINCT FROM COALESCE(OLD.is_super_admin, false)
     AND NOT v_privileged THEN
    RAISE EXCEPTION 'Forbidden: apenas super admin altera is_super_admin'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(NEW.role, '') IS DISTINCT FROM COALESCE(OLD.role, '')
     AND NOT v_privileged THEN
    RAISE EXCEPTION 'Forbidden: apenas super admin altera role do perfil'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- O trigger historico cobre apenas UPDATE; adiciona a cobertura de INSERT.
DROP TRIGGER IF EXISTS trg_guard_super_admin_flag_insert ON public.user_profiles;
CREATE TRIGGER trg_guard_super_admin_flag_insert
  BEFORE INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_flag();

COMMENT ON FUNCTION public.guard_super_admin_flag() IS
  'Guarda de campos privilegiados de user_profiles (role, is_super_admin): grava'
  ' somente quando auth.uid() e nulo (rotina interna/service_role) ou o ator e'
  ' super admin. Corrige escalacao de privilegio via UPDATE do proprio perfil.';
