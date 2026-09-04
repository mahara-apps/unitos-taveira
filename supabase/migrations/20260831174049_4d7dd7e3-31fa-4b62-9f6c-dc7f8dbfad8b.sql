ALTER TABLE public.briefing_import_runs
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS resume_step text;

ALTER TABLE public.briefing_import_steps
  ADD COLUMN IF NOT EXISTS output_ref text,
  ADD COLUMN IF NOT EXISTS content_hash text;

ALTER TABLE public.briefing_import_runs DROP CONSTRAINT IF EXISTS briefing_import_runs_status_chk;
ALTER TABLE public.briefing_import_runs ADD CONSTRAINT briefing_import_runs_status_chk
  CHECK (status = ANY (ARRAY[
    'queued','running','proposed','applying','applied',
    'failed','cancelled','discarded','paused','needs_input','expired'
  ]));

CREATE INDEX IF NOT EXISTS briefing_import_runs_lease_idx
  ON public.briefing_import_runs (status, lease_expires_at)
  WHERE status IN ('queued','running');

-- Reserva atômica de execuções da fila: um único vencedor por run.
CREATE OR REPLACE FUNCTION public.briefing_import_claim_lease(
  _owner text,
  _limit integer DEFAULT 3,
  _lease_seconds integer DEFAULT 120
)
RETURNS TABLE(
  id uuid,
  brand_id uuid,
  client_id uuid,
  created_by uuid,
  source_kind text,
  document_id uuid,
  raw_text text,
  attempt integer,
  max_attempts integer,
  resume_step text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT r.id
    FROM public.briefing_import_runs r
    WHERE r.status = 'queued'
      AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now())
      AND (r.deadline_at IS NULL OR r.deadline_at > now())
    ORDER BY r.created_at
    LIMIT GREATEST(_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.briefing_import_runs r
     SET status = 'running',
         lease_owner = _owner,
         lease_expires_at = now() + make_interval(secs => GREATEST(_lease_seconds, 30)),
         heartbeat_at = now(),
         started_at = COALESCE(r.started_at, now()),
         deadline_at = COALESCE(r.deadline_at, now() + interval '15 minutes'),
         error = NULL,
         error_kind = NULL,
         updated_at = now()
   WHERE r.id IN (SELECT c.id FROM candidates c)
  RETURNING r.id, r.brand_id, r.client_id, r.created_by, r.source_kind,
            r.document_id, r.raw_text, r.attempt, r.max_attempts, r.resume_step;
$$;

REVOKE ALL ON FUNCTION public.briefing_import_claim_lease(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_import_claim_lease(text, integer, integer) TO service_role;

-- Renovação do sinal de vida enquanto a etapa longa executa.
CREATE OR REPLACE FUNCTION public.briefing_import_heartbeat(
  _run_id uuid,
  _owner text,
  _lease_seconds integer DEFAULT 120
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upd AS (
    UPDATE public.briefing_import_runs
       SET heartbeat_at = now(),
           lease_expires_at = now() + make_interval(secs => GREATEST(_lease_seconds, 30)),
           updated_at = now()
     WHERE id = _run_id
       AND status = 'running'
       AND lease_owner = _owner
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM upd);
$$;

REVOKE ALL ON FUNCTION public.briefing_import_heartbeat(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.briefing_import_heartbeat(uuid, text, integer) TO service_role;

-- Recuperação de execuções abandonadas (isolate morto, deploy, timeout).
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
           error_kind = 'stalled',
           error = COALESCE(r.error, 'Processamento interrompido antes de concluir. Tente novamente.'),
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