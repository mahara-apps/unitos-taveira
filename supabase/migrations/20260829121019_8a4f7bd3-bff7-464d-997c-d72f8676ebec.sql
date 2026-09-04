CREATE OR REPLACE FUNCTION public.brain_archive_and_prune_events()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  hot_days   int := public._brain_cfg_days('brain_events_hot_days', 90);
  dropped    int := 0;
  part record;
  cutoff timestamptz := now() - (hot_days || ' days')::interval;
BEGIN
  FOR part IN
    SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'public.brain_events'::regclass
       AND c.relname <> 'brain_events_default'
  LOOP
    IF part.bound ~ 'TO \(''([^'']+)''\)' THEN
      IF (regexp_replace(part.bound, '.*TO \(''([^'']+)''\).*', '\1'))::timestamptz <= cutoff THEN
        EXECUTE format('DROP TABLE public.%I', part.relname);
        dropped := dropped + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('archived', 0, 'partitions_dropped', dropped, 'cutoff', cutoff);
END $function$;

DROP TABLE IF EXISTS public.brain_events_archive;