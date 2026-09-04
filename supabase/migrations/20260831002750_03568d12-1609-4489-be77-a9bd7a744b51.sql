ALTER TABLE public.monthly_plan_topics
  ADD COLUMN IF NOT EXISTS suggested_at timestamptz,
  ADD COLUMN IF NOT EXISTS suggested_slot_rationale text,
  ADD COLUMN IF NOT EXISTS suggested_confidence text;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS schedule_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_approved_by uuid,
  ADD COLUMN IF NOT EXISTS schedule_client_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_client_comment text;

CREATE INDEX IF NOT EXISTS posts_proposed_at_idx
  ON public.posts (brand_id, client_id, proposed_at)
  WHERE proposed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.posts_validate_schedule_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.schedule_status IS NULL THEN
    NEW.schedule_status := 'none';
  END IF;
  IF NEW.schedule_status NOT IN ('none','proposed','internal_approved','client_pending','client_changes','reserved') THEN
    RAISE EXCEPTION 'invalid schedule_status: %', NEW.schedule_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_validate_schedule_status ON public.posts;
CREATE TRIGGER posts_validate_schedule_status
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.posts_validate_schedule_status();