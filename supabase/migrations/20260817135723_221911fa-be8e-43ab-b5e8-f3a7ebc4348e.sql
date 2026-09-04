CREATE OR REPLACE FUNCTION public.brain_set_last_observed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.last_observed_at IS NULL THEN
    NEW.last_observed_at := COALESCE(
      NULLIF(NEW.content->>'last_event_at','')::timestamptz,
      NULLIF(NEW.content->>'last_seen_at','')::timestamptz,
      NEW.updated_at,
      now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brain_memory_last_observed ON public.brain_memory;
CREATE TRIGGER trg_brain_memory_last_observed
BEFORE INSERT OR UPDATE ON public.brain_memory
FOR EACH ROW EXECUTE FUNCTION public.brain_set_last_observed();

SELECT cron.schedule('brain-pattern-mining', '*/30 * * * *', $$ SELECT public.brain_mine_patterns(NULL); $$);