DELETE FROM public.brand_api_credentials;
UPDATE public.brand_connections SET providers = '{}'::jsonb;