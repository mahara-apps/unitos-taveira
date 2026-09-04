-- 1) Normaliza dados legados -> chaves canônicas
CREATE OR REPLACE FUNCTION public.canonical_content_format(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _raw IS NULL OR btrim(_raw) = '' THEN NULL
    WHEN lower(btrim(_raw)) LIKE 'reel%' OR lower(btrim(_raw)) LIKE '%curto%' OR lower(btrim(_raw)) IN ('video','vídeo','shorts','short','tiktok','live') THEN 'reels'
    WHEN lower(btrim(_raw)) LIKE 'stor%' THEN 'stories'
    WHEN lower(btrim(_raw)) LIKE 'carr%' OR lower(btrim(_raw)) LIKE 'carou%' THEN 'carrossel'
    WHEN lower(btrim(_raw)) LIKE 'feed%' OR lower(btrim(_raw)) LIKE 'post%' OR lower(btrim(_raw)) LIKE '%est_tico%' OR lower(btrim(_raw)) IN ('imagem','artigo','blog') THEN 'feed'
    ELSE 'feed'
  END
$$;

UPDATE public.monthly_plan_topics
SET content_format = public.canonical_content_format(content_format)
WHERE content_format IS NOT NULL
  AND content_format NOT IN ('feed','stories','reels','carrossel');

UPDATE public.posts
SET format = public.canonical_content_format(format)
WHERE format IS NOT NULL
  AND format NOT IN ('feed','stories','reels','carrossel');

-- 2) Trava a taxonomia no banco (NULL continua permitido)
ALTER TABLE public.monthly_plan_topics
  DROP CONSTRAINT IF EXISTS monthly_plan_topics_content_format_canonical;
ALTER TABLE public.monthly_plan_topics
  ADD CONSTRAINT monthly_plan_topics_content_format_canonical
  CHECK (content_format IS NULL OR content_format IN ('feed','stories','reels','carrossel'));

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_format_canonical;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_format_canonical
  CHECK (format IS NULL OR format IN ('feed','stories','reels','carrossel'));