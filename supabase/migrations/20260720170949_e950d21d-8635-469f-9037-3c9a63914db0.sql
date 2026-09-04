ALTER TABLE public.social_connections DROP CONSTRAINT IF EXISTS social_connections_channel_check;
ALTER TABLE public.social_connections ADD CONSTRAINT social_connections_channel_check
  CHECK (channel = ANY (ARRAY['instagram','facebook','linkedin','tiktok','youtube','x','threads','ads']));

ALTER TABLE public.meta_oauth_sessions
  ADD COLUMN IF NOT EXISTS threads_accounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ad_accounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS requested_scopes text[] NOT NULL DEFAULT ARRAY[]::text[];