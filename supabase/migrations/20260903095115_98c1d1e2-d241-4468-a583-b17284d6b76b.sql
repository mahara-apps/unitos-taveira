CREATE TABLE IF NOT EXISTS public.installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  domain text,
  supabase_project_ref text,
  supabase_url text,
  git_repo_url text,
  deploy_project text,
  notes text,
  status text NOT NULL DEFAULT 'preparing',
  health text NOT NULL DEFAULT 'unknown',
  current_version text,
  available_version text,
  last_provisioned_at timestamptz,
  last_validated_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.installations TO authenticated;
GRANT ALL ON public.installations TO service_role;
ALTER TABLE public.installations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "installations_super_admin_all" ON public.installations
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.installation_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES public.installations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  summary text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS installation_operations_installation_idx
  ON public.installation_operations (installation_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.installation_operations TO authenticated;
GRANT ALL ON public.installation_operations TO service_role;
ALTER TABLE public.installation_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "installation_operations_super_admin_all" ON public.installation_operations
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER installations_touch_updated_at
  BEFORE UPDATE ON public.installations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();