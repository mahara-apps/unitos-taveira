-- 1) can_access_client: vínculos de portal não devem restringir o acesso interno
CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_brand uuid;
  v_scoped boolean;
BEGIN
  IF _client_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_super_admin(_user_id) THEN
    RETURN true;
  END IF;

  SELECT brand_id INTO v_brand FROM public.clients WHERE id = _client_id;
  IF v_brand IS NULL THEN
    RETURN false;
  END IF;

  -- Apenas vínculos INTERNOS ativam o modo restritivo.
  -- Linhas de portal (role = 'portal_client') representam o cliente final e
  -- nunca devem reduzir o acesso da equipe da marca.
  SELECT EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id = _client_id AND role <> 'portal_client'
  ) INTO v_scoped;

  IF v_scoped THEN
    RETURN EXISTS (
      SELECT 1 FROM public.client_members
      WHERE client_id = _client_id
        AND user_id = _user_id
        AND role <> 'portal_client'
    );
  END IF;

  -- Sem restrição: qualquer membro da marca
  RETURN public.is_brand_member(v_brand, _user_id);
END;
$function$;

-- 2) client_members: heartbeat de sessão de portal + unicidade por pessoa/cliente
ALTER TABLE public.client_members ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS client_members_client_user_key
  ON public.client_members (client_id, user_id);
CREATE INDEX IF NOT EXISTS client_members_user_idx
  ON public.client_members (user_id);
CREATE INDEX IF NOT EXISTS client_members_portal_idx
  ON public.client_members (user_id) WHERE role = 'portal_client';

-- 3) Helpers de portal, isolados de is_brand_member
CREATE OR REPLACE FUNCTION public.is_portal_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.client_members
    WHERE user_id = _user_id AND role = 'portal_client'
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_client_ids(_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(client_id ORDER BY created_at), '{}'::uuid[])
  FROM public.client_members
  WHERE user_id = _user_id AND role = 'portal_client';
$$;

REVOKE ALL ON FUNCTION public.is_portal_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.portal_client_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_portal_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_client_ids(uuid) TO authenticated, service_role;

-- 4) Usuário de portal lê apenas o próprio vínculo
DROP POLICY IF EXISTS "Portal user reads own membership" ON public.client_members;
CREATE POLICY "Portal user reads own membership"
ON public.client_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid() AND role = 'portal_client');