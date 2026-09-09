-- lovable-cron-fallback-reviewed: 1440 runs/day; fila de legendas de conteúdo: worker HTTP externo (agente de IA) que precisa concluir a legenda em ~1min após a aprovação da pauta, mesmo padrão do briefing-import-worker já existente
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS ai_phase_error text;

COMMENT ON COLUMN public.posts.ai_phase_error IS
  'Motivo da última falha de geração de legenda (classificação curta em pt-BR). NULL quando concluída.';

UPDATE public.posts
   SET ai_phase = 'copy_failed_retryable'
 WHERE ai_phase = 'copy_running'
   AND deleted_at IS NULL
   AND coalesce(copy, '') = ''
   AND (ai_phase_at IS NULL OR ai_phase_at < now() - interval '10 minutes');

DO $$
DECLARE
  v_url text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente: agendamento post-content-resume nao criado';
    RETURN;
  END IF;

  SELECT regexp_replace(command, '.*url := ''([^'']+)/api/public/.*', '\1')
    INTO v_url
    FROM cron.job
   WHERE command LIKE '%/api/public/%'
   ORDER BY jobname
   LIMIT 1;

  IF v_url IS NULL OR v_url = '' THEN
    RAISE NOTICE 'URL da instalacao nao encontrada: post-content-resume nao criado';
    RETURN;
  END IF;

  PERFORM cron.unschedule('post-content-resume')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-content-resume');

  PERFORM cron.schedule(
    'post-content-resume',
    '* * * * *',
    format($fmt$select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.cron_secret()),
        body := '{"limit":3}'::jsonb
      );$fmt$, v_url || '/api/public/hooks/resume-post-content')
  );
END $$;