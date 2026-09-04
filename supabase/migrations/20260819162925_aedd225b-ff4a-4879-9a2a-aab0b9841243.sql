CREATE OR REPLACE FUNCTION public.can_access_client_row(_client_id uuid, _brand_id uuid, _owner_user_id uuid, _user_id uuid)
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
  -- 'portal_client') NÃO entram por aqui: o acesso deles é resolvido pelo
  -- caminho dedicado do Portal (_portal_session_user / portal-data.server),
  -- que expõe somente as colunas e linhas próprias do Portal.
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_members
     WHERE brand_id = _brand_id AND user_id = _user_id AND is_active
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

  RETURN EXISTS (
    SELECT 1 FROM public.client_members
     WHERE client_id = _client_id AND user_id = _user_id AND role <> 'portal_client'
  );
END;
$function$;
