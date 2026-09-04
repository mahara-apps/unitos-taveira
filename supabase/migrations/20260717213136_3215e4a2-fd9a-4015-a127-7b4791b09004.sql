
CREATE OR REPLACE FUNCTION public.process_brain_learning_queue(_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch uuid[];
  v_row record;
  v_processed integer := 0;
  v_failed    integer := 0;
  v_memories  integer := 0;
  v_insights  integer := 0;
  v_edges     integer := 0;
  v_versions  integer := 0;
  v_touched   integer := 0;
  v_alpha     numeric := 0.1;
  v_mem_id    uuid;
  v_prev_conf numeric;
  v_new_conf  numeric;
  v_mem_ent_type text;
  v_mem_ent_id   uuid;
  v_mem_title    text;
  v_mem_desc     text;
  v_evidence     numeric;
BEGIN
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

  IF array_length(v_batch, 1) IS NULL THEN
    RETURN jsonb_build_object('processed',0,'failed',0,'memories',0,'insights',0,'edges',0,'versions',0);
  END IF;

  FOR v_row IN
    SELECT q.id AS queue_id, e.*
      FROM public.brain_learning_queue q
      JOIN public.brain_events e ON e.id = q.event_id
     WHERE q.id = ANY(v_batch)
  LOOP
    BEGIN
      INSERT INTO public.brain_metrics_snapshots
        (brand_id, channel, metric_name, metric_value, period_start, period_end)
      VALUES
        (v_row.brand_id, COALESCE(v_row.source_module,'system'),
         'events.' || v_row.event_type, 1,
         (v_row.created_at AT TIME ZONE 'UTC')::date,
         (v_row.created_at AT TIME ZONE 'UTC')::date);

      v_mem_ent_type := COALESCE(NULLIF(v_row.entity_type,''), NULLIF(v_row.source_module,''), 'system');
      v_mem_ent_id   := COALESCE(v_row.entity_id, v_row.client_id, v_row.project_id,
                                 v_row.brand_id, '00000000-0000-0000-0000-000000000000'::uuid);
      v_mem_title    := v_row.event_type || ' • ' || v_mem_ent_type;
      v_mem_desc     := 'Padrão observado em ' || v_mem_ent_type ||
                        COALESCE(' (' || v_row.action || ')','') ||
                        '. Último evento em ' || to_char(v_row.created_at,'YYYY-MM-DD HH24:MI') || ' UTC.';

      v_evidence := CASE
        WHEN v_row.action IN ('approved','published','completed','delivered') THEN 0.90
        WHEN v_row.action IN ('rejected','failed','overdue','cancelled')      THEN 0.15
        ELSE 0.60
      END;

      INSERT INTO public.brain_memory(
        brand_id, subject_type, subject_id, memory_type, scope, key,
        entity_type, entity_id, category, title, description,
        content, confidence, previous_confidence, reinforcement_count,
        source_event, source_refs, origin, status, tags, relations, metadata,
        access_count, last_accessed_at
      )
      VALUES (
        v_row.brand_id, v_mem_ent_type, v_mem_ent_id, 'pattern',
        CASE WHEN v_row.brand_id IS NULL THEN 'global' ELSE 'brand' END,
        v_row.event_type || ':' || v_mem_ent_type || ':' || v_mem_ent_id::text,
        v_mem_ent_type, v_mem_ent_id, v_row.event_type, v_mem_title, v_mem_desc,
        jsonb_build_object(
          'last_action',      v_row.action,
          'last_event_id',    v_row.id,
          'last_event_at',    v_row.created_at,
          'first_event_at',   v_row.created_at,
          'occurrence_count', 1,
          'source_module',    v_row.source_module
        ),
        v_evidence, NULL, 1,
        v_row.id, jsonb_build_array(v_row.id), 'learning', 'active',
        ARRAY[v_row.event_type, v_mem_ent_type]::text[],
        '[]'::jsonb,
        jsonb_build_object('source_module', v_row.source_module),
        1, now()
      )
      ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                   entity_type, entity_id, category, title)
      DO UPDATE SET
        previous_confidence = public.brain_memory.confidence,
        confidence          = GREATEST(0.05, LEAST(0.99,
          public.brain_memory.confidence + v_alpha * (v_evidence - public.brain_memory.confidence))),
        reinforcement_count = public.brain_memory.reinforcement_count + 1,
        access_count        = public.brain_memory.access_count + 1,
        last_accessed_at    = now(),
        updated_at          = now(),
        source_event        = v_row.id,
        description         = EXCLUDED.description,
        source_refs         = (
          CASE jsonb_typeof(public.brain_memory.source_refs)
            WHEN 'array' THEN public.brain_memory.source_refs
            ELSE '[]'::jsonb
          END
        ) || jsonb_build_array(v_row.id),
        content = jsonb_set(
                    jsonb_set(
                      jsonb_set(COALESCE(public.brain_memory.content, '{}'::jsonb),
                        '{last_action}', COALESCE(to_jsonb(v_row.action), 'null'::jsonb), true),
                      '{last_event_id}', COALESCE(to_jsonb(v_row.id), 'null'::jsonb), true),
                    '{occurrence_count}',
                    to_jsonb(COALESCE((public.brain_memory.content->>'occurrence_count')::int, 0) + 1),
                    true)
      RETURNING id, previous_confidence, confidence
      INTO v_mem_id, v_prev_conf, v_new_conf;

      v_memories := v_memories + 1;
      v_versions := v_versions + 1;

      v_edges := v_edges + COALESCE(public.derive_relationships_from_event(v_row.id), 0);

      IF v_row.action = 'rejected' AND v_row.client_id IS NOT NULL THEN
        IF (SELECT COUNT(*) FROM public.brain_events
             WHERE brand_id = v_row.brand_id AND client_id = v_row.client_id
               AND action = 'rejected' AND created_at >= now() - interval '24 hours') >= 3 THEN
          INSERT INTO public.brain_insights
            (brand_id, insight_type, description, confidence, based_on_events, expires_at)
          SELECT v_row.brand_id, 'client_rejection_spike',
                 'Cliente com 3+ rejeições em 24h — revisar briefing/direção criativa.',
                 0.85, 3, now() + interval '7 days'
          WHERE NOT EXISTS (
            SELECT 1 FROM public.brain_insights
             WHERE brand_id = v_row.brand_id AND insight_type = 'client_rejection_spike'
               AND created_at >= now() - interval '24 hours');
          GET DIAGNOSTICS v_touched = ROW_COUNT;
          v_insights := v_insights + v_touched;
        END IF;
      END IF;

      IF v_row.action = 'overdue' AND v_row.project_id IS NOT NULL THEN
        INSERT INTO public.brain_insights
          (brand_id, insight_type, description, confidence, based_on_events, expires_at)
        SELECT v_row.brand_id, 'project_overdue_signal',
               'Projeto acumulando tarefas em atraso — recalcular capacidade.',
               0.8, 1, now() + interval '3 days'
        WHERE NOT EXISTS (
          SELECT 1 FROM public.brain_insights
           WHERE brand_id = v_row.brand_id AND insight_type = 'project_overdue_signal'
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

  PERFORM public.consolidate_brain_memory(NULL);

  RETURN jsonb_build_object(
    'processed', v_processed, 'failed', v_failed,
    'memories',  v_memories,  'insights', v_insights,
    'edges',     v_edges,     'versions', v_versions);
END $function$;
