-- =============================================================================
-- 002_bootstrap_cron.sql — BOOTSTRAP (fora do schema estrutural)
-- Staging: NAO aplicar em producao. Ver supabase/baseline-snapshot/README.md.
-- =============================================================================
-- Espelha os 14 cron jobs REAIS de producao (leitura de cron.job):
--   7 jobs via net.http_post (dependem de pg_net + public.cron_secret()
--     + endpoints /api/public/* da instalacao)
--   7 jobs que chamam funcoes SQL diretamente
--
-- Dependencias obrigatorias antes de rodar este arquivo:
--   1. extensoes pg_cron e pg_net instaladas (000_extensions.sql — NAO vem no 001)
--   2. funcoes referenciadas existentes (001_initial_schema.sql)
--   3. segredo do cron gravado no Vault, senao public.cron_secret() retorna NULL
--      e os 7 jobs HTTP batem nos endpoints sem header valido:
--        SELECT public.set_cron_secret('<CRON_SECRET da instalacao, >=16 chars>');
--      O valor DEVE ser o mesmo do env CRON_SECRET da aplicacao.
--   4. v_app_url apontando para a URL da PROPRIA instalacao (nunca de outra)
--
-- Substitua APP_URL_AQUI pela URL da instalacao alvo. Em ambiente descartavel,
-- prefira criar os jobs inativos (SELECT cron.unschedule(...) ou desative-os)
-- para nao gerar chamadas externas.
--
-- Idempotente: cron.unschedule condicional + cron.schedule.
-- =============================================================================

DO $$
DECLARE
  v_app_url text := 'APP_URL_AQUI';  -- ex.: https://project--<id>.lovable.app
  v_name    text;
  v_jobs    jsonb := jsonb_build_array(
    -- name, schedule, path
    jsonb_build_array('prune-post-media-30d',      '0 4 * * *',    '/api/public/media/prune'),
    jsonb_build_array('brain-consolidate-daily',   '0 3 * * *',    '/api/public/hooks/brain-consolidate'),
    jsonb_build_array('sla-overdue-check-hourly',  '5 * * * *',    '/api/public/cron/sla-check'),
    jsonb_build_array('meta-publish-scheduled',    '* * * * *',    '/api/public/meta/publish-scheduled'),
    jsonb_build_array('brain-synthesis-nightly',   '17 3 * * *',   '/api/public/hooks/brain-synthesis'),
    jsonb_build_array('brain-social-metrics-sync', '23 4 * * *',   '/api/public/hooks/social-metrics-sync'),
    jsonb_build_array('ai-models-health-daily',    '20 3 * * *',   '/api/public/hooks/ai-models-health'),
    -- Importacao de briefing: consumidor da fila + reaper de runs travadas
    jsonb_build_array('briefing-import-worker',    '* * * * *',    '/api/public/cron/import-worker'),
    jsonb_build_array('briefing-import-reaper',    '*/2 * * * *',  '/api/public/cron/import-reaper')

  );
  v_job jsonb;
BEGIN
  -- Jobs HTTP (x-cron-secret, nunca chave anon/publicavel)
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

  -- Jobs SQL diretos
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
END $$;
