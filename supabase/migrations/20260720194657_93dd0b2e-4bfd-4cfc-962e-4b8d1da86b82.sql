ALTER TABLE public.meta_oauth_sessions
  ADD COLUMN IF NOT EXISTS portfolio_loaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS portfolio_load_status text NOT NULL DEFAULT 'not_loaded',
  ADD COLUMN IF NOT EXISTS portfolio_error text,
  ADD COLUMN IF NOT EXISTS portfolio_rate_limited_until timestamptz,
  ADD COLUMN IF NOT EXISTS portfolio_source_session_id uuid REFERENCES public.meta_oauth_sessions(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meta_oauth_sessions_portfolio_load_status_check'
      AND conrelid = 'public.meta_oauth_sessions'::regclass
  ) THEN
    ALTER TABLE public.meta_oauth_sessions
      ADD CONSTRAINT meta_oauth_sessions_portfolio_load_status_check
      CHECK (portfolio_load_status IN ('not_loaded', 'loaded', 'empty', 'error', 'rate_limited'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_meta_oauth_sessions_valid_portfolio
  ON public.meta_oauth_sessions (brand_id, meta_user_id, portfolio_loaded_at DESC)
  WHERE portfolio_loaded_at IS NOT NULL
    AND portfolio_load_status IN ('loaded', 'empty')
    AND jsonb_array_length(coalesce(pages, '[]'::jsonb)) > 0;

CREATE INDEX IF NOT EXISTS idx_meta_oauth_sessions_rate_limit
  ON public.meta_oauth_sessions (brand_id, meta_user_id, portfolio_rate_limited_until)
  WHERE portfolio_rate_limited_until IS NOT NULL;