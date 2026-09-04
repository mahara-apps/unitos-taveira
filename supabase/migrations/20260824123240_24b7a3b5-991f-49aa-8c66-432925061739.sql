CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid;
  v_owner uuid;
  v_found boolean := false;
BEGIN
  IF _client_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT true, brand_id, owner_user_id INTO v_found, v_brand, v_owner
    FROM public.clients WHERE id = _client_id;

  -- Cliente inexistente nunca autoriza (nem super admin): IDs forjados
  -- devem falhar de forma idêntica a IDs fora do escopo.
  IF NOT COALESCE(v_found, false) THEN
    RETURN false;
  END IF;

  RETURN public.can_access_client_row(_client_id, v_brand, v_owner, _user_id);
END;
$$;