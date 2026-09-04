CREATE OR REPLACE FUNCTION public.briefing_import_reap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _requeued integer := 0;
  _expired integer := 0;
BEGIN
  WITH stalled AS (
    SELECT id FROM public.briefing_import_runs
     WHERE status = 'running'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < now()
       AND attempt + 1 < max_attempts
       AND (deadline_at IS NULL OR deadline_at > now())
     LIMIT 50
  ), upd AS (
    UPDATE public.briefing_import_runs r
       SET status = 'queued',
           attempt = r.attempt + 1,
           lease_owner = NULL,
           lease_expires_at = NULL,
           resume_step = COALESCE(r.resume_step, r.current_step),
           error = NULL,
           error_kind = NULL,
           updated_at = now()
     WHERE r.id IN (SELECT id FROM stalled)
    RETURNING 1
  )
  SELECT count(*) INTO _requeued FROM upd;

  WITH dead AS (
    SELECT id FROM public.briefing_import_runs
     WHERE status IN ('queued','running')
       AND (
         (deadline_at IS NOT NULL AND deadline_at < now())
         OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
       )
     LIMIT 50
  ), upd2 AS (
    UPDATE public.briefing_import_runs r
       SET status = 'expired',
           lease_owner = NULL,
           lease_expires_at = NULL,
           finished_at = now(),
           -- Preserva a causa REAL persistida pelo worker; 'stalled' apenas
           -- quando nao ha erro anterior registrado.
           error_kind = COALESCE(NULLIF(r.error_kind, ''), CASE WHEN NULLIF(r.error, '') IS NOT NULL THEN NULL ELSE 'stalled' END, 'stalled'),
           error = COALESCE(NULLIF(r.error, ''), 'Processamento interrompido antes de concluir. Tente novamente.'),
           updated_at = now()
     WHERE r.id IN (SELECT id FROM dead)
    RETURNING 1
  )
  SELECT count(*) INTO _expired FROM upd2;

  RETURN jsonb_build_object('requeued', _requeued, 'expired', _expired);
END;
$$;

REVOKE ALL ON FUNCTION public.briefing_import_reap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_import_reap() TO service_role;