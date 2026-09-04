
-- ============ Knowledge Graph: schema, upsert, queries, learning integration ============

-- 1) Deterministic uniqueness for upserts
CREATE UNIQUE INDEX IF NOT EXISTS brain_relationships_unique_edge
  ON public.brain_relationships (
    COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
    from_type, from_id, to_type, to_id, relationship_type
  );

CREATE INDEX IF NOT EXISTS brain_relationships_from_idx
  ON public.brain_relationships (brand_id, from_type, from_id);
CREATE INDEX IF NOT EXISTS brain_relationships_to_idx
  ON public.brain_relationships (brand_id, to_type, to_id);
CREATE INDEX IF NOT EXISTS brain_relationships_type_idx
  ON public.brain_relationships (brand_id, relationship_type);

-- 2) Upsert helper — deterministic, no AI, used by learning engine
CREATE OR REPLACE FUNCTION public.upsert_brain_relationship(
  _brand_id uuid,
  _from_type text, _from_id uuid,
  _to_type text,   _to_id uuid,
  _rel_type text,
  _strength_delta numeric DEFAULT 0.05,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _bidirectional boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF _from_id IS NULL OR _to_id IS NULL OR _from_type IS NULL OR _to_type IS NULL THEN
    RETURN NULL;
  END IF;
  IF _from_type = _to_type AND _from_id = _to_id THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.brain_relationships
    (brand_id, from_type, from_id, to_type, to_id, relationship_type,
     strength, confidence, bidirectional, metadata, observation_count, last_observed_at)
  VALUES
    (_brand_id, _from_type, _from_id, _to_type, _to_id, _rel_type,
     LEAST(1.0, GREATEST(0.05, _strength_delta)), 0.5, _bidirectional, _metadata, 1, now())
  ON CONFLICT (
    COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
    from_type, from_id, to_type, to_id, relationship_type
  ) DO UPDATE SET
    strength = LEAST(1.0, public.brain_relationships.strength + _strength_delta),
    confidence = LEAST(0.99, public.brain_relationships.confidence + 0.02),
    observation_count = public.brain_relationships.observation_count + 1,
    last_observed_at = now(),
    metadata = public.brain_relationships.metadata || EXCLUDED.metadata,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.upsert_brain_relationship(uuid,text,uuid,text,uuid,text,numeric,jsonb,boolean) FROM PUBLIC, anon, authenticated;

-- 3) Derive relationships from a single event (called by the learning worker)
CREATE OR REPLACE FUNCTION public.derive_relationships_from_event(_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  e record;
  v_count integer := 0;
  v_project_client uuid;
BEGIN
  SELECT * INTO e FROM public.brain_events WHERE id = _event_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- actor -> entity  (worked_on)
  IF e.actor_id IS NOT NULL AND e.entity_type IS NOT NULL AND e.entity_id IS NOT NULL THEN
    PERFORM public.upsert_brain_relationship(
      e.brand_id, 'user', e.actor_id, e.entity_type, e.entity_id,
      'worked_on', 0.05, jsonb_build_object('last_action', e.action), false);
    v_count := v_count + 1;
  END IF;

  -- client -> entity  (owns)
  IF e.client_id IS NOT NULL AND e.entity_type IS NOT NULL AND e.entity_id IS NOT NULL
     AND NOT (e.entity_type = 'client' AND e.entity_id = e.client_id) THEN
    PERFORM public.upsert_brain_relationship(
      e.brand_id, 'client', e.client_id, e.entity_type, e.entity_id,
      'owns', 0.1, '{}'::jsonb, false);
    v_count := v_count + 1;
  END IF;

  -- project -> entity  (contains)
  IF e.project_id IS NOT NULL AND e.entity_type IS NOT NULL AND e.entity_id IS NOT NULL
     AND NOT (e.entity_type = 'project' AND e.entity_id = e.project_id) THEN
    PERFORM public.upsert_brain_relationship(
      e.brand_id, 'project', e.project_id, e.entity_type, e.entity_id,
      'contains', 0.1, '{}'::jsonb, false);
    v_count := v_count + 1;
  END IF;

  -- client -> project (owns)
  IF e.client_id IS NOT NULL AND e.project_id IS NOT NULL THEN
    PERFORM public.upsert_brain_relationship(
      e.brand_id, 'client', e.client_id, 'project', e.project_id,
      'owns', 0.1, '{}'::jsonb, false);
    v_count := v_count + 1;
  END IF;

  -- project derived from projects table (post/task without project_id but with client_id -> attach to same client)
  IF e.entity_type = 'project' AND e.entity_id IS NOT NULL THEN
    SELECT client_id INTO v_project_client FROM public.projects WHERE id = e.entity_id;
    IF v_project_client IS NOT NULL THEN
      PERFORM public.upsert_brain_relationship(
        e.brand_id, 'client', v_project_client, 'project', e.entity_id,
        'owns', 0.1, '{}'::jsonb, false);
      v_count := v_count + 1;
    END IF;
  END IF;

  -- signal edges: outcome relationships from action
  IF e.action IN ('approved','published','completed','delivered')
     AND e.entity_type IS NOT NULL AND e.entity_id IS NOT NULL
     AND e.client_id IS NOT NULL THEN
    PERFORM public.upsert_brain_relationship(
      e.brand_id, e.entity_type, e.entity_id, 'client', e.client_id,
      'positive_outcome', 0.08, jsonb_build_object('action', e.action), false);
    v_count := v_count + 1;
  END IF;

  IF e.action IN ('rejected','failed','overdue','cancelled')
     AND e.entity_type IS NOT NULL AND e.entity_id IS NOT NULL
     AND e.client_id IS NOT NULL THEN
    PERFORM public.upsert_brain_relationship(
      e.brand_id, e.entity_type, e.entity_id, 'client', e.client_id,
      'negative_outcome', 0.08, jsonb_build_object('action', e.action), false);
    v_count := v_count + 1;
  END IF;

  RETURN v_count;
END $$;

REVOKE EXECUTE ON FUNCTION public.derive_relationships_from_event(uuid) FROM PUBLIC, anon, authenticated;

-- 4) Hook into the learning worker (append derivation step)
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
    RETURN jsonb_build_object('processed',0,'failed',0,'memories',0,'insights',0,'edges',0);
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

      -- KNOWLEDGE GRAPH: derive relationships from this event
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
             error = SQLERRM,
             processed_at = CASE WHEN attempts >= 5 THEN now() ELSE NULL END
       WHERE id = v_row.queue_id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  PERFORM public.consolidate_brain_memory(NULL);

  RETURN jsonb_build_object(
    'processed',v_processed,'failed',v_failed,
    'memories',v_memories,'insights',v_insights,'edges',v_edges);
END $function$;

-- 5) Query API — full graph (bounded) and neighborhood

CREATE OR REPLACE FUNCTION public.get_brain_graph(
  _brand_id uuid DEFAULT NULL,
  _limit integer DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_edges jsonb;
  v_nodes jsonb;
BEGIN
  IF _brand_id IS NOT NULL
     AND NOT public.is_super_admin(auth.uid())
     AND NOT public.is_brand_member(_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH edges AS (
    SELECT r.*
      FROM public.brain_relationships r
     WHERE (_brand_id IS NULL OR r.brand_id = _brand_id)
     ORDER BY r.strength DESC, r.last_observed_at DESC NULLS LAST
     LIMIT GREATEST(10, LEAST(_limit, 2000))
  ),
  node_ids AS (
    SELECT from_type AS t, from_id AS i FROM edges
    UNION
    SELECT to_type,   to_id   FROM edges
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'from', jsonb_build_object('type', e.from_type, 'id', e.from_id),
      'to',   jsonb_build_object('type', e.to_type,   'id', e.to_id),
      'type', e.relationship_type,
      'strength', e.strength,
      'confidence', e.confidence,
      'observations', e.observation_count,
      'last_observed_at', e.last_observed_at
    )), '[]'::jsonb),
    (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('type', t, 'id', i)), '[]'::jsonb) FROM node_ids)
  INTO v_edges, v_nodes
  FROM edges e;

  RETURN jsonb_build_object('nodes', v_nodes, 'edges', v_edges);
END $$;

GRANT EXECUTE ON FUNCTION public.get_brain_graph(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_brain_neighborhood(
  _brand_id uuid,
  _entity_type text,
  _entity_id uuid,
  _depth integer DEFAULT 2
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_edges jsonb;
  v_nodes jsonb;
BEGIN
  IF _brand_id IS NOT NULL
     AND NOT public.is_super_admin(auth.uid())
     AND NOT public.is_brand_member(_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH RECURSIVE walk AS (
    SELECT _entity_type AS t, _entity_id AS i, 0 AS d
    UNION
    SELECT r.to_type, r.to_id, w.d + 1
      FROM walk w
      JOIN public.brain_relationships r
        ON (r.brand_id IS NOT DISTINCT FROM _brand_id)
       AND ((r.from_type = w.t AND r.from_id = w.i)
         OR (r.to_type   = w.t AND r.to_id   = w.i))
     WHERE w.d < GREATEST(1, LEAST(_depth, 4))
  ),
  reachable AS (
    SELECT DISTINCT t, i FROM walk
  ),
  edges AS (
    SELECT r.*
      FROM public.brain_relationships r
     WHERE (r.brand_id IS NOT DISTINCT FROM _brand_id)
       AND EXISTS (SELECT 1 FROM reachable rf WHERE rf.t = r.from_type AND rf.i = r.from_id)
       AND EXISTS (SELECT 1 FROM reachable rt WHERE rt.t = r.to_type   AND rt.i = r.to_id)
     LIMIT 500
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'from', jsonb_build_object('type', e.from_type, 'id', e.from_id),
      'to',   jsonb_build_object('type', e.to_type,   'id', e.to_id),
      'type', e.relationship_type,
      'strength', e.strength,
      'confidence', e.confidence,
      'observations', e.observation_count
    )), '[]'::jsonb),
    (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('type', t, 'id', i)), '[]'::jsonb) FROM reachable)
  INTO v_edges, v_nodes
  FROM edges e;

  RETURN jsonb_build_object('nodes', v_nodes, 'edges', v_edges);
END $$;

GRANT EXECUTE ON FUNCTION public.get_brain_neighborhood(uuid, text, uuid, integer) TO authenticated;

-- 6) Backfill existing events once (bounded)
DO $$
DECLARE r record; c integer := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.brain_events
     WHERE processed_at IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 2000
  LOOP
    PERFORM public.derive_relationships_from_event(r.id);
    c := c + 1;
  END LOOP;
END $$;
