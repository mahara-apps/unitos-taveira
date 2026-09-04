ALTER TABLE public.brand_connections
  ADD COLUMN IF NOT EXISTS text_fallback_provider text;