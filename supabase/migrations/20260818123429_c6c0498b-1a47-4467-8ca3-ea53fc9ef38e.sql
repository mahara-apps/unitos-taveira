-- ============================================================
-- FASE 1 RBAC — fonte única de papel + escopo canônico
-- Nenhuma tabela/coluna legada é removida; nenhum dado apagado.
-- ============================================================

-- 1) SUPER ADMIN: apenas user_profiles (is_super_admin OR role='super_admin').
--    Remove a allowlist de e-mails hardcoded da versão sem argumentos.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin(auth.uid());
$function$;

-- 2) Papel canônico (autoridade). Fonte única: brand_members.role
--    (+ user_profiles.is_super_admin para SUPER ADMIN, client_members para CLIENTE).
--    user_profiles.role NÃO participa (apenas especialidade profissional).
CREATE OR REPLACE FUNCTION public.app_access_role(_user_id uuid, _brand_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id IS NULL THEN NULL
    WHEN public.is_super_admin(_user_id) THEN 'super_admin'
    ELSE COALESCE(
      (SELECT CASE bm.role
                WHEN 'owner'   THEN 'admin'
                WHEN 'manager' THEN 'manager'
                ELSE 'user'
              END
         FROM public.brand_members bm
        WHERE bm.user_id = _user_id
          AND (_brand_id IS NULL OR bm.brand_id = _brand_id)
        ORDER BY CASE bm.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END
        LIMIT 1),
      (SELECT 'client'
         FROM public.client_members cm
        WHERE cm.user_id = _user_id AND cm.role = 'portal_client'
        LIMIT 1)
    )
  END;
$function$;

-- 3) Escopo canônico por cliente.
--    super_admin/admin/manager -> toda a marca
--    user  -> apenas clientes atribuídos (client_members interno OU owner_user_id)
--             + compatibilidade: clientes sem nenhuma atribuição continuam visíveis
--    client (portal) -> apenas o próprio cliente
CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_brand uuid;
  v_role  text;
  v_owner uuid;
BEGIN
  IF _client_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_super_admin(_user_id) THEN
    RETURN true;
  END IF;

  SELECT brand_id, owner_user_id INTO v_brand, v_owner
    FROM public.clients WHERE id = _client_id;
  IF v_brand IS NULL THEN
    RETURN false;
  END IF;

  -- CLIENTE (portal): isolado ao próprio cliente.
  IF EXISTS (
    SELECT 1 FROM public.client_members
     WHERE client_id = _client_id AND user_id = _user_id AND role = 'portal_client'
  ) THEN
    RETURN true;
  END IF;

  -- Fora da marca: sem acesso.
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_members WHERE brand_id = v_brand AND user_id = _user_id
  ) THEN
    RETURN false;
  END IF;

  v_role := public.app_access_role(_user_id, v_brand);

  -- ADMIN / MANAGER: autoridade em toda a marca.
  IF v_role IN ('admin', 'manager') THEN
    RETURN true;
  END IF;

  -- USER: escopo explícito.
  IF v_owner = _user_id THEN
    RETURN true;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.client_members
     WHERE client_id = _client_id AND user_id = _user_id AND role <> 'portal_client'
  ) THEN
    RETURN true;
  END IF;

  -- Compatibilidade: cliente sem responsável e sem vínculos internos permanece
  -- visível a toda a equipe da marca (evita quebrar operação existente).
  RETURN v_owner IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.client_members
        WHERE client_id = _client_id AND role <> 'portal_client'
     );
END;
$function$;

-- 4) Lista canônica de clientes acessíveis (usada por server functions e UI).
CREATE OR REPLACE FUNCTION public.my_access(_brand_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'user_id', auth.uid(),
    'brand_id', _brand_id,
    'role', public.app_access_role(auth.uid(), _brand_id),
    'is_super_admin', public.is_super_admin(auth.uid()),
    'brand_role', (SELECT bm.role::text FROM public.brand_members bm
                    WHERE bm.user_id = auth.uid()
                      AND (_brand_id IS NULL OR bm.brand_id = _brand_id)
                    LIMIT 1),
    'client_ids', COALESCE((
      SELECT jsonb_agg(c.id)
        FROM public.clients c
       WHERE (_brand_id IS NULL OR c.brand_id = _brand_id)
         AND public.can_access_client(c.id, auth.uid())
    ), '[]'::jsonb),
    'brand_ids', COALESCE((
      SELECT jsonb_agg(bm.brand_id) FROM public.brand_members bm WHERE bm.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.my_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_access(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.app_access_role(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_access_role(uuid, uuid) TO authenticated, service_role;

-- 5) MANAGER explícito na gestão de equipe (não pode tocar em owner nem promover a owner).
DROP POLICY IF EXISTS "managers manage non-owner members" ON public.brand_members;
CREATE POLICY "managers manage non-owner members"
ON public.brand_members FOR ALL TO authenticated
USING (
  public.app_access_role(auth.uid(), brand_id) IN ('manager','admin','super_admin')
  AND role <> 'owner'
)
WITH CHECK (
  public.app_access_role(auth.uid(), brand_id) IN ('manager','admin','super_admin')
  AND role <> 'owner'
);

-- 6) Clientes: criação/exclusão apenas ADMIN/MANAGER; leitura/edição pelo escopo.
DROP POLICY IF EXISTS "brand members manage clients" ON public.clients;
DROP POLICY IF EXISTS "brand members read clients" ON public.clients;

CREATE POLICY "clients read in scope"
ON public.clients FOR SELECT TO authenticated
USING (public.can_access_client(id, auth.uid()));

CREATE POLICY "clients update in scope"
ON public.clients FOR UPDATE TO authenticated
USING (public.can_access_client(id, auth.uid()))
WITH CHECK (public.can_access_client(id, auth.uid()));

CREATE POLICY "clients insert admins"
ON public.clients FOR INSERT TO authenticated
WITH CHECK (public.app_access_role(auth.uid(), brand_id) IN ('admin','manager','super_admin'));

CREATE POLICY "clients delete admins"
ON public.clients FOR DELETE TO authenticated
USING (public.app_access_role(auth.uid(), brand_id) IN ('admin','manager','super_admin'));

-- 7) Endurecer políticas operacionais de {public} para {authenticated} (mesma regra).
DROP POLICY IF EXISTS "brand members manage projects" ON public.projects;
CREATE POLICY "brand members manage projects"
ON public.projects FOR ALL TO authenticated
USING (CASE WHEN client_id IS NULL THEN public.is_brand_member(brand_id, auth.uid())
            ELSE public.can_access_client(client_id, auth.uid()) END)
WITH CHECK (CASE WHEN client_id IS NULL THEN public.is_brand_member(brand_id, auth.uid())
                 ELSE public.can_access_client(client_id, auth.uid()) END);

DROP POLICY IF EXISTS "brand members manage tasks" ON public.tasks;
CREATE POLICY "brand members manage tasks"
ON public.tasks FOR ALL TO authenticated
USING (CASE WHEN client_id IS NULL THEN public.is_brand_member(brand_id, auth.uid())
            ELSE public.can_access_client(client_id, auth.uid()) END)
WITH CHECK (CASE WHEN client_id IS NULL THEN public.is_brand_member(brand_id, auth.uid())
                 ELSE public.can_access_client(client_id, auth.uid()) END);

DROP POLICY IF EXISTS "brand members manage posts" ON public.posts;
CREATE POLICY "brand members manage posts"
ON public.posts FOR ALL TO authenticated
USING (public.can_access_client(client_id, auth.uid()))
WITH CHECK (public.can_access_client(client_id, auth.uid()));

DROP POLICY IF EXISTS "Client members access monthly_plans" ON public.monthly_plans;
CREATE POLICY "Client members access monthly_plans"
ON public.monthly_plans FOR ALL TO authenticated
USING (public.can_access_client(client_id, auth.uid()))
WITH CHECK (public.can_access_client(client_id, auth.uid()));

DROP POLICY IF EXISTS "brand members read activity" ON public.activity_events;
CREATE POLICY "brand members read activity"
ON public.activity_events FOR SELECT TO authenticated
USING (CASE WHEN client_id IS NULL THEN public.is_brand_member(brand_id, auth.uid())
            ELSE public.can_access_client(client_id, auth.uid()) END);