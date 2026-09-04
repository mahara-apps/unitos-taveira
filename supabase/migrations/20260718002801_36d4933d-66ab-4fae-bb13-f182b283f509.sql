
-- 1. Add channel column (nullable first, then enforce)
ALTER TABLE public.social_connections
  ADD COLUMN IF NOT EXISTS channel text;

-- Backfill channel for any existing rows (defensive; table is currently empty)
UPDATE public.social_connections
SET channel = CASE
  WHEN provider = 'meta' AND account_id IS NOT NULL THEN 'instagram'
  WHEN provider = 'meta' THEN 'facebook'
  ELSE provider
END
WHERE channel IS NULL;

-- Enforce NOT NULL + allowed values
ALTER TABLE public.social_connections
  ALTER COLUMN channel SET NOT NULL;

ALTER TABLE public.social_connections
  DROP CONSTRAINT IF EXISTS social_connections_channel_check;
ALTER TABLE public.social_connections
  ADD CONSTRAINT social_connections_channel_check
  CHECK (channel IN ('instagram','facebook','linkedin','tiktok','youtube','x','threads'));

-- 2. One active connection per (brand, channel) — the core business rule
DROP INDEX IF EXISTS social_connections_unique_active_brand_channel;
CREATE UNIQUE INDEX social_connections_unique_active_brand_channel
  ON public.social_connections (brand_id, channel)
  WHERE status IN ('active', 'attention');

-- 3. Helpful index for brand+channel lookups
CREATE INDEX IF NOT EXISTS idx_social_connections_brand_channel
  ON public.social_connections (brand_id, channel);
