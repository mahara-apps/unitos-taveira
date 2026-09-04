
CREATE MATERIALIZED VIEW IF NOT EXISTS public.brain_stats_mv AS
SELECT
  b.id AS brand_id,
  COALESCE((SELECT count(*) FROM public.posts p WHERE p.brand_id = b.id AND p.deleted_at IS NULL), 0)::bigint AS posts,
  COALESCE((SELECT count(*) FROM public.tasks t WHERE t.brand_id = b.id), 0)::bigint AS tasks,
  COALESCE((SELECT count(*) FROM public.projects pr WHERE pr.brand_id = b.id), 0)::bigint AS projects,
  now() AS refreshed_at
FROM public.brands b;

CREATE UNIQUE INDEX IF NOT EXISTS brain_stats_mv_brand_uniq ON public.brain_stats_mv (brand_id);

GRANT SELECT ON public.brain_stats_mv TO authenticated;
GRANT ALL ON public.brain_stats_mv TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_brain_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.brain_stats_mv;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_brain_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_brain_stats() TO service_role;

CREATE INDEX IF NOT EXISTS idx_projects_brand ON public.projects (brand_id);
CREATE INDEX IF NOT EXISTS idx_brain_insights_brand_expires ON public.brain_insights (brand_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_brain_recs_brand_status_active ON public.brain_recommendations (brand_id, status) WHERE status = 'active';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-brain-stats-mv') THEN
      PERFORM cron.unschedule('refresh-brain-stats-mv');
    END IF;
    PERFORM cron.schedule(
      'refresh-brain-stats-mv',
      '*/5 * * * *',
      $cron$SELECT public.refresh_brain_stats();$cron$
    );
  END IF;
END $$;

-- Initial populate
REFRESH MATERIALIZED VIEW public.brain_stats_mv;
