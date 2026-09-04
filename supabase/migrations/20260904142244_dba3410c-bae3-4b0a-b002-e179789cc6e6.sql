CREATE TABLE public.installation_credentials (
  installation_id uuid PRIMARY KEY REFERENCES public.installations(id) ON DELETE CASCADE,
  supabase_management_token_ciphertext text,
  vercel_token_ciphertext text,
  vercel_team_id text,
  github_token_ciphertext text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.installation_credentials TO authenticated;
GRANT ALL ON public.installation_credentials TO service_role;

ALTER TABLE public.installation_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "installation_credentials_super_admin_all" ON public.installation_credentials
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER update_installation_credentials_updated_at
  BEFORE UPDATE ON public.installation_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();