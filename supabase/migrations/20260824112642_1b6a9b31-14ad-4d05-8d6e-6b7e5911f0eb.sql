-- ============================================================
-- Fase 1 RBAC — camada canônica única de autorização
-- ============================================================

-- 1) DEPRECIADA: ADMIN é sempre por workspace. Mantida como false para não
--    quebrar dependências desconhecidas; nenhuma regra nova deve chamá-la.
CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT false;
$function$;

COMMENT ON FUNCTION public.is_global_admin(uuid) IS
  'DEPRECIADA (Fase 1 RBAC): ADMIN é sempre escopado ao workspace. Retorna sempre false. Acesso global = is_super_admin.';

-- 2) Atribuição explícita usuário -> cliente (responsável ou vínculo interno).
CREATE OR REPLACE FUNCTION public.is_client_assigned(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL AND _client_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.id = _client_id AND c.owner_user_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.client_members cm
       WHERE cm.client_id = _client_id
         AND cm.user_id = _user_id
         AND cm.role <> 'portal_client'
    )
  );
$function$;

COMMENT ON FUNCTION public.is_client_assigned(uuid, uuid) IS
  'Fonte única de "cliente atribuído": clients.owner_user_id ou client_members (não portal).';

-- 3) Membro do workspace — sem atalho de admin global.
CREATE OR REPLACE FUNCTION public.is_brand_member(_brand_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_members
       WHERE brand_id = _brand_id AND user_id = _user_id AND is_active
    );
$function$;

-- 4) Papel canônico no workspace. Sem workspace informado NÃO há elevação de
--    papel (evita "melhor papel entre marcas").
CREATE OR REPLACE FUNCTION public.app_access_role(_user_id uuid, _brand_id uuid DEFAULT NULL::uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id IS NULL THEN NULL
    WHEN public.is_super_admin(_user_id) THEN 'super_admin'
    WHEN _brand_id IS NULL THEN (
      SELECT 'client'
        FROM public.client_members cm
       WHERE cm.user_id = _user_id AND cm.role = 'portal_client'
       LIMIT 1
    )
    ELSE COALESCE(
      (SELECT CASE bm.role
                WHEN 'owner'   THEN 'admin'
                WHEN 'manager' THEN 'manager'
                WHEN 'client'  THEN 'client'
                ELSE 'user'
              END
         FROM public.brand_members bm
        WHERE bm.user_id = _user_id
          AND bm.is_active
          AND bm.brand_id = _brand_id
        ORDER BY CASE bm.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 WHEN 'client' THEN 4 ELSE 3 END,
                 bm.user_id
        LIMIT 1),
      (SELECT 'client'
         FROM public.client_members cm
        WHERE cm.user_id = _user_id AND cm.role = 'portal_client'
        LIMIT 1)
    )
  END;
$function$;

-- 5) Regra canônica de acesso a cliente.
--    super_admin -> global | admin -> todo o workspace | manager/user -> atribuídos.
CREATE OR REPLACE FUNCTION public.can_access_client_row(
  _client_id uuid, _brand_id uuid, _owner_user_id uuid, _user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  IF _user_id IS NULL OR _brand_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_super_admin(_user_id) THEN
    RETURN true;
  END IF;

  -- Escopo INTERNO apenas. Usuários do Portal (client_members.role =
  -- 'portal_client') NÃO entram por aqui (ver is_portal_client_of).
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_members
     WHERE brand_id = _brand_id AND user_id = _user_id AND is_active
  ) THEN
    RETURN false;
  END IF;

  v_role := public.app_access_role(_user_id, _brand_id);

  -- ADMIN do workspace: todos os clientes daquele workspace.
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  -- MANAGER e USER: somente clientes explicitamente atribuídos.
  IF v_role IN ('manager', 'user') THEN
    IF _owner_user_id IS NOT NULL AND _owner_user_id = _user_id THEN
      RETURN true;
    END IF;
    RETURN public.is_client_assigned(_user_id, _client_id);
  END IF;

  RETURN false;
END;
$function$;

-- 6) Helper único para policies de tabelas client-scoped.
--    client_id NULL = recurso do workspace (não pertence a um cliente).
CREATE OR REPLACE FUNCTION public.client_in_scope(_client_id uuid, _brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _brand_id IS NOT NULL
     AND public.is_brand_member(_brand_id, auth.uid())
     AND (_client_id IS NULL OR public.can_access_client(_client_id, auth.uid()));
$function$;

COMMENT ON FUNCTION public.client_in_scope(uuid, uuid) IS
  'Fase 1 RBAC: escopo de linha para tabelas com brand_id + client_id. client_id NULL = recurso do workspace.';

-- 7) Limites de IA: ADMIN/MANAGER do próprio workspace (ou super admin).
CREATE OR REPLACE FUNCTION public.can_manage_brand_ai_limits(_brand_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_members m
       WHERE m.brand_id = _brand_id AND m.user_id = _user_id AND m.is_active
         AND m.role IN ('owner','manager')
    );
$function$;

-- 8) my_access — determinístico, escopado ao workspace atual.
CREATE OR REPLACE FUNCTION public.my_access(_brand_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT auth.uid() AS uid
  ), su AS (
    SELECT public.is_super_admin((SELECT uid FROM me)) AS is_su
  ), role AS (
    SELECT public.app_access_role((SELECT uid FROM me), _brand_id) AS r
  )
  SELECT jsonb_build_object(
    'user_id', (SELECT uid FROM me),
    'brand_id', _brand_id,
    'role', (SELECT r FROM role),
    'is_super_admin', (SELECT is_su FROM su),
    'brand_role', (SELECT bm.role::text FROM public.brand_members bm
                    WHERE bm.user_id = (SELECT uid FROM me)
                      AND bm.is_active
                      AND (_brand_id IS NULL OR bm.brand_id = _brand_id)
                    ORDER BY CASE bm.role
                               WHEN 'owner' THEN 1 WHEN 'manager' THEN 2
                               WHEN 'client' THEN 4 ELSE 3 END,
                             bm.brand_id
                    LIMIT 1),
    -- Clientes acessíveis: mesma regra da RLS (can_access_client_row).
    'client_ids', COALESCE((
      SELECT jsonb_agg(c.id ORDER BY c.id)
        FROM public.clients c
       WHERE (_brand_id IS NULL OR c.brand_id = _brand_id)
         AND public.can_access_client_row(c.id, c.brand_id, c.owner_user_id, (SELECT uid FROM me))
    ), '[]'::jsonb),
    'brand_ids', COALESCE((
      CASE WHEN (SELECT is_su FROM su)
        THEN (SELECT jsonb_agg(b.id) FROM public.brands b)
        ELSE (SELECT jsonb_agg(bm.brand_id) FROM public.brand_members bm
               WHERE bm.user_id = (SELECT uid FROM me) AND bm.is_active)
      END
    ), '[]'::jsonb)
  );
$function$;

-- 9) Visibilidade de perfis: apenas membros de workspaces compartilhados.
DROP POLICY IF EXISTS "Users see profiles of shared brand members" ON public.user_profiles;
CREATE POLICY "Users see profiles of shared brand members"
ON public.user_profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1
      FROM public.brand_members me
      JOIN public.brand_members other ON other.brand_id = me.brand_id
     WHERE me.user_id = auth.uid() AND me.is_active
       AND other.user_id = public.user_profiles.id AND other.is_active
  )
);

GRANT EXECUTE ON FUNCTION public.is_client_assigned(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_in_scope(uuid, uuid) TO authenticated;