GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brand_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clients TO authenticated;

GRANT ALL PRIVILEGES ON TABLE public.brands TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.brand_members TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.clients TO service_role;
