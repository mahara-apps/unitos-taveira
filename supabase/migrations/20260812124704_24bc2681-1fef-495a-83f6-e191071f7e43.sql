DO $$
DECLARE
  r record;
  auth_keep text[] := ARRAY[
    'accept_brand_invite','brain_memory_decay_and_archive','brain_memory_evolve',
    'brain_memory_touch','can_access_client','can_manage_brand_ai_limits',
    'check_ai_usage_budget','emit_brain_event','get_brain_graph','has_brand_role',
    'instantiate_project_template','is_brand_member','is_super_admin',
    'link_existing_user_to_brand','list_agent_catalog','list_ai_usage_overview',
    'match_brain_events','start_timer','stop_timer'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname, p.prorettype = 'trigger'::regtype AS is_trg
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prokind = 'f'
      AND (p.prosecdef OR p.prorettype = 'trigger'::regtype)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);

    IF NOT r.is_trg THEN
      IF r.proname LIKE 'portal\_%' OR r.proname LIKE 'media\_plan\_public%' THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
      ELSIF r.proname = ANY (auth_keep) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
      END IF;
    END IF;
  END LOOP;
END $$;