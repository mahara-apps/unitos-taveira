-- ============================================================
-- C3: unicidade de destino por (post, canal, formato)
-- ============================================================
ALTER TABLE public.post_placements
  DROP CONSTRAINT IF EXISTS post_placements_post_id_format_key;

CREATE UNIQUE INDEX IF NOT EXISTS post_placements_post_conn_format_key
  ON public.post_placements (post_id, connection_id, format)
  WHERE connection_id IS NOT NULL;

-- Sem canal definido, mantém a regra antiga (1 formato por peça).
CREATE UNIQUE INDEX IF NOT EXISTS post_placements_post_format_noconn_key
  ON public.post_placements (post_id, format)
  WHERE connection_id IS NULL;

-- ============================================================
-- C1: sincronização social_posts -> post_placements -> posts -> Kanban
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_post_publication_state(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- 2) Ainda existe destino pendente? Então a peça não está publicada.
  SELECT count(*) INTO v_pending
    FROM public.social_posts
   WHERE post_id = p_post_id
     AND status IN ('draft', 'scheduled', 'publishing');
  IF v_pending > 0 THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.post_placements
     WHERE post_id = p_post_id
       AND status IN ('draft', 'scheduled')
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
$function$;

REVOKE ALL ON FUNCTION public.sync_post_publication_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_post_publication_state(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.sync_post_publication_state(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.tg_social_posts_sync_publication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published')
     AND NEW.post_id IS NOT NULL THEN
    PERFORM public.sync_post_publication_state(NEW.post_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_social_posts_sync_publication ON public.social_posts;
CREATE TRIGGER trg_social_posts_sync_publication
  AFTER INSERT OR UPDATE OF status ON public.social_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_social_posts_sync_publication();

-- ============================================================
-- C4: claim deixa de depender de social_connections.client_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_scheduled_social_posts(p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, brand_id uuid, client_id uuid, connection_id uuid, provider text, placement text, caption text, hashtags text[], mentions text[], media jsonb, publish_attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT sp.id
    FROM public.social_posts sp
    JOIN public.social_connections sc ON sc.id = sp.connection_id
    WHERE sp.status = 'scheduled'
      AND sp.scheduled_at IS NOT NULL
      AND sp.scheduled_at <= now()
      AND (sp.publish_locked_at IS NULL OR sp.publish_locked_at < now() - interval '10 minutes')
      AND sp.publish_attempts < 5
      -- Isolamento de marca
      AND sc.brand_id = sp.brand_id
      -- Isolamento de cliente: vínculo em client_social_accounts (fonte de verdade).
      AND (
        sp.client_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.client_social_accounts csa
          WHERE csa.connection_id = sp.connection_id
            AND csa.client_id = sp.client_id
            AND csa.brand_id = sp.brand_id
        )
      )
    ORDER BY sp.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE OF sp SKIP LOCKED
  ),
  locked AS (
    UPDATE public.social_posts sp
       SET publish_locked_at = now(),
           status = 'publishing',
           updated_at = now()
      FROM candidates c
     WHERE sp.id = c.id
     RETURNING sp.id, sp.brand_id, sp.client_id, sp.connection_id, sp.provider,
               sp.placement, sp.caption, sp.hashtags, sp.mentions, sp.media,
               sp.publish_attempts
  )
  SELECT * FROM locked;
END;
$function$;