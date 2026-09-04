CREATE OR REPLACE FUNCTION public.effective_module_permissions(_user_id uuid, _brand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_profile jsonb := '{}'::jsonb;
  v_override jsonb := '{}'::jsonb;
  v_total jsonb;
BEGIN
  IF _user_id IS NULL OR _brand_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT (public.access_profiles_system_defaults() -> 6) -> 'permissions' INTO v_total;

  IF public.is_super_admin(_user_id) THEN
    RETURN v_total;
  END IF;

  SELECT lower(bm.role::text),
         COALESCE(ap.permissions, '{}'::jsonb),
         COALESCE(bm.module_permissions, '{}'::jsonb)
    INTO v_role, v_profile, v_override
    FROM public.brand_members bm
    LEFT JOIN public.access_profiles ap ON ap.id = bm.access_profile_id
   WHERE bm.brand_id = _brand_id AND bm.user_id = _user_id;

  IF v_role IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  IF v_role IN ('owner','admin','manager') THEN
    RETURN v_total;
  END IF;

  RETURN v_profile || v_override;
END;
$function$;