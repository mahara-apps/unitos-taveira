ALTER TABLE public.content_pipelines
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_reason text,
  ADD COLUMN IF NOT EXISTS deleted_pipeline_id uuid;

CREATE INDEX IF NOT EXISTS idx_posts_deleted_at
  ON public.posts (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_pipelines_deleted_at
  ON public.content_pipelines (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.purge_deleted_content()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - interval '30 days';
  v_post_ids uuid[];
  v_pipe_ids uuid[];
  v_posts int := 0;
  v_pipes int := 0;
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_post_ids
  FROM public.posts WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;

  IF array_length(v_post_ids, 1) > 0 THEN
    DELETE FROM public.social_posts WHERE post_id = ANY(v_post_ids);
    DELETE FROM public.post_placements WHERE post_id = ANY(v_post_ids);
    DELETE FROM public.post_client_comments WHERE post_id = ANY(v_post_ids);
    DELETE FROM public.post_approvals WHERE post_id = ANY(v_post_ids);
    DELETE FROM public.card_approval_events WHERE post_id = ANY(v_post_ids);
    DELETE FROM public.card_approval_tokens WHERE post_id = ANY(v_post_ids);
    DELETE FROM public.work_comments WHERE post_id = ANY(v_post_ids);
    DELETE FROM public.work_links WHERE post_id = ANY(v_post_ids);
    DELETE FROM public.calendar_events WHERE post_id = ANY(v_post_ids);
    DELETE FROM public.posts WHERE id = ANY(v_post_ids);
    v_posts := array_length(v_post_ids, 1);
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_pipe_ids
  FROM public.content_pipelines WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;

  IF array_length(v_pipe_ids, 1) > 0 THEN
    -- pipelines só saem de vez quando nenhuma peça (ativa ou na lixeira) depende deles
    SELECT coalesce(array_agg(p.id), '{}') INTO v_pipe_ids
    FROM public.content_pipelines p
    WHERE p.id = ANY(v_pipe_ids)
      AND NOT EXISTS (SELECT 1 FROM public.posts po WHERE po.pipeline_id = p.id);

    IF array_length(v_pipe_ids, 1) > 0 THEN
      DELETE FROM public.content_pipeline_stages WHERE pipeline_id = ANY(v_pipe_ids);
      DELETE FROM public.content_pipelines WHERE id = ANY(v_pipe_ids);
      v_pipes := array_length(v_pipe_ids, 1);
    END IF;
  END IF;

  RETURN jsonb_build_object('posts_purged', v_posts, 'pipelines_purged', v_pipes, 'cutoff', v_cutoff);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_deleted_content() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_deleted_content() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-deleted-content-30d') THEN
      PERFORM cron.unschedule('purge-deleted-content-30d');
    END IF;
    PERFORM cron.schedule('purge-deleted-content-30d', '40 4 * * *', 'SELECT public.purge_deleted_content();');
  END IF;
END;
$$;