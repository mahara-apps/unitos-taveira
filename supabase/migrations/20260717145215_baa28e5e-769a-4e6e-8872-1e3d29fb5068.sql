
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz;

UPDATE public.posts
  SET stage_entered_at = COALESCE(updated_at, created_at, now())
  WHERE stage_entered_at IS NULL;

ALTER TABLE public.posts
  ALTER COLUMN stage_entered_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.posts_touch_stage_entered_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage_entered_at IS NULL THEN
      NEW.stage_entered_at := now();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      NEW.stage_entered_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_posts_touch_stage_entered_at ON public.posts;
CREATE TRIGGER trg_posts_touch_stage_entered_at
BEFORE INSERT OR UPDATE OF stage_id ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.posts_touch_stage_entered_at();

CREATE INDEX IF NOT EXISTS idx_posts_stage_entered_at
  ON public.posts (stage_id, stage_entered_at)
  WHERE deleted_at IS NULL;

-- Add notification kinds
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'sla_overdue'
                 AND enumtypid = 'public.notification_kind'::regtype) THEN
    ALTER TYPE public.notification_kind ADD VALUE 'sla_overdue';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'sla_overdue_manager'
                 AND enumtypid = 'public.notification_kind'::regtype) THEN
    ALTER TYPE public.notification_kind ADD VALUE 'sla_overdue_manager';
  END IF;
END $$;
