ALTER TABLE public.social_connections
  ADD COLUMN IF NOT EXISTS meta_business_id text,
  ADD COLUMN IF NOT EXISTS meta_business_name text;

ALTER TABLE public.meta_oauth_sessions
  ADD COLUMN IF NOT EXISTS businesses jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS social_connections_brand_meta_business_idx
  ON public.social_connections (brand_id, provider, meta_business_id);

CREATE INDEX IF NOT EXISTS meta_oauth_sessions_brand_active_idx
  ON public.meta_oauth_sessions (brand_id, created_at DESC)
  WHERE revoked_at IS NULL;