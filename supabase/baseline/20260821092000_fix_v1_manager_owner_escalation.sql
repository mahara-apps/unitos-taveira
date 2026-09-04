-- =============================================================================
-- FORWARD-ONLY (staging) — Fecha V1: escalação MANAGER → OWNER
--
-- Caminho explorado: public.link_existing_user_to_brand() ("vincular conta
-- existente"). A função exigia apenas que o ator fosse owner OU manager da
-- marca, mas NÃO validava qual papel ele pode conceder. Um manager podia
-- vincular/promover qualquer usuário — inclusive o próprio e-mail — como
-- 'owner', tanto no INSERT quanto no ON CONFLICT DO UPDATE.
--
-- Correção: a autoridade do papel concedido passa a ser validada pela função
-- canônica já existente public.can_invite_brand_role(), mesma matriz usada por
-- brand_invites / accept_brand_invite:
--   super_admin  → owner | manager | user
--   owner(admin) → manager | user
--   manager      → user
--   user         → nada
--   portal_client→ nada
--   autopromoção (e-mail do próprio ator) bloqueada para não super_admin
--
-- Nenhuma hierarquia paralela é criada. Nenhuma função canônica é alterada.
-- Comportamento funcional restante (tenant, busca por e-mail, status
-- added/updated/already_member/not_found, permissions) é preservado 1:1.
--
-- Correção secundária necessária: a versão histórica declarava OUT param
-- `user_id`, o que tornava `ON CONFLICT (brand_id, user_id)` ambíguo e fazia o
-- caminho de escrita falhar com "column reference user_id is ambiguous".
-- `#variable_conflict use_column` resolve a ambiguidade a favor da coluna,
-- mantendo a semântica pretendida do upsert.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.link_existing_user_to_brand(
  _brand_id uuid,
  _email text,
  _role public.app_role,
  _permissions jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(status text, email text, user_id uuid, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := auth.uid();
  v_target uuid;
  v_existing record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Quem administra a marca (inalterado).
  IF NOT EXISTS (
    SELECT 1
    FROM public.brand_members bm
    WHERE bm.brand_id = _brand_id
      AND bm.user_id = v_actor
      AND bm.role IN ('owner', 'manager')
  ) AND NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- V1: autoridade do papel concedido. Cobre INSERT e ON CONFLICT DO UPDATE,
  -- porque a validação acontece antes de qualquer escrita.
  IF NOT public.can_invite_brand_role(_brand_id, v_actor, _role, _email) THEN
    RAISE EXCEPTION 'role_authority_invalid';
  END IF;

  SELECT public.find_user_id_by_email(_email) INTO v_target;

  IF v_target IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, lower(trim(_email))::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Defesa extra: ninguém (exceto super admin) altera o próprio vínculo aqui.
  IF v_target = v_actor AND NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'self_promotion_blocked';
  END IF;

  SELECT bm.role::text AS role, bm.permissions
  INTO v_existing
  FROM public.brand_members bm
  WHERE bm.brand_id = _brand_id
    AND bm.user_id = v_target;

  INSERT INTO public.brand_members (brand_id, user_id, role, permissions)
  VALUES (_brand_id, v_target, _role, COALESCE(_permissions, '[]'::jsonb))
  ON CONFLICT (brand_id, user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    permissions = EXCLUDED.permissions;

  RETURN QUERY
  SELECT
    CASE
      WHEN v_existing IS NULL THEN 'added'::text
      WHEN v_existing.role = _role::text AND COALESCE(v_existing.permissions, '[]'::jsonb) = COALESCE(_permissions, '[]'::jsonb) THEN 'already_member'::text
      ELSE 'updated'::text
    END,
    lower(trim(_email))::text,
    v_target,
    up.full_name
  FROM public.user_profiles up
  WHERE up.id = v_target;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      CASE
        WHEN v_existing IS NULL THEN 'added'::text
        WHEN v_existing.role = _role::text AND COALESCE(v_existing.permissions, '[]'::jsonb) = COALESCE(_permissions, '[]'::jsonb) THEN 'already_member'::text
        ELSE 'updated'::text
      END,
      lower(trim(_email))::text,
      v_target,
      NULL::text;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.link_existing_user_to_brand(uuid, text, public.app_role, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_existing_user_to_brand(uuid, text, public.app_role, jsonb) TO authenticated, service_role;
