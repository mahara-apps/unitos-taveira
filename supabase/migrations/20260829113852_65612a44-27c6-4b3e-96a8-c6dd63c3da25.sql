-- 1) Config de retenção para itens com falha definitiva (auditoria de 30 dias)
INSERT INTO public.brain_retention_config (key, value_days, description)
SELECT 'brain_learning_queue_failed_days', 30, 'Jobs com falha definitiva removidos após N dias'
WHERE NOT EXISTS (SELECT 1 FROM public.brain_retention_config WHERE key = 'brain_learning_queue_failed_days');

-- 2) Worker: descarta órfãos (evento inexistente) sem retry
CREATE OR REPLACE FUNCTION public.process_brain_learning_queue(_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_started    timestamptz := clock_timestamp();
  v_run_id     uuid;
  v_batch      uuid[];
  v_row        record;
  v_picked     integer := 0;
  v_processed  integer := 0;
  v_discarded  integer := 0;
  v_failed     integer := 0;
  v_orphans    integer := 0;
  v_created    integer := 0;
  v_updated    integer := 0;
  v_insights   integer := 0;
  v_edges      integer := 0;
  v_touched    integer := 0;
  v_alpha      numeric := 0.15;
  v_mem_id     uuid;
  v_was_new    boolean;
  v_scope_client uuid;
  v_ent_type   text;
  v_ent_id     uuid;
  v_category   text;
  v_title      text;
  v_counter    text;
  v_evidence   numeric;
  v_cons       integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('brain_learning_worker')) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'locked');
  END IF;

  INSERT INTO public.brain_worker_runs (job_name, status, started_at)
  VALUES ('brain_learning_worker', 'running', now())
  RETURNING id INTO v_run_id;

  WITH picked AS (
    SELECT id FROM public.brain_learning_queue
     WHERE status = 'queued'
     ORDER BY enqueued_at ASC
     LIMIT GREATEST(1, LEAST(_limit, 1000))
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.brain_learning_queue q
       SET status='processing', started_at=now(), attempts=q.attempts+1
      FROM picked
     WHERE q.id = picked.id
     RETURNING q.id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_batch FROM upd;

  v_picked := COALESCE(array_length(v_batch, 1), 0);

  -- Órfãos: evento de origem inexistente (ex.: partição podada/arquivada).
  -- Terminal imediato, sem retry e sem voltar para a fila.
  WITH o AS (
    UPDATE public.brain_learning_queue q
       SET status = 'skipped',
           processed_at = now(),
           started_at = NULL,
           error = 'orphan: source brain_event no longer exists'
     WHERE q.id = ANY(v_batch)
       AND (q.event_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id))
     RETURNING 1
  ) SELECT COUNT(*) INTO v_orphans FROM o;

  FOR v_row IN
    SELECT q.id AS queue_id, e.*
      FROM public.brain_learning_queue q
      JOIN public.brain_events e ON e.id = q.event_id
     WHERE q.id = ANY(v_batch) AND q.status = 'processing'
  LOOP
    BEGIN
      INSERT INTO public.brain_metrics_snapshots
        (brand_id, channel, metric_name, metric_value, period_start, period_end)
      VALUES
        (v_row.brand_id, COALESCE(NULLIF(v_row.source_module,''),'system'),
         'events.' || v_row.event_type, 1,
         (v_row.created_at AT TIME ZONE 'UTC')::date,
         (v_row.created_at AT TIME ZONE 'UTC')::date)
      ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                   COALESCE(channel, 'system'), metric_name, period_start)
      WHERE metric_name LIKE 'events.%'
      DO UPDATE SET metric_value = public.brain_metrics_snapshots.metric_value + 1;

      v_ent_type := NULL; v_ent_id := NULL; v_category := NULL;
      v_title := NULL; v_counter := NULL; v_evidence := NULL; v_scope_client := NULL;

      IF v_row.action IN ('approved','rejected','changes_requested','adjust','rework')
         AND v_row.client_id IS NOT NULL THEN
        v_scope_client := v_row.client_id;
        v_ent_type := 'client';
        v_ent_id   := v_row.client_id;
        v_category := 'padrao_de_aprovacao';
        v_title    := 'Padrão de decisão do cliente';
        v_counter  := CASE
                        WHEN v_row.action = 'approved' THEN 'approved'
                        WHEN v_row.action = 'rejected' THEN 'rejected'
                        ELSE 'adjust'
                      END;
        v_evidence := CASE WHEN v_row.action = 'approved' THEN 0.90 ELSE 0.35 END;

      ELSIF v_row.action IN ('published','delivered') AND v_row.brand_id IS NOT NULL THEN
        v_ent_type := 'brand';
        v_ent_id   := v_row.brand_id;
        v_category := 'cadencia_de_publicacao';
        v_title    := 'Cadência de publicação da marca';
        v_counter  := 'published';
        v_evidence := 0.85;

      ELSIF v_row.action IN ('overdue','failed','cancelled') AND v_row.brand_id IS NOT NULL THEN
        v_ent_type := 'brand';
        v_ent_id   := v_row.brand_id;
        v_category := 'riscos_operacionais';
        v_title    := 'Recorrência de atrasos e falhas';
        v_counter  := 'incident';
        v_evidence := 0.60;
      END IF;

      IF v_category IS NULL THEN
        v_discarded := v_discarded + 1;
      ELSE
        INSERT INTO public.brain_memory(
          brand_id, client_id, subject_type, subject_id, memory_type, scope, key,
          entity_type, entity_id, category, title, description,
          content, confidence, previous_confidence, reinforcement_count,
          source_event, source_refs, origin, status, tags, relations, metadata,
          access_count, last_accessed_at
        )
        VALUES (
          v_row.brand_id, v_scope_client, v_ent_type, v_ent_id, 'pattern',
          CASE WHEN v_scope_client IS NOT NULL THEN 'client'
               WHEN v_row.brand_id IS NULL THEN 'global' ELSE 'brand' END,
          v_ent_type || ':' || v_ent_id::text || ':' || v_category,
          v_ent_type, v_ent_id, v_category, v_title, '',
          jsonb_build_object(v_counter, 1, 'sample', 1,
                             'first_event_at', v_row.created_at,
                             'last_event_at', v_row.created_at),
          v_evidence, NULL, 1,
          v_row.id, jsonb_build_array(v_row.id), 'learning', 'active',
          ARRAY[v_category, v_ent_type]::text[], '[]'::jsonb,
          jsonb_build_object('source_module', v_row.source_module),
          1, now()
        )
        ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     entity_type, entity_id, category, title)
        DO UPDATE SET
          client_id           = COALESCE(public.brain_memory.client_id, EXCLUDED.client_id),
          previous_confidence = public.brain_memory.confidence,
          confidence          = GREATEST(0.05, LEAST(0.99,
            public.brain_memory.confidence + v_alpha * (v_evidence - public.brain_memory.confidence))),
          reinforcement_count = public.brain_memory.reinforcement_count + 1,
          access_count        = public.brain_memory.access_count + 1,
          last_accessed_at    = now(),
          updated_at          = now(),
          source_event        = v_row.id,
          status              = 'active',
          source_refs         = (
            CASE jsonb_typeof(public.brain_memory.source_refs)
              WHEN 'array' THEN
                CASE WHEN jsonb_array_length(public.brain_memory.source_refs) > 50
                     THEN '[]'::jsonb ELSE public.brain_memory.source_refs END
              ELSE '[]'::jsonb
            END) || jsonb_build_array(v_row.id),
          content = jsonb_set(
                      jsonb_set(
                        jsonb_set(COALESCE(public.brain_memory.content, '{}'::jsonb),
                          ARRAY[v_counter],
                          to_jsonb(COALESCE((public.brain_memory.content->>v_counter)::int, 0) + 1), true),
                        '{sample}',
                        to_jsonb(COALESCE((public.brain_memory.content->>'sample')::int, 0) + 1), true),
                      '{last_event_at}', to_jsonb(v_row.created_at), true)
        RETURNING id, (public.brain_memory.previous_confidence IS NULL)
        INTO v_mem_id, v_was_new;

        UPDATE public.brain_memory
           SET description = public.brain_render_memory_desc(category, content)
         WHERE id = v_mem_id;

        IF COALESCE(v_was_new, true) THEN
          v_created := v_created + 1;
        ELSE
          v_updated := v_updated + 1;
        END IF;

        v_edges := v_edges + COALESCE(public.derive_relationships_from_event(v_row.id), 0);
      END IF;

      IF v_row.action = 'rejected' AND v_row.client_id IS NOT NULL THEN
        IF (SELECT COUNT(*) FROM public.brain_events
             WHERE brand_id = v_row.brand_id AND client_id = v_row.client_id
               AND action = 'rejected' AND created_at >= now() - interval '24 hours') >= 3 THEN
          INSERT INTO public.brain_insights
            (brand_id, client_id, insight_type, description, confidence, based_on_events, expires_at)
          SELECT v_row.brand_id, v_row.client_id, 'client_rejection_spike',
                 'Cliente com 3+ rejeições em 24h — revisar briefing/direção criativa.',
                 0.85, 3, now() + interval '7 days'
          WHERE NOT EXISTS (
            SELECT 1 FROM public.brain_insights
             WHERE brand_id = v_row.brand_id AND client_id = v_row.client_id
               AND insight_type = 'client_rejection_spike'
               AND created_at >= now() - interval '24 hours');
          GET DIAGNOSTICS v_touched = ROW_COUNT;
          v_insights := v_insights + v_touched;
        END IF;
      END IF;

      IF v_row.action = 'overdue' AND v_row.project_id IS NOT NULL THEN
        INSERT INTO public.brain_insights
          (brand_id, client_id, insight_type, description, confidence, based_on_events, expires_at)
        SELECT v_row.brand_id, v_row.client_id, 'project_overdue_signal',
               'Projeto acumulando tarefas em atraso — recalcular capacidade.',
               0.8, 1, now() + interval '3 days'
        WHERE NOT EXISTS (
          SELECT 1 FROM public.brain_insights
           WHERE brand_id = v_row.brand_id
             AND COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid)
               = COALESCE(v_row.client_id, '00000000-0000-0000-0000-000000000000'::uuid)
             AND insight_type = 'project_overdue_signal'
             AND created_at >= now() - interval '24 hours');
        GET DIAGNOSTICS v_touched = ROW_COUNT;
        v_insights := v_insights + v_touched;
      END IF;

      UPDATE public.brain_events SET processed_at = now() WHERE id = v_row.id;
      UPDATE public.brain_learning_queue
         SET status='done', processed_at=now(), error=NULL
       WHERE id = v_row.queue_id;

      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.brain_learning_queue
         SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
             error  = SQLERRM,
             processed_at = CASE WHEN attempts >= 5 THEN now() ELSE NULL END
       WHERE id = v_row.queue_id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  IF v_processed > 0 THEN
    BEGIN
      v_cons := public.consolidate_brain_memory(NULL);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.brain_worker_runs
         SET error = 'consolidate_failed: ' || SQLERRM
       WHERE id = v_run_id;
    END;
  END IF;

  DELETE FROM public.brain_learning_queue
   WHERE id IN (SELECT id FROM public.brain_learning_queue
                 WHERE status IN ('done','skipped') AND processed_at < now() - interval '7 days'
                 LIMIT 500);
  DELETE FROM public.brain_worker_runs
   WHERE started_at < now() - interval '14 days';

  UPDATE public.brain_worker_runs
     SET status = CASE WHEN v_failed > 0 THEN 'partial' ELSE 'ok' END,
         finished_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int),
         picked = v_picked, processed = v_processed, discarded = v_discarded + v_orphans,
         failed = v_failed, memories_created = v_created, memories_updated = v_updated,
         insights_created = v_insights, edges_created = v_edges
   WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'picked', v_picked, 'processed', v_processed, 'discarded', v_discarded,
    'orphans_skipped', v_orphans,
    'failed', v_failed, 'memories_created', v_created, 'memories_updated', v_updated,
    'insights', v_insights, 'edges', v_edges,
    'duration_ms', GREATEST(0, (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int));
END;
$function$;

-- 3) Reaper: órfão travado nunca volta para 'queued'
CREATE OR REPLACE FUNCTION public.reap_brain_learning_queue()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  WITH u AS (
    UPDATE public.brain_learning_queue q
       SET status = CASE
                      WHEN q.event_id IS NULL
                        OR NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id)
                        THEN 'skipped'
                      WHEN q.attempts >= 5 THEN 'failed'
                      ELSE 'queued'
                    END,
           error = CASE
                     WHEN q.event_id IS NULL
                       OR NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id)
                       THEN 'orphan: source brain_event no longer exists'
                     ELSE COALESCE(q.error, 'reaped: processing stalled')
                   END,
           processed_at = CASE
                            WHEN q.event_id IS NULL
                              OR NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id)
                              THEN now()
                            WHEN q.attempts >= 5 THEN now()
                            ELSE NULL
                          END,
           started_at = NULL
     WHERE q.status = 'processing' AND q.started_at < now() - interval '10 minutes'
     RETURNING 1
  ) SELECT COUNT(*) INTO n FROM u;
  RETURN n;
END $function$;

-- 4) Retenção: status reais ('done'/'skipped'/'failed'/'dead') e prazo próprio p/ falhas
CREATE OR REPLACE FUNCTION public.brain_cleanup_ttl()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  q_days int := public._brain_cfg_days('brain_learning_queue_done_days', 7);
  f_days int := public._brain_cfg_days('brain_learning_queue_failed_days', 30);
  i_days int := public._brain_cfg_days('brain_insights_expired_days', 30);
  r_days int := public._brain_cfg_days('brain_recommendations_done_days', 30);
  m_days int := public._brain_cfg_days('brain_metrics_snapshots_days', 730);
  v_days int := public._brain_cfg_days('brain_memory_versions_days', 365);
  q_del int; f_del int; i_del int; r_del int; m_del int; v_del int;
  emb_orphans int; lq_orphans int;
BEGIN
  WITH d AS (DELETE FROM public.brain_learning_queue
              WHERE status IN ('done','processed','skipped')
                AND COALESCE(processed_at, updated_at) < now() - (q_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO q_del FROM d;
  WITH d AS (DELETE FROM public.brain_learning_queue
              WHERE status IN ('failed','dead')
                AND COALESCE(processed_at, updated_at) < now() - (f_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO f_del FROM d;
  WITH d AS (DELETE FROM public.brain_insights
              WHERE expires_at IS NOT NULL
                AND expires_at < now() - (i_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO i_del FROM d;
  WITH d AS (DELETE FROM public.brain_recommendations
              WHERE status IN ('dismissed','completed','expired')
                AND updated_at < now() - (r_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO r_del FROM d;
  WITH d AS (DELETE FROM public.brain_metrics_snapshots
              WHERE created_at < now() - (m_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO m_del FROM d;
  WITH d AS (DELETE FROM public.brain_memory_versions
              WHERE created_at < now() - (v_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO v_del FROM d;
  WITH d AS (
    DELETE FROM public.brain_embeddings e
     WHERE e.event_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.brain_events ev WHERE ev.id = e.event_id)
    RETURNING 1) SELECT count(*) INTO emb_orphans FROM d;
  WITH d AS (
    DELETE FROM public.brain_learning_queue lq
     WHERE lq.event_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.brain_events ev WHERE ev.id = lq.event_id)
    RETURNING 1) SELECT count(*) INTO lq_orphans FROM d;

  RETURN jsonb_build_object(
    'learning_queue_done', q_del, 'learning_queue_failed', f_del,
    'insights_expired', i_del,
    'recommendations_done', r_del, 'metrics_snapshots', m_del,
    'memory_versions', v_del, 'embeddings_orphans', emb_orphans,
    'learning_queue_orphans', lq_orphans);
END $function$;

-- 5) Limpeza pontual: fila órfã (evento inexistente) e fila de marcas inexistentes.
--    Afeta SOMENTE brain_learning_queue.
DELETE FROM public.brain_learning_queue lq
 WHERE lq.event_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.brain_events ev WHERE ev.id = lq.event_id);

DELETE FROM public.brain_learning_queue lq
 WHERE lq.brand_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = lq.brand_id);