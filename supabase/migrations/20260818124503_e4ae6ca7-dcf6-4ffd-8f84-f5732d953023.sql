-- Escopo avaliado a partir das colunas da própria linha (sem reconsultar clients).
-- Necessário porque funções STABLE não veem a linha inserida no RETURNING do
-- mesmo comando, o que fazia a policy de SELECT negar o registro recém-criado.
CREATE OR REPLACE FUNCTION public.can_access_client_row(
  _client_id uuid,
  _brand_id uuid,
  _owner_user_id uuid,
  _user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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

  -- CLIENTE (portal): isolado ao próprio cliente.
  IF EXISTS (
    SELECT 1 FROM public.client_members
     WHERE client_id = _client_id AND user_id = _user_id AND role = 'portal_client'
  ) THEN
    RETURN true;
  END IF;

  -- Fora da marca: sem acesso.
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_members WHERE brand_id = _brand_id AND user_id = _user_id
  ) THEN
    RETURN false;
  END IF;

  v_role := public.app_access_role(_user_id, _brand_id);

  IF v_role IN ('admin', 'manager') THEN
    RETURN true;
  END IF;

  IF _owner_user_id = _user_id THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.client_members
     WHERE client_id = _client_id AND user_id = _user_id AND role <> 'portal_client'
  ) THEN
    RETURN true;
  END IF;

  RETURN _owner_user_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.client_members
        WHERE client_id = _client_id AND role <> 'portal_client'
     );
END;
$function$;

REVOKE ALL ON FUNCTION public.can_access_client_row(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_client_row(uuid, uuid, uuid, uuid) TO authenticated, service_role;

-- can_access_client continua sendo a porta canônica para outras tabelas.
CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_brand uuid;
  v_owner uuid;
BEGIN
  IF _client_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT brand_id, owner_user_id INTO v_brand, v_owner
    FROM public.clients WHERE id = _client_id;

  IF v_brand IS NULL THEN
    RETURN public.is_super_admin(_user_id);
  END IF;

  RETURN public.can_access_client_row(_client_id, v_brand, v_owner, _user_id);
END;
$function$;

DROP POLICY IF EXISTS "clients read in scope" ON public.clients;
CREATE POLICY "clients read in scope"
  ON public.clients FOR SELECT TO authenticated
  USING (public.can_access_client_row(id, brand_id, owner_user_id, auth.uid()));

DROP POLICY IF EXISTS "clients update in scope" ON public.clients;
CREATE POLICY "clients update in scope"
  ON public.clients FOR UPDATE TO authenticated
  USING (public.can_access_client_row(id, brand_id, owner_user_id, auth.uid()))
  WITH CHECK (public.can_access_client_row(id, brand_id, owner_user_id, auth.uid()));