ALTER TABLE public.task_time_entries
  ADD COLUMN IF NOT EXISTS seconds integer,
  ADD COLUMN IF NOT EXISTS ended_reason text;

-- Backfill seconds
UPDATE public.task_time_entries
SET seconds = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (ended_at - started_at)))::int)
WHERE seconds IS NULL AND ended_at IS NOT NULL;

UPDATE public.task_time_entries
SET seconds = COALESCE(minutes, 0) * 60
WHERE seconds IS NULL AND ended_at IS NOT NULL;

UPDATE public.task_time_entries
SET ended_reason = 'stop'
WHERE ended_at IS NOT NULL AND ended_reason IS NULL;

-- Close any stale open entries (more than one open per user breaks the app)
UPDATE public.task_time_entries t
SET ended_at = now(),
    seconds = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - t.started_at)))::int),
    minutes = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - t.started_at))/60.0)::int),
    ended_reason = 'auto'
WHERE t.ended_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.task_time_entries o
    WHERE o.user_id = t.user_id AND o.ended_at IS NULL AND o.id <> t.id
      AND (o.started_at > t.started_at OR (o.started_at = t.started_at AND o.id > t.id))
  );

CREATE OR REPLACE FUNCTION public.start_timer(_task_id uuid, _brand_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid UUID := auth.uid(); _new_id UUID; _now TIMESTAMPTZ := now();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;
  IF NOT public.is_brand_member(_brand_id, _uid) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE public.task_time_entries
    SET ended_at = _now,
        seconds = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (_now - started_at)))::INT),
        minutes = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (_now - started_at))/60.0)::INT),
        ended_reason = 'auto'
    WHERE user_id = _uid AND ended_at IS NULL;
  INSERT INTO public.task_time_entries (task_id, user_id, brand_id, started_at, source)
    VALUES (_task_id, _uid, _brand_id, _now, 'timer')
    RETURNING id INTO _new_id;
  RETURN _new_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.stop_timer(_entry_id uuid, _reason text DEFAULT 'stop')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid UUID := auth.uid(); _secs INTEGER; _now TIMESTAMPTZ := now();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;
  UPDATE public.task_time_entries
    SET ended_at = _now,
        seconds = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (_now - started_at)))::INT),
        minutes = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (_now - started_at))/60.0)::INT),
        ended_reason = CASE WHEN _reason IN ('pause','stop','auto') THEN _reason ELSE 'stop' END
    WHERE id = _entry_id AND user_id = _uid AND ended_at IS NULL
    RETURNING seconds INTO _secs;
  RETURN COALESCE(_secs, 0);
END; $function$;

CREATE OR REPLACE FUNCTION public.refresh_task_total_minutes(_task_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _total INTEGER;
BEGIN
  SELECT ROUND(COALESCE(SUM(COALESCE(seconds, COALESCE(minutes,0)*60)),0)/60.0)::INT INTO _total
  FROM public.task_time_entries
  WHERE task_id = _task_id AND ended_at IS NOT NULL;
  UPDATE public.tasks SET total_minutes = _total, updated_at = now() WHERE id = _task_id;
  RETURN _total;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.stop_timer(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.stop_timer(uuid, text) TO authenticated;