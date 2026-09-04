ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS portal_theme jsonb NOT NULL DEFAULT '{"mode":"system"}'::jsonb;

COMMENT ON COLUMN public.clients.portal_theme IS 'Tema do portal público: { mode: system|custom, accent, logo_url, bg, dark, footer_label, show_agency_credit }';

UPDATE public.clients SET portal_theme = '{"mode":"system"}'::jsonb WHERE portal_theme IS NULL;