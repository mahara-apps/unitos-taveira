ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
UPDATE public.user_profiles SET role = 'user' WHERE role IS NULL OR role IN ('editor','designer','sdr_operator');
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role = ANY (ARRAY['admin'::text,'manager'::text,'user'::text,'super_admin'::text]));

UPDATE public.brand_members SET role = 'user' WHERE role IN ('editor','designer');
UPDATE public.brand_invites SET role = 'user' WHERE role IN ('editor','designer');
UPDATE public.client_members SET role = 'user' WHERE role IN ('editor','designer');

ALTER TABLE public.brand_members ALTER COLUMN role SET DEFAULT 'user'::public.app_role;
ALTER TABLE public.brand_invites ALTER COLUMN role SET DEFAULT 'user'::public.app_role;

CREATE OR REPLACE FUNCTION public.normalize_app_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('editor','designer') THEN
    NEW.role := 'user'::public.app_role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brand_members_normalize_role ON public.brand_members;
CREATE TRIGGER trg_brand_members_normalize_role
BEFORE INSERT OR UPDATE OF role ON public.brand_members
FOR EACH ROW EXECUTE FUNCTION public.normalize_app_role();

DROP TRIGGER IF EXISTS trg_brand_invites_normalize_role ON public.brand_invites;
CREATE TRIGGER trg_brand_invites_normalize_role
BEFORE INSERT OR UPDATE OF role ON public.brand_invites
FOR EACH ROW EXECUTE FUNCTION public.normalize_app_role();

CREATE OR REPLACE FUNCTION public.normalize_client_member_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('editor','designer') THEN
    NEW.role := 'user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_members_normalize_role ON public.client_members;
CREATE TRIGGER trg_client_members_normalize_role
BEFORE INSERT OR UPDATE OF role ON public.client_members
FOR EACH ROW EXECUTE FUNCTION public.normalize_client_member_role();

CREATE OR REPLACE FUNCTION public.app_access_role(_user_id uuid, _brand_id uuid DEFAULT NULL::uuid)
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
                WHEN 'client'  THEN 'client'
                ELSE 'user'
              END
         FROM public.brand_members bm
        WHERE bm.user_id = _user_id
          AND bm.is_active
          AND (_brand_id IS NULL OR bm.brand_id = _brand_id)
        ORDER BY CASE bm.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 WHEN 'client' THEN 4 ELSE 3 END
        LIMIT 1),
      (SELECT 'client'
         FROM public.client_members cm
        WHERE cm.user_id = _user_id AND cm.role = 'portal_client'
        LIMIT 1)
    )
  END;
$function$;

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

  IF EXISTS (
    SELECT 1 FROM public.client_members
     WHERE client_id = _client_id AND user_id = _user_id AND role = 'portal_client'
  ) THEN
    RETURN true;
  END IF;

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

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_full_name text;
BEGIN
  v_role := lower(coalesce(NEW.raw_user_meta_data->>'role', ''));
  IF v_role NOT IN ('admin','manager','user','super_admin') THEN
    v_role := 'user';
  END IF;

  v_full_name := coalesce(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    split_part(coalesce(NEW.email,''), '@', 1),
    'Usuário'
  );

  BEGIN
    INSERT INTO public.user_profiles (id, full_name, role)
    VALUES (NEW.id, v_full_name, v_role)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: falha ao criar perfil para %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;