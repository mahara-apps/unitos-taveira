CREATE OR REPLACE FUNCTION public.sync_post_publication_state(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_pending   integer;
  v_ts        timestamptz;
  v_pipeline  uuid;
  v_stage_id  uuid;
BEGIN
  IF p_post_id IS NULL THEN
    RETURN;
  END IF;

  -- 1) Destinos publicados: casa placement <-> social_post pelo canal real
  --    (connection_id) e pela família de formato (story vs feed/reels/carrossel).
  --    Idempotente: nunca toca placement já publicado.
  UPDATE public.post_placements pp
     SET status = 'published',
         published_at = COALESCE(pp.published_at, sp.published_at, now()),
         updated_at = now()
    FROM public.social_posts sp
   WHERE sp.post_id = p_post_id
     AND sp.status = 'published'
     AND pp.post_id = p_post_id
     AND pp.connection_id = sp.connection_id
     AND (
       (sp.placement = 'story' AND pp.format = 'stories')
       OR (sp.placement <> 'story' AND pp.format <> 'stories')
     )
     AND pp.status <> 'published';

  -- 1b) Destinos com falha ficam visíveis no placement (publicação parcial).
  UPDATE public.post_placements pp
     SET status = 'failed',
         updated_at = now()
    FROM public.social_posts sp
   WHERE sp.post_id = p_post_id
     AND sp.status = 'failed'
     AND pp.post_id = p_post_id
     AND pp.connection_id = sp.connection_id
     AND (
       (sp.placement = 'story' AND pp.format = 'stories')
       OR (sp.placement <> 'story' AND pp.format <> 'stories')
     )
     AND pp.status NOT IN ('published', 'failed');

  -- 2) Ainda existe destino pendente? Então a peça não está publicada.
  SELECT count(*) INTO v_pending
    FROM public.social_posts
   WHERE post_id = p_post_id
     AND status IN ('draft', 'scheduled', 'publishing');
  IF v_pending > 0 THEN
    RETURN;
  END IF;

  -- 2b) Publicação PARCIAL: se qualquer destino falhou, a peça NÃO é publicada.
  IF EXISTS (
    SELECT 1 FROM public.social_posts
     WHERE post_id = p_post_id
       AND status = 'failed'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.post_placements
     WHERE post_id = p_post_id
       AND status IN ('draft', 'scheduled', 'failed')
  ) THEN
    RETURN;
  END IF;

  SELECT max(published_at) INTO v_ts
    FROM public.social_posts
   WHERE post_id = p_post_id
     AND status = 'published';
  IF v_ts IS NULL THEN
    RETURN;
  END IF;

  -- 3) Peça -> published + coluna "Publicado" do pipeline (quando existir).
  SELECT pipeline_id INTO v_pipeline FROM public.posts WHERE id = p_post_id;
  IF v_pipeline IS NOT NULL THEN
    SELECT id INTO v_stage_id
      FROM public.content_pipeline_stages
     WHERE pipeline_id = v_pipeline
       AND key = 'published'
     ORDER BY position
     LIMIT 1;
  END IF;

  UPDATE public.posts
     SET stage = 'published',
         published_at = COALESCE(published_at, v_ts),
         stage_id = COALESCE(v_stage_id, stage_id),
         updated_at = now()
   WHERE id = p_post_id
     AND (
       stage <> 'published'
       OR published_at IS NULL
       OR (v_stage_id IS NOT NULL AND stage_id IS DISTINCT FROM v_stage_id)
     );
END;
$fn$;

-- Idempotência de fila: um único item ativo por (peça, conexão) em feed.
-- Stories multi-frame ficam de fora (várias linhas legítimas por destino).
CREATE UNIQUE INDEX IF NOT EXISTS social_posts_active_dest_key
  ON public.social_posts (post_id, connection_id, placement)
  WHERE post_id IS NOT NULL
    AND placement <> 'story'
    AND status IN ('scheduled', 'publishing');