DROP INDEX IF EXISTS public.idx_meta_oauth_sessions_valid_portfolio;

CREATE INDEX idx_meta_oauth_sessions_valid_portfolio
ON public.meta_oauth_sessions (brand_id, meta_user_id, portfolio_loaded_at DESC)
WHERE portfolio_loaded_at IS NOT NULL
  AND portfolio_load_status IN ('loaded', 'empty')
  AND (
    CASE jsonb_typeof(COALESCE(pages, '[]'::jsonb))
      WHEN 'array' THEN jsonb_array_length(COALESCE(pages, '[]'::jsonb))
      WHEN 'object' THEN jsonb_array_length(
        CASE
          WHEN jsonb_typeof(pages -> 'pages') = 'array' THEN pages -> 'pages'
          ELSE '[]'::jsonb
        END
      )
      ELSE 0
    END
  ) > 0;