ALTER TABLE public.brand_members DROP CONSTRAINT IF EXISTS brand_members_role_official_chk;
ALTER TABLE public.brand_members ADD CONSTRAINT brand_members_role_official_chk
  CHECK (role = ANY (ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'user'::app_role, 'client'::app_role]));