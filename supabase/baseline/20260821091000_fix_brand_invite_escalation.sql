-- =============================================================================
-- FORWARD-ONLY (staging) — Corrige escalação de privilégio via brand_invites
--
-- Problema: a policy `brand admins manage invites` permitia que um MANAGER
-- criasse convite com role = 'owner' (inclusive para o próprio e-mail) e o
-- aceitasse via accept_brand_invite(), tornando-se owner/admin da marca.
--
-- Correção em duas camadas:
--   1) RLS: autoridade de convite validada no INSERT e no UPDATE.
--   2) accept_brand_invite(): revalida o convite no momento do aceite (não
--      confia na policy de INSERT).
--
-- Autoridade reutiliza as funções canônicas existentes (app_access_role /
-- is_super_admin). Nenhuma hierarquia paralela de RBAC é criada.
--
-- Matriz de convite:
--   super_admin  → owner | manager | user
--   owner(admin) → manager | user
--   manager      → user
--   user         → nada
--   portal_client→ nada
--   Autoconvite (e-mail do próprio ator) é bloqueado para não super_admin.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Helper fino sobre a autoridade canônica. Necessário porque nem a policy nem
-- accept_brand_invite() conseguem expressar "qual papel este ator pode
-- conceder" com as funções existentes. Não substitui nenhuma função canônica.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_invite_brand_role(
  _brand_id uuid,
  _actor_id uuid,
  _role public.app_role,
  _email text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_actor_email text;
BEGIN
  IF _actor_id IS NULL OR _brand_id IS NULL OR _role IS NULL THEN
    RETURN false;
  END IF;

  -- Papéis legados do enum (editor/designer/client) não podem ser convidados.
  IF _role NOT IN ('owner', 'manager', 'user') THEN
    RETURN false;
  END IF;

  IF public.is_super_admin(_actor_id) THEN
    RETURN true;
  END IF;

  -- Bloqueia autoconvite (vetor de escalação: convidar o próprio e-mail com
  -- papel superior). Super admin já retornou acima.
  SELECT lower(u.email) INTO v_actor_email FROM auth.users u WHERE u.id = _actor_id;
  IF v_actor_email IS NOT NULL AND v_actor_email = lower(coalesce(_email, '')) THEN
    RETURN false;
  END IF;

  v_role := public.app_access_role(_actor_id, _brand_id);

  IF v_role = 'admin' THEN
    -- owner da marca: pode conceder manager e user (não cria outro owner).
    RETURN _role IN ('manager', 'user');
  END IF;

  IF v_role = 'manager' THEN
    RETURN _role = 'user';
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.can_invite_brand_role(uuid, uuid, public.app_role, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_invite_brand_role(uuid, uuid, public.app_role, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RLS de brand_invites: mantém quem administra (owner/manager, igual antes),
-- mas passa a validar a autoridade do papel concedido em INSERT e UPDATE.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "brand admins manage invites" ON public.brand_invites;
-- Idempotência (reconstrução do zero / reaplicação): as policies abaixo já
-- podem existir se a promoção equivalente tiver rodado antes neste banco.
DROP POLICY IF EXISTS "brand admins read invites" ON public.brand_invites;
DROP POLICY IF EXISTS "brand admins create invites" ON public.brand_invites;
DROP POLICY IF EXISTS "brand admins update invites" ON public.brand_invites;
DROP POLICY IF EXISTS "brand admins delete invites" ON public.brand_invites;

CREATE POLICY "brand admins read invites"
  ON public.brand_invites FOR SELECT TO authenticated
  USING (
    has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
    OR has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
  );

CREATE POLICY "brand admins create invites"
  ON public.brand_invites FOR INSERT TO authenticated
  WITH CHECK (
    public.can_invite_brand_role(brand_id, auth.uid(), role, email)
  );

CREATE POLICY "brand admins update invites"
  ON public.brand_invites FOR UPDATE TO authenticated
  USING (
    has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
    OR has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
  )
  WITH CHECK (
    public.can_invite_brand_role(brand_id, auth.uid(), role, email)
  );

CREATE POLICY "brand admins delete invites"
  ON public.brand_invites FOR DELETE TO authenticated
  USING (
    has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
    OR has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
  );

-- ----------------------------------------------------------------------------
-- Segunda camada: accept_brand_invite() revalida o convite.
-- Mesma assinatura e mesmos códigos de erro anteriores + 2 novos.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_brand_invite(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text := lower(coalesce((auth.jwt() ->> 'email'), ''));
  v_invite public.brand_invites%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_invite FROM public.brand_invites WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found'; END IF;
  IF v_invite.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'invite_revoked'; END IF;
  IF v_invite.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'invite_already_accepted'; END IF;
  IF v_invite.expires_at < now() THEN RAISE EXCEPTION 'invite_expired'; END IF;
  IF lower(v_invite.email) <> v_user_email THEN RAISE EXCEPTION 'invite_email_mismatch'; END IF;

  -- Papel precisa ser um papel interno oficial.
  IF v_invite.role NOT IN ('owner', 'manager', 'user') THEN
    RAISE EXCEPTION 'invite_role_not_allowed';
  END IF;

  -- Autoconvite não promove: quem emitiu não pode ser quem aceita.
  IF v_invite.invited_by = v_user_id AND NOT public.is_super_admin(v_user_id) THEN
    RAISE EXCEPTION 'invite_self_escalation';
  END IF;

  -- Um convite manipulado no banco não pode resultar em promoção indevida:
  -- a autoridade do emissor é revalidada agora.
  IF NOT public.can_invite_brand_role(
        v_invite.brand_id, v_invite.invited_by, v_invite.role, v_invite.email) THEN
    RAISE EXCEPTION 'invite_authority_invalid';
  END IF;

  INSERT INTO public.brand_members (brand_id, user_id, role, permissions)
  VALUES (v_invite.brand_id, v_user_id, v_invite.role, v_invite.permissions)
  ON CONFLICT (brand_id, user_id)
    DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions;

  UPDATE public.brand_invites SET accepted_at = now(), accepted_by = v_user_id WHERE id = v_invite.id;
  RETURN v_invite.brand_id;
END;
$function$;
