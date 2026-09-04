
-- =========================================================================
-- Brain: Fase de Escalabilidade (v2)
-- =========================================================================

-- ---------- 1) Arquivo ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_events_archive (
  id uuid NOT NULL,
  brand_id uuid,
  event_type text NOT NULL,
  source_module text NOT NULL,
  payload jsonb NOT NULL,
  outcome_score numeric,
  created_at timestamptz NOT NULL,
  actor_id uuid,
  entity_type text,
  entity_id uuid,
  action text,
  client_id uuid,
  project_id uuid,
  confidence numeric,
  correlation_id uuid,
  processed_at timestamptz,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
);
GRANT SELECT ON public.brain_events_archive TO authenticated;
GRANT ALL    ON public.brain_events_archive TO service_role;
ALTER TABLE public.brain_events_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain_events_archive select by brand or super admin"
  ON public.brain_events_archive FOR SELECT
  USING (public.is_super_admin(auth.uid())
         OR (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid())));
CREATE INDEX IF NOT EXISTS brain_events_archive_brand_created_idx
  ON public.brain_events_archive (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brain_events_archive_created_brin
  ON public.brain_events_archive USING BRIN (created_at);

-- ---------- 2) Config de retenção ---------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_retention_config (
  key text PRIMARY KEY,
  value_days integer NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.brain_retention_config TO authenticated;
GRANT ALL    ON public.brain_retention_config TO service_role;
ALTER TABLE public.brain_retention_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain_retention_config read by any authenticated"
  ON public.brain_retention_config FOR SELECT TO authenticated USING (true);

INSERT INTO public.brain_retention_config (key, value_days, description) VALUES
  ('brain_events_hot_days',            90,  'Janela quente antes de arquivar brain_events'),
  ('brain_events_archive_days',        365, 'Retenção máxima em brain_events_archive'),
  ('brain_learning_queue_done_days',   7,   'Jobs concluídos removidos após N dias'),
  ('brain_insights_expired_days',      30,  'Insights expirados removidos após N dias'),
  ('brain_recommendations_done_days',  30,  'Recomendações concluídas/descartadas'),
  ('brain_metrics_snapshots_days',     730, 'Snapshots de métricas'),
  ('brain_memory_versions_days',       365, 'Versões de memória arquivadas')
ON CONFLICT (key) DO NOTHING;

-- ---------- 3) Particionamento de brain_events --------------------------
-- Drop de FKs dependentes (integridade via cleanup posterior)
ALTER TABLE public.brain_embeddings      DROP CONSTRAINT IF EXISTS brain_embeddings_event_id_fkey;
ALTER TABLE public.brain_learning_queue  DROP CONSTRAINT IF EXISTS brain_learning_queue_event_id_fkey;
ALTER TABLE public.brain_memory          DROP CONSTRAINT IF EXISTS brain_memory_source_event_fkey;

ALTER TABLE public.brain_events RENAME TO brain_events_old;
ALTER INDEX public.brain_events_pkey                RENAME TO brain_events_old_pkey;
ALTER INDEX public.brain_events_brand_created_idx   RENAME TO brain_events_old_brand_created_idx;
ALTER INDEX public.brain_events_type_idx            RENAME TO brain_events_old_type_idx;
ALTER INDEX public.brain_events_source_idx          RENAME TO brain_events_old_source_idx;
ALTER INDEX public.brain_events_entity_idx          RENAME TO brain_events_old_entity_idx;
ALTER INDEX public.brain_events_actor_idx           RENAME TO brain_events_old_actor_idx;
ALTER INDEX public.brain_events_unprocessed_idx     RENAME TO brain_events_old_unprocessed_idx;
DROP TRIGGER IF EXISTS trg_brain_events_enqueue_learning ON public.brain_events_old;

CREATE TABLE public.brain_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  source_module text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome_score numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  entity_type text,
  entity_id uuid,
  action text,
  client_id uuid,
  project_id uuid,
  confidence numeric,
  correlation_id uuid,
  processed_at timestamptz,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brain_events TO authenticated;
GRANT ALL ON public.brain_events TO service_role;
ALTER TABLE public.brain_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain_events select by brand or super admin"
  ON public.brain_events FOR SELECT
  USING (public.is_super_admin(auth.uid())
         OR (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid())));
CREATE POLICY "brain_events insert by brand member"
  ON public.brain_events FOR INSERT
  WITH CHECK (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid()));

CREATE INDEX brain_events_brand_created_idx ON public.brain_events (brand_id, created_at DESC);
CREATE INDEX brain_events_type_idx           ON public.brain_events (event_type);
CREATE INDEX brain_events_source_idx         ON public.brain_events (source_module);
CREATE INDEX brain_events_entity_idx         ON public.brain_events (entity_type, entity_id);
CREATE INDEX brain_events_actor_idx          ON public.brain_events (actor_id);
CREATE INDEX brain_events_unprocessed_idx    ON public.brain_events (created_at) WHERE processed_at IS NULL;
CREATE INDEX brain_events_created_brin       ON public.brain_events USING BRIN (created_at);

CREATE TRIGGER trg_brain_events_enqueue_learning
  AFTER INSERT ON public.brain_events
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_brain_event_for_learning();

CREATE OR REPLACE FUNCTION public.brain_ensure_event_partitions(_months_back int DEFAULT 3, _months_forward int DEFAULT 3)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i int; s date; e date; part_name text; created int := 0;
BEGIN
  FOR i IN -_months_back .. _months_forward LOOP
    s := (date_trunc('month', now()) + (i || ' months')::interval)::date;
    e := (s + interval '1 month')::date;
    part_name := format('brain_events_%s', to_char(s, 'YYYYMM'));
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.brain_events FOR VALUES FROM (%L) TO (%L)',
        part_name, s, e);
      created := created + 1;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'brain_events_default') THEN
    EXECUTE 'CREATE TABLE public.brain_events_default PARTITION OF public.brain_events DEFAULT';
    created := created + 1;
  END IF;
  RETURN created;
END $$;

SELECT public.brain_ensure_event_partitions(12, 3);

INSERT INTO public.brain_events
  (id, brand_id, event_type, source_module, payload, outcome_score, created_at,
   actor_id, entity_type, entity_id, action, client_id, project_id, confidence,
   correlation_id, processed_at)
SELECT id, brand_id, event_type, source_module, payload, outcome_score, created_at,
       actor_id, entity_type, entity_id, action, client_id, project_id, confidence,
       correlation_id, processed_at
FROM public.brain_events_old
ON CONFLICT DO NOTHING;

DROP TABLE public.brain_events_old;

-- ---------- 4) Otimização vetorial --------------------------------------
DROP INDEX IF EXISTS public.brain_embeddings_hnsw_idx;
CREATE INDEX brain_embeddings_hnsw_idx
  ON public.brain_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS brain_embeddings_created_brin
  ON public.brain_embeddings USING BRIN (created_at);

-- ---------- 5) TTL / Cleanup / Retenção ---------------------------------
CREATE OR REPLACE FUNCTION public._brain_cfg_days(_key text, _default int)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT value_days FROM public.brain_retention_config WHERE key = _key), _default);
$$;

CREATE OR REPLACE FUNCTION public.brain_archive_and_prune_events()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hot_days   int := public._brain_cfg_days('brain_events_hot_days', 90);
  arch_days  int := public._brain_cfg_days('brain_events_archive_days', 365);
  archived   int := 0;
  dropped    int := 0;
  arch_pruned int := 0;
  part record;
  cutoff timestamptz := now() - (hot_days || ' days')::interval;
  arch_cutoff timestamptz := now() - (arch_days || ' days')::interval;
BEGIN
  WITH moved AS (
    INSERT INTO public.brain_events_archive
      (id, brand_id, event_type, source_module, payload, outcome_score, created_at,
       actor_id, entity_type, entity_id, action, client_id, project_id, confidence,
       correlation_id, processed_at)
    SELECT id, brand_id, event_type, source_module, payload, outcome_score, created_at,
           actor_id, entity_type, entity_id, action, client_id, project_id, confidence,
           correlation_id, processed_at
      FROM public.brain_events WHERE created_at < cutoff
    ON CONFLICT DO NOTHING RETURNING 1
  ) SELECT count(*) INTO archived FROM moved;

  FOR part IN
    SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'public.brain_events'::regclass
       AND c.relname <> 'brain_events_default'
  LOOP
    IF part.bound ~ 'TO \(''([^'']+)''\)' THEN
      IF (regexp_replace(part.bound, '.*TO \(''([^'']+)''\).*', '\1'))::timestamptz <= cutoff THEN
        EXECUTE format('DROP TABLE public.%I', part.relname);
        dropped := dropped + 1;
      END IF;
    END IF;
  END LOOP;

  WITH pruned AS (
    DELETE FROM public.brain_events_archive WHERE created_at < arch_cutoff RETURNING 1
  ) SELECT count(*) INTO arch_pruned FROM pruned;

  RETURN jsonb_build_object('archived', archived, 'partitions_dropped', dropped,
                            'archive_pruned', arch_pruned,
                            'cutoff', cutoff, 'archive_cutoff', arch_cutoff);
END $$;

CREATE OR REPLACE FUNCTION public.brain_cleanup_ttl()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q_days int := public._brain_cfg_days('brain_learning_queue_done_days', 7);
  i_days int := public._brain_cfg_days('brain_insights_expired_days', 30);
  r_days int := public._brain_cfg_days('brain_recommendations_done_days', 30);
  m_days int := public._brain_cfg_days('brain_metrics_snapshots_days', 730);
  v_days int := public._brain_cfg_days('brain_memory_versions_days', 365);
  q_del int; i_del int; r_del int; m_del int; v_del int;
  emb_orphans int; lq_orphans int;
BEGIN
  WITH d AS (DELETE FROM public.brain_learning_queue
              WHERE status IN ('processed','failed','dead')
                AND COALESCE(processed_at, updated_at) < now() - (q_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO q_del FROM d;
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
     WHERE NOT EXISTS (SELECT 1 FROM public.brain_events ev WHERE ev.id = lq.event_id)
    RETURNING 1) SELECT count(*) INTO lq_orphans FROM d;

  RETURN jsonb_build_object(
    'learning_queue_done', q_del, 'insights_expired', i_del,
    'recommendations_done', r_del, 'metrics_snapshots', m_del,
    'memory_versions', v_del, 'embeddings_orphans', emb_orphans,
    'learning_queue_orphans', lq_orphans);
END $$;

CREATE OR REPLACE FUNCTION public.brain_retention_run()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a jsonb; b jsonb; c int;
BEGIN
  c := public.brain_ensure_event_partitions(3, 3);
  a := public.brain_archive_and_prune_events();
  b := public.brain_cleanup_ttl();
  RETURN jsonb_build_object('partitions_created', c, 'events', a, 'ttl', b, 'ran_at', now());
END $$;

REVOKE EXECUTE ON FUNCTION
  public.brain_ensure_event_partitions(int, int),
  public.brain_archive_and_prune_events(),
  public.brain_cleanup_ttl(),
  public.brain_retention_run()
FROM anon, authenticated;

COMMENT ON TABLE public.brain_events IS 'Particionada RANGE(created_at) mensal. Retenção via brain_retention_run().';
COMMENT ON TABLE public.brain_events_archive IS 'Arquivo de longo prazo (append-only).';
COMMENT ON FUNCTION public.brain_retention_run() IS 'Ensure partitions + archive + ttl cleanup. Agendar diariamente.';
