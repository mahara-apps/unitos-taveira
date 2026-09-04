CREATE TABLE public.post_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  format text NOT NULL CHECK (format IN ('feed','stories','reels','carrossel')),
  scheduled_at timestamptz,
  copy_override jsonb,
  media jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','failed')),
  published_at timestamptz,
  external_ref text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, format)
);

CREATE INDEX idx_post_placements_post ON public.post_placements(post_id);
CREATE INDEX idx_post_placements_brand_client ON public.post_placements(brand_id, client_id);
CREATE INDEX idx_post_placements_scheduled ON public.post_placements(scheduled_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_placements TO authenticated;
GRANT ALL ON public.post_placements TO service_role;

ALTER TABLE public.post_placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand members manage placements"
  ON public.post_placements FOR ALL
  TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

CREATE TRIGGER trg_post_placements_updated_at
  BEFORE UPDATE ON public.post_placements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill: normaliza formato com fallback para 'feed'
WITH normalized AS (
  SELECT
    p.id AS post_id, p.brand_id, p.client_id, p.scheduled_at, p.published_at,
    CASE lower(coalesce(p.format::text, 'feed'))
      WHEN 'feed' THEN 'feed'
      WHEN 'stories' THEN 'stories'
      WHEN 'story' THEN 'stories'
      WHEN 'reels' THEN 'reels'
      WHEN 'reel' THEN 'reels'
      WHEN 'carrossel' THEN 'carrossel'
      WHEN 'carousel' THEN 'carrossel'
      WHEN 'carrousel' THEN 'carrossel'
      ELSE 'feed'
    END AS format
  FROM public.posts p
)
INSERT INTO public.post_placements (post_id, brand_id, client_id, format, scheduled_at, status, is_primary, published_at)
SELECT
  n.post_id, n.brand_id, n.client_id, n.format, n.scheduled_at,
  CASE WHEN n.published_at IS NOT NULL THEN 'published'
       WHEN n.scheduled_at IS NOT NULL THEN 'scheduled'
       ELSE 'draft' END,
  true,
  n.published_at
FROM normalized n
ON CONFLICT (post_id, format) DO NOTHING;