CREATE TABLE public.installation_meta_app (
  id boolean NOT NULL DEFAULT true PRIMARY KEY,
  app_type text NOT NULL DEFAULT 'unitos',
  app_id text,
  app_secret_ciphertext text,
  business_config_id text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installation_meta_app_singleton_chk CHECK (id),
  CONSTRAINT installation_meta_app_type_chk CHECK (app_type IN ('unitos', 'client'))
);

GRANT SELECT, UPDATE ON public.installation_meta_app TO authenticated;
GRANT ALL ON public.installation_meta_app TO service_role;

ALTER TABLE public.installation_meta_app ENABLE ROW LEVEL SECURITY;

CREATE POLICY "installation_meta_app_select_super_admin" ON public.installation_meta_app
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "installation_meta_app_update_super_admin" ON public.installation_meta_app
  FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER installation_meta_app_touch_updated_at
  BEFORE UPDATE ON public.installation_meta_app
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.installation_meta_app (id) VALUES (true) ON CONFLICT (id) DO NOTHING;