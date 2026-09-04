-- =============================================================================
-- 020_cron.sql — agenda os 14 cron jobs apontando SOMENTE para a própria URL.
--
-- Pré-requisitos (validados aqui, falha se ausentes):
--   * pg_cron e pg_net instalados (000_extensions.sql)
--   * public.cron_secret() com valor no Vault (public.set_cron_secret(...))
--   * installation.app_url igual à origem informada (010_installation_identity.sql)
--
-- Requer a variável psql :app_url. Idempotente: unschedule condicional + schedule.
-- Guard final: nenhuma URL de cron pode divergir da origem desta instalação.
-- =============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_app_url text := rtrim(:'app_url', '/');
  v_stored  text;
  v_name    text;
  v_job     jsonb;
  v_jobs    jsonb := jsonb_build_array(
    jsonb_build_array('prune-post-media-30d',      '0 4 * * *',    '/api/public/media/prune'),
    jsonb_build_array('brain-consolidate-daily',   '0 3 * * *',    '/api/public/hooks/brain-consolidate'),
    jsonb_build_array('sla-overdue-check-hourly',  '5 * * * *',    '/api/public/cron/sla-check'),
    jsonb_build_array('meta-publish-scheduled',    '* * * * *',    '/api/public/meta/publish-scheduled'),
    jsonb_build_array('brain-synthesis-nightly',   '17 3 * * *',   '/api/public/hooks/brain-synthesis'),
    jsonb_build_array('brain-social-metrics-sync', '23 4 * * *',   '/api/public/hooks/social-metrics-sync'),
    jsonb_build_array('ai-models-health-daily',    '20 3 * * *',   '/api/public/hooks/ai-models-health'),
    jsonb_build_array('briefing-import-worker',    '* * * * *',    '/api/public/cron/import-worker'),
    jsonb_build_array('briefing-import-reaper',    '*/2 * * * *',  '/api/public/cron/import-reaper')
  );
BEGIN
  IF v_app_url IS NULL OR v_app_url !~ '^https://[a-zA-Z0-9._-]+(:[0-9]+)?$' THEN
    RAISE EXCEPTION 'app_url inválida para o cron (%)', v_app_url;
  END IF;
  IF lower(v_app_url) LIKE '%unitos-master.lovable.app%'
     OR lower(v_app_url) LIKE '%tkjbhttylouamqxnbfgv%' THEN
    RAISE EXCEPTION 'cron não pode apontar para o MASTER (%)', v_app_url;
  END IF;

  -- A URL do cron precisa ser exatamente a mesma registrada na instalação.
  SELECT rtrim(app_url, '/') INTO v_stored FROM public.installation LIMIT 1;
  IF v_stored IS NULL THEN
    RAISE EXCEPTION 'installation.app_url ausente: rode 010_installation_identity.sql antes';
  END IF;
  IF v_stored <> v_app_url THEN
    RAISE EXCEPTION 'divergência de origem: installation.app_url=% mas cron receberia %', v_stored, v_app_url;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron ausente: aplique 000_extensions.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_net ausente: aplique 000_extensions.sql';
  END IF;
  IF public.cron_secret() IS NULL OR length(public.cron_secret()) < 16 THEN
    RAISE EXCEPTION 'cron_secret ausente/curto no Vault: rode public.set_cron_secret(<CRON_SECRET>)';
  END IF;

  -- Jobs HTTP: header x-cron-secret vindo do Vault (mesma origem do env CRON_SECRET).
  FOR v_job IN SELECT * FROM jsonb_array_elements(v_jobs) LOOP
    v_name := v_job->>0;
    PERFORM cron.unschedule(v_name) WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_name);
    PERFORM cron.schedule(
      v_name,
      v_job->>1,
      format($fmt$select net.http_post(
          url := %L,
          headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.cron_secret()),
          body := '{}'::jsonb
        );$fmt$, v_app_url || (v_job->>2))
    );
  END LOOP;

  -- Jobs SQL diretos (sem rede).
  FOR v_job IN SELECT * FROM jsonb_array_elements(jsonb_build_array(
    jsonb_build_array('ai-jobs-reaper',         '*/2 * * * *',  'SELECT public.reap_stuck_ai_jobs();'),
    jsonb_build_array('deadline-notifications', '*/30 * * * *', 'SELECT public.enqueue_deadline_notifications();'),
    jsonb_build_array('brain-learning-worker',  '* * * * *',    'SELECT public.process_brain_learning_queue(200);'),
    jsonb_build_array('brain-learning-reaper',  '*/5 * * * *',  'SELECT public.reap_brain_learning_queue();'),
    jsonb_build_array('refresh-brain-stats-mv', '*/5 * * * *',  'SELECT public.refresh_brain_stats();'),
    jsonb_build_array('brain-retention',        '15 3 * * *',   'SELECT public.brain_retention_run();'),
    jsonb_build_array('brain-pattern-mining',   '*/30 * * * *', 'SELECT public.brain_run_mining_safe();')
  )) LOOP
    v_name := v_job->>0;
    PERFORM cron.unschedule(v_name) WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_name);
    PERFORM cron.schedule(v_name, v_job->>1, v_job->>2);
  END LOOP;

  -- Guard final: nenhum job pode carregar URL de outra instalação.
  IF EXISTS (
    SELECT 1 FROM cron.job
    WHERE command ~ 'https?://'
      AND command NOT LIKE '%' || v_app_url || '/%'
  ) THEN
    RAISE EXCEPTION 'cron com URL externa à instalação detectado — abortado';
  END IF;
END $$;

SELECT jobname, schedule FROM cron.job ORDER BY jobname;
