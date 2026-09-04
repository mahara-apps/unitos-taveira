-- 1) Estado explícito para bloqueio determinístico de autorização/vínculo.
CREATE OR REPLACE FUNCTION public.mark_social_post_blocked(p_post_id uuid, p_error text, p_reason text DEFAULT 'connection_required')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_post_id uuid;
  v_conn uuid;
  v_placement text;
BEGIN
  UPDATE public.social_posts
     SET status = 'blocked',
         last_error = p_error,
         publish_locked_at = NULL,
         updated_at = now()
   WHERE id = p_post_id
  RETURNING post_id, connection_id, placement INTO v_post_id, v_conn, v_placement;

  IF v_post_id IS NULL OR v_conn IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.post_placements pp
     SET status = p_reason,
         updated_at = now()
   WHERE pp.post_id = v_post_id
     AND pp.connection_id = v_conn
     AND (
       (v_placement = 'story' AND pp.format = 'stories')
       OR (v_placement <> 'story' AND pp.format <> 'stories')
     )
     AND pp.status NOT IN ('published');
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_social_post_blocked(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_social_post_blocked(uuid, text, text) TO service_role;

-- 2) Peça nunca vira "published" com destino bloqueado / sem conexão.
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

  UPDATE public.post_placements pp
     SET status = 'connection_required',
         updated_at = now()
    FROM public.social_posts sp
   WHERE sp.post_id = p_post_id
     AND sp.status = 'blocked'
     AND pp.post_id = p_post_id
     AND pp.connection_id = sp.connection_id
     AND (
       (sp.placement = 'story' AND pp.format = 'stories')
       OR (sp.placement <> 'story' AND pp.format <> 'stories')
     )
     AND pp.status NOT IN ('published', 'connection_required');

  SELECT count(*) INTO v_pending
    FROM public.social_posts
   WHERE post_id = p_post_id
     AND status IN ('draft', 'scheduled', 'publishing', 'blocked');
  IF v_pending > 0 THEN
    RETURN;
  END IF;

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
       AND status IN ('draft', 'scheduled', 'failed', 'connection_required')
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