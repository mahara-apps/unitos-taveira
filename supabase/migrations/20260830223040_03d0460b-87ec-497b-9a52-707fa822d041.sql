ALTER TABLE public.meta_oauth_sessions
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_reason text;

CREATE INDEX IF NOT EXISTS meta_oauth_sessions_brand_active_idx
  ON public.meta_oauth_sessions (brand_id, created_at DESC)
  WHERE revoked_at IS NULL;

UPDATE public.meta_oauth_sessions s
SET revoked_at = now(),
    revoked_reason = 'Backfill: workspace sem canais Meta ativos'
WHERE s.revoked_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.social_connections c
    WHERE c.brand_id = s.brand_id
      AND c.provider = 'meta'
      AND c.status <> 'revoked'
  );