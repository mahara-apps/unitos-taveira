ALTER FUNCTION public.brain_touch_updated_at() SET search_path = public, pg_temp;

REVOKE ALL ON public.brain_stats_mv FROM anon, authenticated;

DROP POLICY IF EXISTS "brand_assets_public_read" ON storage.objects;

DROP POLICY IF EXISTS "agent_prompts_authenticated_read" ON public.agent_prompts;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef
      AND p.proname NOT LIKE 'portal\_%'
      AND p.proname NOT LIKE 'media\_plan\_public%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY (ARRAY[
        '_brain_cfg_days','brain_archive_and_prune_events','brain_cleanup_ttl',
        'brain_ensure_event_partitions','brain_retention_run',
        'get_brain_neighborhood','refresh_brain_stats',
        'process_brain_learning_queue','reap_brain_learning_queue',
        'derive_relationships_from_event','enqueue_deadline_notifications',
        'claim_scheduled_social_posts','find_user_id_by_email','consolidate_brain_memory'
      ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;