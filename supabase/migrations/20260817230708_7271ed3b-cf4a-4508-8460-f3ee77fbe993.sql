UPDATE public.social_connections
SET page_id = COALESCE(page_id, NULLIF(metadata->>'page_id','')),
    instagram_business_id = COALESCE(instagram_business_id, NULLIF(metadata->>'instagram_business_id',''))
WHERE provider = 'meta'
  AND (page_id IS NULL OR instagram_business_id IS NULL)
  AND metadata IS NOT NULL;