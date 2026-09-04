
CREATE TABLE IF NOT EXISTS public.brain_learning_queue (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL REFERENCES public.brain_events(id) ON DELETE CASCADE,
  brand_id       uuid,
  status         text NOT NULL DEFAULT 'queued',
  attempts       integer NOT NULL DEFAULT 0,
  error          text,
  enqueued_at    timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  processed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.brain_learning_queue TO authenticated;
GRANT ALL ON public.brain_learning_queue TO service_role;
ALTER TABLE public.brain_learning_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read queue for their brands" ON public.brain_learning_queue;
CREATE POLICY "Members read queue for their brands"
  ON public.brain_learning_queue FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid()))
  );

CREATE INDEX IF NOT EXISTS idx_brain_learning_queue_status
  ON public.brain_learning_queue (status, enqueued_at)
  WHERE status IN ('queued','processing');
CREATE INDEX IF NOT EXISTS idx_brain_learning_queue_brand ON public.brain_learning_queue (brand_id);

DROP TRIGGER IF EXISTS trg_brain_learning_queue_updated ON public.brain_learning_queue;
CREATE TRIGGER trg_brain_learning_queue_updated
  BEFORE UPDATE ON public.brain_learning_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enqueue_brain_event_for_learning()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.brain_learning_queue (event_id, brand_id) VALUES (NEW.id, NEW.brand_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_brain_events_enqueue_learning ON public.brain_events;
CREATE TRIGGER trg_brain_events_enqueue_learning
  AFTER INSERT ON public.brain_events
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_brain_event_for_learning();

CREATE OR REPLACE FUNCTION public.process_brain_learning_queue(_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch uuid[];
  v_row record;
  v_processed integer := 0;
  v_failed    integer := 0;
  v_memories  integer := 0;
  v_insights  integer := 0;
  v_touched   integer := 0;
  v_alpha     numeric := 0.1;
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
    RETURN jsonb_build_object('processed',0,'failed',0,'memories',0,'insights',0);
  END IF;

  FOR v_row IN
    SELECT q.id AS queue_id, e.*
      FROM public.brain_learning_queue q
      JOIN public.brain_events e ON e.id = q.event_id
     WHERE q.id = ANY(v_batch)
  LOOP
    BEGIN
      -- Métricas: contagem por evento por dia
      INSERT INTO public.brain_metrics_snapshots
        (brand_id, channel, metric_name, metric_value, period_start, period_end)
      VALUES
        (v_row.brand_id, COALESCE(v_row.source_module,'system'),
         'events.' || v_row.event_type, 1,
         (v_row.created_at AT TIME ZONE 'UTC')::date,
         (v_row.created_at AT TIME ZONE 'UTC')::date);

      -- Memória: EMA de confiança + acesso
      UPDATE public.brain_memory m
         SET confidence = GREATEST(0.05, LEAST(0.99,
               m.confidence + v_alpha * (
                 CASE
                   WHEN v_row.action IN ('approved','published','completed','delivered') THEN 1.0
                   WHEN v_row.action IN ('rejected','failed','overdue','cancelled')      THEN 0.0
                   ELSE m.confidence
                 END - m.confidence)
             )),
             access_count = m.access_count + 1,
             last_accessed_at = now(),
             updated_at = now()
       WHERE COALESCE(m.brand_id,'00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(v_row.brand_id,'00000000-0000-0000-0000-000000000000'::uuid)
         AND (
              (m.entity_type = v_row.entity_type AND m.entity_id = v_row.entity_id)
           OR (v_row.client_id  IS NOT NULL AND m.entity_type='client'  AND m.entity_id = v_row.client_id)
           OR (v_row.project_id IS NOT NULL AND m.entity_type='project' AND m.entity_id = v_row.project_id)
         );
      GET DIAGNOSTICS v_touched = ROW_COUNT;
      v_memories := v_memories + v_touched;

      -- Insight: 3+ rejeições no cliente em 24h
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

      -- Insight: sinal de atraso em projeto
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
             error = SQLERRM,
             processed_at = CASE WHEN attempts >= 5 THEN now() ELSE NULL END
       WHERE id = v_row.queue_id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  PERFORM public.consolidate_brain_memory(NULL);

  RETURN jsonb_build_object('processed',v_processed,'failed',v_failed,'memories',v_memories,'insights',v_insights);
END $$;

GRANT EXECUTE ON FUNCTION public.process_brain_learning_queue(integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.process_brain_learning_queue(integer) FROM anon, public;

CREATE OR REPLACE FUNCTION public.reap_brain_learning_queue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH u AS (
    UPDATE public.brain_learning_queue
       SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
           error = COALESCE(error, 'reaped: processing stalled'),
           started_at = NULL
     WHERE status = 'processing' AND started_at < now() - interval '10 minutes'
     RETURNING 1
  ) SELECT COUNT(*) INTO n FROM u;
  RETURN n;
END $$;

DO $$ BEGIN PERFORM cron.unschedule('brain-learning-worker'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('brain-learning-reaper'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('brain-learning-worker','* * * * *',$$ SELECT public.process_brain_learning_queue(200); $$);
SELECT cron.schedule('brain-learning-reaper','*/5 * * * *',$$ SELECT public.reap_brain_learning_queue(); $$);
