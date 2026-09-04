
-- Performance audit: dedupe indexes and add missing composites for hottest query patterns

-- 1) Drop duplicate indexes (same columns, same order)
DROP INDEX IF EXISTS public.activity_events_brand_created_idx;      -- duplicate of idx_activity_events_brand_created
DROP INDEX IF EXISTS public.idx_ai_jobs_user_created;               -- subset of ai_jobs_user_status_idx (user_id, status, created_at)

-- 2) Notifications inbox: ORDER BY created_at DESC WHERE user_id = ?
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

-- 3) Posts calendar range: WHERE brand_id=? AND stage IN (...) AND scheduled_at BETWEEN ? AND ?
CREATE INDEX IF NOT EXISTS idx_posts_brand_stage_scheduled
  ON public.posts (brand_id, stage, scheduled_at)
  WHERE deleted_at IS NULL;

-- 4) Posts board/list: WHERE brand_id=? AND stage=? ORDER BY updated_at
CREATE INDEX IF NOT EXISTS idx_posts_brand_stage_updated
  ON public.posts (brand_id, stage, updated_at DESC)
  WHERE deleted_at IS NULL;

-- 5) Brand briefings lookup by (brand_id, client_id) — current index is client_id only
CREATE INDEX IF NOT EXISTS idx_brand_briefings_brand_client
  ON public.brand_briefings (brand_id, client_id);
