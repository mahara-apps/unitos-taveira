CREATE TABLE public.installation (
  id boolean NOT NULL DEFAULT true PRIMARY KEY,
  app_url text,
  logo_url text,
  logo_dark_url text,
  icon_url text,
  login_logo_url text,
  email_from text,
  email_from_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installation_singleton_chk CHECK (id)
);

GRANT SELECT ON public.installation TO anon;
GRANT SELECT ON public.installation TO authenticated;
GRANT ALL ON public.installation TO service_role;

ALTER TABLE public.installation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "installation_select_public" ON public.installation
  FOR SELECT USING (true);

CREATE POLICY "installation_update_super_admin" ON public.installation
  FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER installation_touch_updated_at
  BEFORE UPDATE ON public.installation
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.installation (id, logo_url, logo_dark_url, icon_url, login_logo_url)
SELECT true, b.logo_url, b.logo_dark_url, b.icon_url, b.login_logo_url
FROM public.brands b
WHERE b.id = '60fce5a7-1859-4bbd-a887-9018ed7f17b5'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.installation (id) VALUES (true) ON CONFLICT (id) DO NOTHING;