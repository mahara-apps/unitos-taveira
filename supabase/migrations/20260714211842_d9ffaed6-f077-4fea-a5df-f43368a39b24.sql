
-- 1) Reaper SQL puro (sem depender de HTTP/deploy)
CREATE OR REPLACE FUNCTION public.reap_stuck_ai_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reaped integer;
BEGIN
  WITH updated AS (
    UPDATE public.ai_jobs
       SET status = 'failed',
           error = COALESCE(error, 'timeout: worker interrompido antes da conclusão'),
           finished_at = now(),
           step_label = NULL,
           updated_at = now()
     WHERE status IN ('queued','running')
       AND updated_at < now() - interval '5 minutes'
     RETURNING 1
  )
  SELECT count(*) INTO reaped FROM updated;
  RETURN reaped;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stuck_ai_jobs() FROM PUBLIC, anon, authenticated;

-- 2) Substitui o cron HTTP por SQL direto
DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'ai-jobs-reaper';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'ai-jobs-reaper',
  '*/2 * * * *',
  $$SELECT public.reap_stuck_ai_jobs();$$
);

-- 3) Encerra jobs atualmente travados
SELECT public.reap_stuck_ai_jobs();
