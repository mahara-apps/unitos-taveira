CREATE OR REPLACE FUNCTION public.refresh_task_total_minutes(_task_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _total INTEGER;
BEGIN
  SELECT FLOOR(COALESCE(SUM(COALESCE(seconds, COALESCE(minutes, 0) * 60)), 0) / 60.0)::INT
    INTO _total
  FROM public.task_time_entries
  WHERE task_id = _task_id
    AND ended_at IS NOT NULL;

  UPDATE public.tasks
  SET total_minutes = _total,
      updated_at = now()
  WHERE id = _task_id;

  RETURN _total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_timer(_task_id uuid, _brand_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID := auth.uid();
  _new_id UUID;
  _now TIMESTAMPTZ := now();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;
  IF NOT public.is_brand_member(_brand_id, _uid) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.task_time_entries
  SET ended_at = _now,
      seconds = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (_now - started_at)))::INT),
      minutes = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (_now - started_at)) / 60.0)::INT),
      ended_reason = 'auto'
  WHERE user_id = _uid
    AND ended_at IS NULL;

  INSERT INTO public.task_time_entries (task_id, user_id, brand_id, started_at, source)
  VALUES (_task_id, _uid, _brand_id, _now, 'timer')
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stop_timer(_entry_id uuid, _reason text DEFAULT 'stop'::text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID := auth.uid();
  _secs INTEGER;
  _now TIMESTAMPTZ := now();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  UPDATE public.task_time_entries
  SET ended_at = _now,
      seconds = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (_now - started_at)))::INT),
      minutes = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (_now - started_at)) / 60.0)::INT),
      ended_reason = CASE
        WHEN _reason IN ('pause', 'stop', 'auto') THEN _reason
        ELSE 'stop'
      END
  WHERE id = _entry_id
    AND user_id = _uid
    AND ended_at IS NULL
  RETURNING seconds INTO _secs;

  RETURN COALESCE(_secs, 0);
END;
$function$;

UPDATE public.task_time_entries
SET minutes = FLOOR(COALESCE(seconds, 0) / 60.0)::INT
WHERE seconds IS NOT NULL
  AND minutes IS DISTINCT FROM FLOOR(COALESCE(seconds, 0) / 60.0)::INT;

UPDATE public.tasks t
SET total_minutes = totals.total_minutes,
    updated_at = now()
FROM (
  SELECT task_id,
         FLOOR(COALESCE(SUM(COALESCE(seconds, COALESCE(minutes, 0) * 60)), 0) / 60.0)::INT AS total_minutes
  FROM public.task_time_entries
  WHERE ended_at IS NOT NULL
  GROUP BY task_id
) totals
WHERE t.id = totals.task_id
  AND t.total_minutes IS DISTINCT FROM totals.total_minutes;