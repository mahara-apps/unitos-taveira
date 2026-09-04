ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS notifications_pending_idx
  ON public.notifications (user_id, brand_id, created_at DESC)
  WHERE read_at IS NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_user_brand_created_idx
  ON public.notifications (user_id, brand_id, created_at DESC);