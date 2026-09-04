CREATE OR REPLACE FUNCTION public.reconcile_client_document_ai(_brand_id uuid, _client_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _touched integer := 0;
  _n integer := 0;
BEGIN
  IF _brand_id IS NULL OR _client_id IS NULL THEN
    RETURN 0;
  END IF;
  IF NOT public.can_access_client(_client_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH latest AS (
    SELECT r.document_id, r.status, r.error,
           row_number() OVER (PARTITION BY r.document_id ORDER BY r.created_at DESC) AS rn
      FROM public.briefing_import_runs r
     WHERE r.brand_id = _brand_id
       AND r.client_id = _client_id
       AND r.document_id IS NOT NULL
  ), upd AS (
    UPDATE public.client_documents d
       SET ai_status = 'failed',
           ai_error = COALESCE(NULLIF(l.error, ''), 'A leitura nao foi concluida. Tente analisar novamente.'),
           updated_at = now()
      FROM latest l
     WHERE l.rn = 1
       AND l.document_id = d.id
       AND d.brand_id = _brand_id
       AND d.client_id = _client_id
       AND d.ai_status IN ('queued', 'running')
       AND l.status IN ('failed', 'expired', 'cancelled')
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM upd;
  _touched := _touched + _n;

  WITH upd2 AS (
    UPDATE public.client_documents d
       SET ai_status = 'failed',
           ai_error = COALESCE(NULLIF(d.ai_error, ''), 'A leitura ficou parada e foi encerrada. Clique em Reanalisar para tentar de novo.'),
           updated_at = now()
     WHERE d.brand_id = _brand_id
       AND d.client_id = _client_id
       AND d.ai_status IN ('queued', 'running')
       AND d.updated_at < now() - interval '20 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM public.briefing_import_runs r
          WHERE r.document_id = d.id
            AND r.status IN ('queued', 'running')
       )
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM upd2;
  _touched := _touched + _n;

  RETURN _touched;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_client_document_ai(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_client_document_ai(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_client_document_ai(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.briefing_import_reap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _requeued integer := 0;
  _expired integer := 0;
  _docs integer := 0;
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
           error_kind = COALESCE(NULLIF(r.error_kind, ''), CASE WHEN NULLIF(r.error, '') IS NOT NULL THEN NULL ELSE 'stalled' END, 'stalled'),
           error = COALESCE(NULLIF(r.error, ''), 'Processamento interrompido antes de concluir. Tente novamente.'),
           updated_at = now()
     WHERE r.id IN (SELECT id FROM dead)
    RETURNING r.id, r.document_id, r.error
  ), docs AS (
    UPDATE public.client_documents d
       SET ai_status = 'failed',
           ai_error = COALESCE(NULLIF(u.error, ''), 'Processamento interrompido antes de concluir. Tente novamente.'),
           updated_at = now()
      FROM upd2 u
     WHERE u.document_id = d.id
       AND d.ai_status IN ('queued','running')
    RETURNING 1
  ), counted AS (
    SELECT (SELECT count(*) FROM upd2) AS runs, (SELECT count(*) FROM docs) AS synced
  )
  SELECT runs, synced INTO _expired, _docs FROM counted;

  -- Documentos presos sem nenhuma execucao viva (kick perdido, isolate morto).
  UPDATE public.client_documents d
     SET ai_status = 'failed',
         ai_error = COALESCE(NULLIF(d.ai_error, ''), 'A leitura ficou parada e foi encerrada. Clique em Reanalisar para tentar de novo.'),
         updated_at = now()
   WHERE d.ai_status IN ('queued','running')
     AND d.updated_at < now() - interval '20 minutes'
     AND NOT EXISTS (
       SELECT 1 FROM public.briefing_import_runs r
        WHERE r.document_id = d.id
          AND r.status IN ('queued','running')
     );

  RETURN jsonb_build_object('requeued', _requeued, 'expired', _expired, 'documents_synced', _docs);
END;
$$;
