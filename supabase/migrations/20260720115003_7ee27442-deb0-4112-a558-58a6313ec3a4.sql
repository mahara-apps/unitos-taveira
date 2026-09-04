-- Central bypass for super_admin in the two helpers used by ~90% of policies
CREATE OR REPLACE FUNCTION public.is_brand_member(_brand_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (SELECT 1 FROM public.brand_members WHERE brand_id = _brand_id AND user_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.has_brand_role(_brand_id uuid, _user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (SELECT 1 FROM public.brand_members WHERE brand_id = _brand_id AND user_id = _user_id AND role = _role);
$$;

-- Supplemental super_admin FOR ALL policies on tables whose existing rules
-- are scoped to auth.uid() or inline EXISTS on brand_members (not covered
-- by the helper bypass above). Policies OR together, so this only widens
-- access for super admins and leaves normal user behavior identical.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'social_connections',
    'social_posts',
    'chat_conversations',
    'chat_messages',
    'notifications',
    'user_profiles',
    'brain_reasoning_logs',
    'ai_jobs',
    'brand_members',
    'brand_invites'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "super_admin_full_access" ON public.%I;', t
    );
    EXECUTE format(
      'CREATE POLICY "super_admin_full_access" ON public.%I
         AS PERMISSIVE FOR ALL TO authenticated
         USING (public.is_super_admin(auth.uid()))
         WITH CHECK (public.is_super_admin(auth.uid()));', t
    );
  END LOOP;
END $$;