-- ============================================================================
-- BRAIN FASE 0 + FASE 1 — correção estrutural
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ESCOPO EXPLÍCITO (P0 de isolamento)
-- ---------------------------------------------------------------------------
ALTER TABLE public.brain_memory
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

ALTER TABLE public.brain_insights
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'brand';

ALTER TABLE public.brain_relationships
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

-- Backfill: memórias que já identificam o cliente na entidade/subject.
UPDATE public.brain_memory m
   SET client_id = c.id
  FROM public.clients c
 WHERE m.client_id IS NULL
   AND c.id = COALESCE(
        CASE WHEN m.subject_type = 'client' THEN m.subject_id END,
        CASE WHEN m.entity_type  = 'client' THEN m.entity_id  END);

UPDATE public.brain_relationships r
   SET client_id = c.id
  FROM public.clients c
 WHERE r.client_id IS NULL
   AND c.id = COALESCE(
        CASE WHEN r.from_type = 'client' THEN r.from_id END,
        CASE WHEN r.to_type   = 'client' THEN r.to_id   END);

-- Normaliza escopos legados de memória ('project' não é um nível de escopo).
UPDATE public.brain_memory
   SET scope = CASE
                 WHEN client_id IS NOT NULL THEN 'client'
                 WHEN brand_id  IS NOT NULL THEN 'brand'
                 ELSE 'global'
               END
 WHERE scope IS DISTINCT FROM CASE
                 WHEN client_id IS NOT NULL THEN 'client'
                 WHEN brand_id  IS NOT NULL THEN 'brand'
                 ELSE 'global'
               END;

UPDATE public.brain_insights
   SET scope = CASE
                 WHEN client_id IS NOT NULL THEN 'client'
                 WHEN brand_id  IS NOT NULL THEN 'brand'
                 ELSE 'global'
               END;

-- Insights legados cuja origem de cliente é indeterminada não podem ser
-- entregues a um cliente específico: são retirados de circulação (expirados),
-- nunca deletados.
UPDATE public.brain_insights
   SET expires_at = LEAST(COALESCE(expires_at, now()), now())
 WHERE client_id IS NULL
   AND insight_type IN ('client_rejection_spike', 'learned_preference');

-- Garantia estrutural: escopo é sempre derivado dos IDs, nunca de metadata.
CREATE OR REPLACE FUNCTION public.brain_scope_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    NEW.scope := 'client';
  ELSIF NEW.brand_id IS NOT NULL THEN
    NEW.scope := 'brand';
  ELSE
    NEW.scope := 'global';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS brain_memory_scope_guard ON public.brain_memory;
CREATE TRIGGER brain_memory_scope_guard
  BEFORE INSERT OR UPDATE ON public.brain_memory
  FOR EACH ROW EXECUTE FUNCTION public.brain_scope_guard();

DROP TRIGGER IF EXISTS brain_insights_scope_guard ON public.brain_insights;
CREATE TRIGGER brain_insights_scope_guard
  BEFORE INSERT OR UPDATE ON public.brain_insights
  FOR EACH ROW EXECUTE FUNCTION public.brain_scope_guard();

ALTER TABLE public.brain_memory
  DROP CONSTRAINT IF EXISTS brain_memory_scope_check;
ALTER TABLE public.brain_memory
  ADD CONSTRAINT brain_memory_scope_check
  CHECK (scope IN ('global', 'brand', 'client'));

ALTER TABLE public.brain_insights
  DROP CONSTRAINT IF EXISTS brain_insights_scope_check;
ALTER TABLE public.brain_insights
  ADD CONSTRAINT brain_insights_scope_check
  CHECK (scope IN ('global', 'brand', 'client'));

CREATE INDEX IF NOT EXISTS idx_brain_memory_scope
  ON public.brain_memory (brand_id, client_id, status, category);
CREATE INDEX IF NOT EXISTS idx_brain_insights_scope
  ON public.brain_insights (brand_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_relationships_scope
  ON public.brain_relationships (brand_id, client_id);

-- ---------------------------------------------------------------------------
-- 2. MÉTRICAS AGREGADAS (deixam de ser log de evento)
-- ---------------------------------------------------------------------------
WITH agg AS (
  SELECT brand_id, channel, metric_name, period_start, period_end,
         SUM(metric_value) AS total
    FROM public.brain_metrics_snapshots
   WHERE metric_name LIKE 'events.%'
   GROUP BY 1,2,3,4,5
), del AS (
  DELETE FROM public.brain_metrics_snapshots WHERE metric_name LIKE 'events.%'
)
INSERT INTO public.brain_metrics_snapshots
  (brand_id, channel, metric_name, metric_value, period_start, period_end)
SELECT brand_id, channel, metric_name, total, period_start, period_end FROM agg;

-- Índice parcial: só os contadores de evento são diários e únicos. As métricas
-- de redes sociais (engagement, reach, ...) mantêm o comportamento atual.
CREATE UNIQUE INDEX IF NOT EXISTS uq_brain_metrics_snapshots_events_daily
  ON public.brain_metrics_snapshots (
    COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(channel, 'system'), metric_name, period_start)
  WHERE metric_name LIKE 'events.%';

-- ---------------------------------------------------------------------------
-- 3. OBSERVABILIDADE DO WORKER (tabela única e enxuta)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_worker_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL DEFAULT 'brain_learning_worker',
  status text NOT NULL DEFAULT 'ok',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  picked integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  discarded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  memories_created integer NOT NULL DEFAULT 0,
  memories_updated integer NOT NULL DEFAULT 0,
  insights_created integer NOT NULL DEFAULT 0,
  edges_created integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.brain_worker_runs TO authenticated;
GRANT ALL ON public.brain_worker_runs TO service_role;
ALTER TABLE public.brain_worker_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brain_worker_runs_read" ON public.brain_worker_runs;
CREATE POLICY "brain_worker_runs_read"
  ON public.brain_worker_runs FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_brain_worker_runs_recent
  ON public.brain_worker_runs (job_name, started_at DESC);

-- ---------------------------------------------------------------------------
-- 4. CORREÇÃO DA CAUSA RAIZ: memory_type inválido em consolidate_brain_memory
--    ('risk' não pertence ao check constraint) + escopo explícito de cliente.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consolidate_brain_memory(_brand_id uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  written integer := 0;
  r record;
BEGIN
  -- 1) Tempo médio de aprovação por cliente (memória de CLIENTE).
  FOR r IN
    SELECT p.brand_id, p.client_id,
           AVG(EXTRACT(EPOCH FROM (p.approved_at - p.created_at))/3600.0) AS avg_hours,
           COUNT(*) AS n
      FROM public.posts p
     WHERE p.approved_at IS NOT NULL
       AND p.client_id IS NOT NULL
       AND (_brand_id IS NULL OR p.brand_id = _brand_id)
     GROUP BY p.brand_id, p.client_id
    HAVING COUNT(*) >= 3
  LOOP
    INSERT INTO public.brain_memory
      (brand_id, client_id, subject_type, subject_id, memory_type, scope, key, content, confidence,
       entity_type, entity_id, category, title, description, tags, metadata, status, origin)
    VALUES
      (r.brand_id, r.client_id, 'client', r.client_id, 'pattern', 'client',
       'client:' || r.client_id || ':approval_latency',
       jsonb_build_object('avg_hours', round(r.avg_hours::numeric, 2), 'sample_size', r.n),
       LEAST(0.5 + (r.n::numeric / 50.0), 0.98),
       'client', r.client_id, 'padrao_de_aprovacao',
       'Tempo médio de aprovação',
       'Aprovações levam em média ' || round(r.avg_hours::numeric, 1) || 'h (amostra: ' || r.n || ' posts).',
       ARRAY['approval','latency','client'],
       jsonb_build_object('avg_hours', round(r.avg_hours::numeric, 2), 'sample_size', r.n),
       'active', 'consolidation')
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_id, category, title)
    DO UPDATE SET
      content    = EXCLUDED.content,
      client_id  = EXCLUDED.client_id,
      metadata   = EXCLUDED.metadata,
      confidence = EXCLUDED.confidence,
      description= EXCLUDED.description,
      updated_at = now();
    written := written + 1;
  END LOOP;

  -- 2) Slot recorrente de publicação (memória de MARCA).
  FOR r IN
    SELECT p.brand_id,
           EXTRACT(DOW  FROM p.published_at)::int AS dow,
           EXTRACT(HOUR FROM p.published_at)::int AS hour,
           COUNT(*) AS n
      FROM public.posts p
     WHERE p.published_at IS NOT NULL
       AND (_brand_id IS NULL OR p.brand_id = _brand_id)
     GROUP BY p.brand_id, dow, hour
    HAVING COUNT(*) >= 5
  LOOP
    INSERT INTO public.brain_memory
      (brand_id, subject_type, subject_id, memory_type, scope, key, content, confidence,
       entity_type, entity_id, category, title, description, tags, metadata, status, origin)
    VALUES
      (r.brand_id, 'brand', r.brand_id, 'pattern', 'brand',
       'brand:' || r.brand_id || ':publish_slot_' || r.dow || '_' || r.hour,
       jsonb_build_object('dow', r.dow, 'hour', r.hour, 'sample_size', r.n),
       LEAST(0.4 + (r.n::numeric / 40.0), 0.95),
       'brand', r.brand_id, 'publish_slot',
       'Slot recorrente: dia ' || r.dow || ' às ' || r.hour || 'h',
       'Padrão de publicação identificado (amostra: ' || r.n || ').',
       ARRAY['publish','schedule','pattern'],
       jsonb_build_object('dow', r.dow, 'hour', r.hour, 'sample_size', r.n),
       'active', 'consolidation')
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_id, category, title)
    DO UPDATE SET
      content    = EXCLUDED.content,
      metadata   = EXCLUDED.metadata,
      confidence = EXCLUDED.confidence,
      updated_at = now();
    written := written + 1;
  END LOOP;

  -- 3) Risco de atraso por projeto (memória de MARCA; memory_type VÁLIDO).
  FOR r IN
    SELECT pr.brand_id, pr.id AS project_id, pr.name,
           COUNT(t.id)                                                     AS tasks,
           COUNT(t.id) FILTER (WHERE t.due_at < now() AND t.done = false)   AS overdue
      FROM public.projects pr
      LEFT JOIN public.tasks t ON t.project_id = pr.id
     WHERE (_brand_id IS NULL OR pr.brand_id = _brand_id)
     GROUP BY pr.brand_id, pr.id, pr.name
    HAVING COUNT(t.id) >= 10
  LOOP
    INSERT INTO public.brain_memory
      (brand_id, subject_type, subject_id, memory_type, scope, key, content, confidence,
       entity_type, entity_id, category, title, description, tags, metadata, status, origin)
    VALUES
      (r.brand_id, 'project', r.project_id, 'pattern', 'brand',
       'project:' || r.project_id || ':delay_risk',
       jsonb_build_object('tasks', r.tasks, 'overdue', r.overdue),
       LEAST(0.5 + (r.overdue::numeric / GREATEST(r.tasks,1))*0.5, 0.98),
       'project', r.project_id, 'delay_risk',
       'Risco de atraso: ' || coalesce(r.name,'projeto'),
       r.tasks || ' tarefas, ' || r.overdue || ' em atraso.',
       ARRAY['project','risk','delay'],
       jsonb_build_object('tasks', r.tasks, 'overdue', r.overdue),
       CASE WHEN r.overdue = 0 THEN 'archived' ELSE 'active' END, 'consolidation')
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_id, category, title)
    DO UPDATE SET
      content    = EXCLUDED.content,
      metadata   = EXCLUDED.metadata,
      confidence = EXCLUDED.confidence,
      description= EXCLUDED.description,
      status     = EXCLUDED.status,
      updated_at = now();
    written := written + 1;
  END LOOP;

  RETURN written;
END;
$$;

-- brain_memory_evolve gravava memory_type = category (viola o check).
CREATE OR REPLACE FUNCTION public.brain_memory_evolve(
  _brand_id uuid, _entity_type text, _entity_id uuid, _category text, _title text,
  _description text DEFAULT NULL::text,
  _content jsonb DEFAULT '{}'::jsonb,
  _evidence_confidence numeric DEFAULT 0.6,
  _origin text DEFAULT 'system'::text,
  _source_event uuid DEFAULT NULL::uuid,
  _tags text[] DEFAULT '{}'::text[],
  _relations jsonb DEFAULT '[]'::jsonb,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _contradicts boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing public.brain_memory%ROWTYPE;
  new_conf numeric;
  new_id uuid;
  ev_weight numeric := 0.35;
  ref_entry jsonb;
  v_client uuid;
BEGIN
  IF _brand_id IS NOT NULL AND NOT (public.is_brand_member(_brand_id, auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_client := CASE WHEN _entity_type = 'client' THEN _entity_id ELSE NULL END;

  SELECT * INTO existing
    FROM public.brain_memory
   WHERE COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND entity_type = _entity_type
     AND entity_id   = _entity_id
     AND category    = _category
     AND title       = _title
   LIMIT 1;

  ref_entry := jsonb_build_object('at', to_jsonb(now()), 'source_event', _source_event,
    'origin', _origin, 'evidence', _evidence_confidence, 'contradicts', _contradicts);

  IF FOUND THEN
    IF _contradicts THEN
      new_conf := GREATEST(0.02, existing.confidence - (ev_weight * _evidence_confidence));
    ELSE
      new_conf := LEAST(0.99, (1.0 - ev_weight) * existing.confidence + ev_weight * _evidence_confidence);
    END IF;

    UPDATE public.brain_memory SET
      description = COALESCE(_description, description),
      content     = content || COALESCE(_content, '{}'::jsonb),
      confidence  = ROUND(new_conf, 3),
      client_id   = COALESCE(client_id, v_client),
      tags        = ARRAY(SELECT DISTINCT unnest(tags || COALESCE(_tags, '{}'))),
      relations   = COALESCE(relations, '[]'::jsonb) || COALESCE(_relations, '[]'::jsonb),
      metadata    = metadata || COALESCE(_metadata, '{}'::jsonb),
      source_refs = COALESCE(source_refs, '[]'::jsonb) || jsonb_build_array(ref_entry),
      reinforcement_count = reinforcement_count + CASE WHEN _contradicts THEN 0 ELSE 1 END,
      contradiction_count = contradiction_count + CASE WHEN _contradicts THEN 1 ELSE 0 END,
      status      = CASE WHEN existing.status = 'archived' AND NOT _contradicts THEN 'active' ELSE existing.status END,
      source_event = COALESCE(_source_event, source_event),
      origin       = COALESCE(existing.origin, _origin)
    WHERE id = existing.id;

    RETURN existing.id;
  END IF;

  INSERT INTO public.brain_memory
    (brand_id, client_id, memory_type, scope, key, content, confidence,
     entity_type, entity_id, category, title, description,
     source_event, tags, relations, metadata, status,
     version, origin, source_refs, reinforcement_count)
  VALUES
    (_brand_id, v_client, 'pattern',
     CASE WHEN v_client IS NOT NULL THEN 'client'
          WHEN _brand_id IS NULL THEN 'global' ELSE 'brand' END,
     COALESCE(_entity_type,'entity') || ':' || COALESCE(_entity_id::text,'-') || ':' || COALESCE(_category,'general'),
     COALESCE(_content, '{}'::jsonb),
     ROUND(LEAST(0.95, GREATEST(0.05, _evidence_confidence))::numeric, 3),
     _entity_type, _entity_id, _category, _title, _description,
     _source_event, COALESCE(_tags, '{}'), COALESCE(_relations, '[]'::jsonb),
     COALESCE(_metadata, '{}'::jsonb), 'active',
     1, _origin, jsonb_build_array(ref_entry), 1)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. WORKER: muitos eventos → poucas memórias úteis
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brain_render_memory_desc(_category text, _content jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _category
    WHEN 'padrao_de_aprovacao' THEN
      'Aprovações diretas: ' || COALESCE(_content->>'approved','0') ||
      ' · Ajustes solicitados: ' || COALESCE(_content->>'adjust','0') ||
      ' · Rejeições: ' || COALESCE(_content->>'rejected','0') ||
      ' (amostra de ' || COALESCE(_content->>'sample','0') || ' decisões).'
    WHEN 'cadencia_de_publicacao' THEN
      'Publicações concluídas registradas: ' || COALESCE(_content->>'published','0') ||
      ' (amostra de ' || COALESCE(_content->>'sample','0') || ' eventos).'
    WHEN 'riscos_operacionais' THEN
      'Incidentes registrados (atrasos/falhas): ' || COALESCE(_content->>'incident','0') ||
      ' (amostra de ' || COALESCE(_content->>'sample','0') || ' eventos).'
    ELSE 'Aprendizado consolidado (amostra de ' || COALESCE(_content->>'sample','0') || ' evidências).'
  END;
$$;

CREATE OR REPLACE FUNCTION public.process_brain_learning_queue(_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started    timestamptz := clock_timestamp();
  v_run_id     uuid;
  v_batch      uuid[];
  v_row        record;
  v_picked     integer := 0;
  v_processed  integer := 0;
  v_discarded  integer := 0;
  v_failed     integer := 0;
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
  -- Single-flight: uma execução por vez, sem sobreposição de lotes.
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

  FOR v_row IN
    SELECT q.id AS queue_id, e.*
      FROM public.brain_learning_queue q
      JOIN public.brain_events e ON e.id = q.event_id
     WHERE q.id = ANY(v_batch)
  LOOP
    BEGIN
      -- (a) Evidência sempre contabilizada como MÉTRICA AGREGADA (1 linha/dia),
      --     nunca como memória e nunca uma linha por evento.
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

      -- (b) REGRAS DE APRENDIZADO. Só decisões com valor futuro viram memória.
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
        -- Evento é apenas evidência (criação, atualização, visualização, job).
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

      -- (c) Insights derivados (escopo explícito de cliente).
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

  -- Consolidação isolada: uma falha aqui NUNCA derruba o lote (causa raiz do bug).
  IF v_processed > 0 THEN
    BEGIN
      v_cons := public.consolidate_brain_memory(NULL);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.brain_worker_runs
         SET error = 'consolidate_failed: ' || SQLERRM
       WHERE id = v_run_id;
    END;
  END IF;

  -- Retenção da própria fila e do log de execuções (bounded, idempotente).
  DELETE FROM public.brain_learning_queue
   WHERE id IN (SELECT id FROM public.brain_learning_queue
                 WHERE status = 'done' AND processed_at < now() - interval '7 days'
                 LIMIT 500);
  DELETE FROM public.brain_worker_runs
   WHERE started_at < now() - interval '14 days';

  UPDATE public.brain_worker_runs
     SET status = CASE WHEN v_failed > 0 THEN 'partial' ELSE 'ok' END,
         finished_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int),
         picked = v_picked, processed = v_processed, discarded = v_discarded,
         failed = v_failed, memories_created = v_created, memories_updated = v_updated,
         insights_created = v_insights, edges_created = v_edges
   WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'picked', v_picked, 'processed', v_processed, 'discarded', v_discarded,
    'failed', v_failed, 'memories_created', v_created, 'memories_updated', v_updated,
    'insights', v_insights, 'edges', v_edges,
    'duration_ms', GREATEST(0, (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int));
END;
$$;

REVOKE ALL ON FUNCTION public.process_brain_learning_queue(integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.consolidate_brain_memory(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.brain_render_memory_desc(text, jsonb) FROM anon;

-- ---------------------------------------------------------------------------
-- 6. LIMPEZA CONSERVADORA: memórias que eram espelho 1:1 de evento.
--    Regra explícita: origem 'learning' + categoria no formato de event_type
--    (contém ponto, ex. 'task.created'). Arquiva — não deleta.
-- ---------------------------------------------------------------------------
UPDATE public.brain_memory
   SET status = 'archived',
       metadata = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object('archived_reason', 'event_mirror_legacy',
                                        'archived_at', to_jsonb(now())),
       updated_at = now()
 WHERE origin = 'learning'
   AND status = 'active'
   AND category LIKE '%.%';
