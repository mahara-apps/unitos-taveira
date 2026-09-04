ALTER TABLE public.ai_jobs
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

CREATE INDEX IF NOT EXISTS ai_jobs_active_lease_idx
  ON public.ai_jobs (status, lease_expires_at)
  WHERE status IN ('queued','running');

CREATE OR REPLACE FUNCTION public.ai_job_lease_ttl(_kind text)
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _kind
    WHEN 'monthly_plan' THEN interval '12 minutes'
    WHEN 'customer_strategy' THEN interval '15 minutes'
    ELSE interval '5 minutes'
  END
$$;

CREATE OR REPLACE FUNCTION public.ai_job_claim_lease(_job_id uuid, _owner text, _lease_seconds integer DEFAULT 120)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean := false;
BEGIN
  IF _owner IS NULL OR length(btrim(_owner)) = 0 THEN
    RETURN false;
  END IF;
  UPDATE public.ai_jobs
     SET lease_owner = _owner,
         lease_expires_at = now() + make_interval(secs => greatest(_lease_seconds, 10)),
         heartbeat_at = now(),
         updated_at = now()
   WHERE id = _job_id
     AND status IN ('queued','running')
     AND (auth.uid() IS NULL OR user_id = auth.uid())
     AND (
       lease_owner IS NULL
       OR lease_owner = _owner
       OR lease_expires_at IS NULL
       OR lease_expires_at < now()
     );
  ok := FOUND;
  RETURN ok;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_job_heartbeat(_job_id uuid, _owner text, _lease_seconds integer DEFAULT 120)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean := false;
BEGIN
  UPDATE public.ai_jobs
     SET lease_expires_at = now() + make_interval(secs => greatest(_lease_seconds, 10)),
         heartbeat_at = now(),
         updated_at = now()
   WHERE id = _job_id
     AND lease_owner = _owner
     AND status IN ('queued','running')
     AND (auth.uid() IS NULL OR user_id = auth.uid());
  ok := FOUND;
  RETURN ok;
END;
$$;

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
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE status IN ('queued','running')
       AND (
         (lease_expires_at IS NOT NULL AND lease_expires_at < now())
         OR (
           lease_expires_at IS NULL
           AND COALESCE(heartbeat_at, updated_at) < now() - public.ai_job_lease_ttl(kind)
         )
       )
     RETURNING 1
  )
  SELECT count(*) INTO reaped FROM updated;
  RETURN reaped;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stuck_ai_jobs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reap_stuck_ai_jobs() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stuck_ai_jobs() TO service_role;

REVOKE ALL ON FUNCTION public.ai_job_claim_lease(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_job_heartbeat(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_job_claim_lease(uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_job_heartbeat(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_job_claim_lease(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_job_heartbeat(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_job_lease_ttl(text) TO authenticated, service_role;