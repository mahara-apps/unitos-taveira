-- 1) sync_post_publication_state: demote quando a peça não tem todos os destinos publicados
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
  v_unpub     integer;
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

  -- Guarda de publicação parcial: se existe destino não publicado, a peça NUNCA
  -- pode permanecer marcada como publicada (mesmo que tenha sido marcada antes).
  SELECT count(*) INTO v_unpub
    FROM public.post_placements
   WHERE post_id = p_post_id
     AND status <> 'published';

  IF v_unpub > 0 THEN
    UPDATE public.posts
       SET stage = 'scheduled',
           published_at = NULL,
           updated_at = now()
     WHERE id = p_post_id
       AND stage = 'published';
    RETURN;
  END IF;

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

-- 2) Sweep fail-closed: itens vencidos cujo destino não é mais utilizável
CREATE OR REPLACE FUNCTION public.block_unusable_scheduled_social_posts()
 RETURNS TABLE(id uuid, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_reason text;
BEGIN
  FOR r IN
    SELECT sp.id, sp.client_id, sp.brand_id, sp.connection_id,
           sc.id AS conn_id, sc.status AS conn_status, sc.access_token_ciphertext
      FROM public.social_posts sp
      LEFT JOIN public.social_connections sc
             ON sc.id = sp.connection_id AND sc.brand_id = sp.brand_id
     WHERE sp.status = 'scheduled'
       AND sp.scheduled_at IS NOT NULL
       AND sp.scheduled_at <= now()
       AND (sp.publish_locked_at IS NULL OR sp.publish_locked_at < now() - interval '10 minutes')
  LOOP
    v_reason := NULL;
    IF r.conn_id IS NULL THEN
      v_reason := 'connection_missing';
    ELSIF r.conn_status <> 'active' THEN
      v_reason := 'connection_inactive';
    ELSIF r.access_token_ciphertext IS NULL THEN
      v_reason := 'token_invalid';
    ELSIF r.client_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.client_social_accounts csa
       WHERE csa.connection_id = r.connection_id
         AND csa.client_id = r.client_id
         AND csa.brand_id = r.brand_id
    ) THEN
      v_reason := 'client_account_link_missing';
    END IF;

    IF v_reason IS NOT NULL THEN
      PERFORM public.mark_social_post_blocked(
        r.id,
        CASE v_reason
          WHEN 'connection_missing' THEN 'Conexão indisponível: esta conta não está mais conectada a este workspace.'
          WHEN 'connection_inactive' THEN 'Conta desconectada. Reconecte a conta em Canais para publicar.'
          WHEN 'token_invalid' THEN 'Autorização expirada. Reconecte a conta em Canais para publicar.'
          ELSE 'Conta não vinculada a este cliente. Vincule em Perfil do cliente > Canais.'
        END,
        'connection_required'
      );
      RETURN QUERY SELECT r.id, v_reason;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.block_unusable_scheduled_social_posts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_unusable_scheduled_social_posts() TO service_role;

-- 3) Reparo do estado atual (peça com 1/2 destinos publicados)
SELECT public.sync_post_publication_state('7531d4f7-d047-4f0d-ad2a-8c79b2a5f9dd'::uuid);