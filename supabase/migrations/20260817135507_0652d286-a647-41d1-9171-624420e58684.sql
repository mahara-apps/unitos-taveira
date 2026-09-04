CREATE OR REPLACE FUNCTION public.brain_mine_patterns(_brand_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r record;
  v_created integer := 0;
  v_updated integer := 0;
  v_global  integer := 0;
  v_archived integer := 0;
  v_skipped integer := 0;
  v_id uuid;
  v_new boolean;
  v_conf numeric;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('brain_mine_patterns')) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'locked');
  END IF;

  -- ---------------------------------------------------------------------
  -- 1) DESEMPENHO POR CANAL (MARCA). Interação quando medida em 2+ canais;
  --    senão alcance comparado. A métrica usada vai na própria memória.
  -- ---------------------------------------------------------------------
  FOR r IN
    WITH per_channel AS (
      SELECT s.brand_id, s.channel,
             SUM(CASE WHEN s.metric_name = 'reach' THEN s.metric_value ELSE 0 END)      AS reach,
             SUM(CASE WHEN s.metric_name = 'engagement' THEN s.metric_value ELSE 0 END) AS engagement,
             COUNT(*) AS measurements,
             MAX(s.period_end) AS last_seen
        FROM public.brain_metrics_snapshots s
       WHERE s.metric_name IN ('reach','engagement')
         AND s.brand_id IS NOT NULL AND s.channel IS NOT NULL
         AND s.period_start >= (now() - interval '120 days')::date
         AND (_brand_id IS NULL OR s.brand_id = _brand_id)
       GROUP BY s.brand_id, s.channel
      HAVING SUM(CASE WHEN s.metric_name = 'reach' THEN s.metric_value ELSE 0 END) > 0
    ), flagged AS (
      SELECT p.*,
             COUNT(*) FILTER (WHERE p.engagement > 0) OVER (PARTITION BY p.brand_id) AS eng_channels
        FROM per_channel p
    ), rated AS (
      SELECT brand_id, channel, reach, engagement, measurements, last_seen, eng_channels,
             CASE WHEN eng_channels >= 2 THEN 'interacao' ELSE 'alcance' END AS basis,
             CASE WHEN eng_channels >= 2 THEN engagement / NULLIF(reach,0) ELSE reach END AS metric
        FROM flagged
       WHERE eng_channels < 2 OR engagement > 0
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY brand_id ORDER BY metric DESC) rn,
             COUNT(*) OVER (PARTITION BY brand_id) channels,
             SUM(measurements) OVER (PARTITION BY brand_id) total_measurements,
             MAX(metric) OVER (PARTITION BY brand_id) best,
             MIN(metric) OVER (PARTITION BY brand_id) worst
        FROM rated
    )
    SELECT * FROM ranked
     WHERE rn = 1 AND channels >= 2 AND total_measurements >= 4 AND best > worst
  LOOP
    v_conf := public.brain_confidence(
      r.total_measurements::int,
      COALESCE((r.best - r.worst) / NULLIF(r.best,0), 0),
      r.last_seen::timestamptz,
      CASE WHEN r.basis = 'interacao' THEN 1.0 ELSE 0.8 END);

    INSERT INTO public.brain_memory(
      brand_id, client_id, subject_type, subject_id, memory_type, scope, key,
      entity_type, entity_id, category, title, description, content, confidence,
      reinforcement_count, origin, status, tags, metadata, last_observed_at)
    VALUES (
      r.brand_id, NULL, 'brand', r.brand_id, 'pattern', 'brand',
      'brand:' || r.brand_id || ':canal_de_maior_desempenho',
      'brand', r.brand_id, 'desempenho_por_canal',
      'Canal de maior desempenho',
      CASE WHEN r.basis = 'interacao'
        THEN 'Para esta marca, ' || r.channel || ' apresenta a maior taxa média de interação ('
             || round(r.metric * 100, 2) || '% em ' || r.total_measurements
             || ' medições / 120 dias, ' || r.channels || ' canais comparados).'
        ELSE 'Para esta marca, ' || r.channel || ' concentra o maior alcance medido ('
             || round(r.metric) || ' em ' || r.total_measurements || ' medições / 120 dias, '
             || r.channels || ' canais comparados). Interação ainda não medida em 2+ canais.'
      END,
      jsonb_build_object('top_channel', r.channel, 'basis', r.basis,
                         'metric', round(r.metric,5), 'sample', r.total_measurements,
                         'channels', r.channels, 'window_days', 120,
                         'reach', r.reach, 'engagement', r.engagement),
      v_conf, 1, 'mining', 'active',
      ARRAY['performance','channel','pattern']::text[],
      jsonb_build_object('miner','channel_performance'), r.last_seen::timestamptz)
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 entity_type, entity_id, category, title)
    DO UPDATE SET
      previous_confidence = public.brain_memory.confidence,
      confidence  = EXCLUDED.confidence,
      description = EXCLUDED.description,
      content     = EXCLUDED.content,
      reinforcement_count = public.brain_memory.reinforcement_count + 1,
      last_observed_at = EXCLUDED.last_observed_at,
      status = 'active', updated_at = now()
    RETURNING id, (public.brain_memory.previous_confidence IS NULL) INTO v_id, v_new;
    IF COALESCE(v_new, true) THEN v_created := v_created + 1; ELSE v_updated := v_updated + 1; END IF;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 2) DESEMPENHO POR FORMATO (MARCA). Exige sinal de resultado real
  --    (aprovações/ajustes) e diferença entre formatos.
  -- ---------------------------------------------------------------------
  FOR r IN
    WITH per_format AS (
      SELECT p.brand_id, public.canonical_content_format(p.format) AS fmt,
             COUNT(*) AS n,
             COUNT(*) FILTER (WHERE p.approved_at IS NOT NULL) AS approved,
             COUNT(*) FILTER (WHERE COALESCE(p.rework_notes,'') <> ''
                                 OR p.review_status = 'changes_requested') AS rework,
             MAX(GREATEST(p.updated_at, p.created_at)) AS last_seen
        FROM public.posts p
       WHERE p.format IS NOT NULL AND p.deleted_at IS NULL
         AND p.created_at >= now() - interval '180 days'
         AND (_brand_id IS NULL OR p.brand_id = _brand_id)
       GROUP BY p.brand_id, public.canonical_content_format(p.format)
      HAVING COUNT(*) >= 4
    ), rated AS (
      SELECT *, (approved::numeric - rework::numeric) / NULLIF(n,0) AS score FROM per_format
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY brand_id ORDER BY score DESC) rn,
             COUNT(*) OVER (PARTITION BY brand_id) formats,
             SUM(n)   OVER (PARTITION BY brand_id) total,
             SUM(approved + rework) OVER (PARTITION BY brand_id) outcome_signals,
             MAX(score) OVER (PARTITION BY brand_id) best,
             MIN(score) OVER (PARTITION BY brand_id) worst
        FROM rated
    )
    SELECT * FROM ranked
     WHERE rn = 1 AND formats >= 2 AND outcome_signals >= 3 AND best > worst
  LOOP
    v_conf := public.brain_confidence(
      r.outcome_signals::int,
      COALESCE((r.best - r.worst) / NULLIF(ABS(r.best) + 1, 0), 0),
      r.last_seen);

    INSERT INTO public.brain_memory(
      brand_id, client_id, subject_type, subject_id, memory_type, scope, key,
      entity_type, entity_id, category, title, description, content, confidence,
      reinforcement_count, origin, status, tags, metadata, last_observed_at)
    VALUES (
      r.brand_id, NULL, 'brand', r.brand_id, 'pattern', 'brand',
      'brand:' || r.brand_id || ':formato_de_melhor_aprovacao',
      'brand', r.brand_id, 'desempenho_por_formato',
      'Formato com melhor aprovação',
      'O formato ' || r.fmt || ' é o que passa com menos retrabalho ('
        || r.approved || ' aprovados e ' || r.rework || ' com ajustes em ' || r.n
        || ' peças; ' || r.formats || ' formatos comparados / 180 dias).',
      jsonb_build_object('top_format', r.fmt, 'score', round(r.score,3),
                         'sample', r.outcome_signals, 'pieces', r.total,
                         'formats', r.formats, 'approved', r.approved,
                         'rework', r.rework, 'window_days', 180),
      v_conf, 1, 'mining', 'active',
      ARRAY['performance','format','pattern']::text[],
      jsonb_build_object('miner','format_performance'), r.last_seen)
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 entity_type, entity_id, category, title)
    DO UPDATE SET
      previous_confidence = public.brain_memory.confidence,
      confidence  = EXCLUDED.confidence,
      description = EXCLUDED.description,
      content     = EXCLUDED.content,
      reinforcement_count = public.brain_memory.reinforcement_count + 1,
      last_observed_at = EXCLUDED.last_observed_at,
      status = 'active', updated_at = now()
    RETURNING id, (public.brain_memory.previous_confidence IS NULL) INTO v_id, v_new;
    IF COALESCE(v_new, true) THEN v_created := v_created + 1; ELSE v_updated := v_updated + 1; END IF;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 3) MIX DE CANAIS DO CLIENTE (CLIENTE).
  -- ---------------------------------------------------------------------
  FOR r IN
    WITH exploded AS (
      SELECT p.brand_id, p.client_id, unnest(p.channels)::text AS ch,
             GREATEST(p.published_at, p.updated_at) AS seen
        FROM public.posts p
       WHERE p.client_id IS NOT NULL AND p.channels IS NOT NULL
         AND p.deleted_at IS NULL
         AND p.created_at >= now() - interval '180 days'
         AND (_brand_id IS NULL OR p.brand_id = _brand_id)
    ), agg AS (
      SELECT brand_id, client_id, ch, COUNT(*) n, MAX(seen) last_seen
        FROM exploded GROUP BY brand_id, client_id, ch
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY brand_id, client_id ORDER BY n DESC) rn,
             SUM(n)   OVER (PARTITION BY brand_id, client_id) total,
             COUNT(*) OVER (PARTITION BY brand_id, client_id) channels,
             MAX(n)   OVER (PARTITION BY brand_id, client_id) best,
             MIN(n)   OVER (PARTITION BY brand_id, client_id) worst
        FROM agg
    )
    SELECT * FROM ranked WHERE rn = 1 AND total >= 6 AND channels >= 2 AND best > worst
  LOOP
    v_conf := public.brain_confidence(
      r.total::int, (r.best::numeric / NULLIF(r.total,0)), r.last_seen);

    INSERT INTO public.brain_memory(
      brand_id, client_id, subject_type, subject_id, memory_type, scope, key,
      entity_type, entity_id, category, title, description, content, confidence,
      reinforcement_count, origin, status, tags, metadata, last_observed_at)
    VALUES (
      r.brand_id, r.client_id, 'client', r.client_id, 'pattern', 'client',
      'client:' || r.client_id || ':mix_de_canais',
      'client', r.client_id, 'mix_de_canais',
      'Mix de canais do cliente',
      'A produção deste cliente concentra-se em ' || r.ch || ' ('
        || round(100.0 * r.best / GREATEST(r.total,1), 0) || '% de ' || r.total
        || ' peças em ' || r.channels || ' canais / 180 dias).',
      jsonb_build_object('top_channel', r.ch, 'share', round(r.best::numeric / GREATEST(r.total,1), 3),
                         'sample', r.total, 'channels', r.channels, 'window_days', 180),
      v_conf, 1, 'mining', 'active',
      ARRAY['channel','mix','client']::text[],
      jsonb_build_object('miner','client_channel_mix'), r.last_seen)
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 entity_type, entity_id, category, title)
    DO UPDATE SET
      previous_confidence = public.brain_memory.confidence,
      confidence  = EXCLUDED.confidence,
      description = EXCLUDED.description,
      content     = EXCLUDED.content,
      client_id   = EXCLUDED.client_id,
      reinforcement_count = public.brain_memory.reinforcement_count + 1,
      last_observed_at = EXCLUDED.last_observed_at,
      status = 'active', updated_at = now()
    RETURNING id, (public.brain_memory.previous_confidence IS NULL) INTO v_id, v_new;
    IF COALESCE(v_new, true) THEN v_created := v_created + 1; ELSE v_updated := v_updated + 1; END IF;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 4) PROMOÇÃO GLOBAL: 3+ marcas concordando, sem dado identificável.
  -- ---------------------------------------------------------------------
  FOR r IN
    SELECT m.content->>'top_channel' AS ch,
           COUNT(DISTINCT m.brand_id) AS brands,
           round(AVG((m.content->>'metric')::numeric), 5) AS avg_metric,
           MAX(m.last_observed_at) AS last_seen
      FROM public.brain_memory m
     WHERE m.category = 'desempenho_por_canal'
       AND m.scope = 'brand' AND m.status = 'active'
       AND m.client_id IS NULL
       AND m.content ? 'top_channel'
       AND m.content->>'basis' = 'interacao'
     GROUP BY 1
    HAVING COUNT(DISTINCT m.brand_id) >= 3
  LOOP
    INSERT INTO public.brain_memory(
      brand_id, client_id, subject_type, subject_id, memory_type, scope, key,
      entity_type, entity_id, category, title, description, content, confidence,
      reinforcement_count, origin, status, tags, metadata, last_observed_at)
    VALUES (
      NULL, NULL, 'global', NULL, 'pattern', 'global',
      'global:canal_de_maior_desempenho:' || r.ch,
      'global', md5('global:channel:' || r.ch)::uuid, 'desempenho_por_canal_global',
      'Tendência agregada de canal',
      'Em dados agregados de ' || r.brands || ' marcas, ' || r.ch
        || ' aparece como canal de maior taxa de interação (média '
        || round(r.avg_metric*100,2) || '%).',
      jsonb_build_object('top_channel', r.ch, 'brands', r.brands,
                         'avg_metric', r.avg_metric, 'sample', r.brands, 'aggregated', true),
      public.brain_confidence(r.brands::int, 0.6, r.last_seen), 1, 'mining', 'active',
      ARRAY['performance','channel','global']::text[],
      jsonb_build_object('miner','global_promotion','identifiable', false), r.last_seen)
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 entity_type, entity_id, category, title)
    DO UPDATE SET
      previous_confidence = public.brain_memory.confidence,
      confidence  = EXCLUDED.confidence,
      description = EXCLUDED.description,
      content     = EXCLUDED.content,
      last_observed_at = EXCLUDED.last_observed_at,
      status = 'active', updated_at = now();
    v_global := v_global + 1;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 5) DESCARTE: baixa relevância OU padrão sem sinal de resultado.
  -- ---------------------------------------------------------------------
  WITH low AS (
    UPDATE public.brain_memory m
       SET status = 'archived',
           metadata = COALESCE(m.metadata,'{}'::jsonb)
                      || jsonb_build_object('archived_reason', CASE
                            WHEN COALESCE((m.content->>'score')::numeric, 1) = 0
                             AND COALESCE((m.content->>'approved')::int,0) = 0
                             AND COALESCE((m.content->>'rework')::int,0) = 0
                              THEN 'no_outcome_signal'
                            ELSE 'low_relevance' END)
     WHERE m.status = 'active'
       AND m.origin IN ('learning','mining','consolidation')
       AND (
         (m.category = 'desempenho_por_formato'
           AND COALESCE((m.content->>'approved')::int,0) = 0
           AND COALESCE((m.content->>'rework')::int,0) = 0)
         OR (m.confidence < 0.20
             AND COALESCE((m.content->>'sample')::int, 0) < 3
             AND COALESCE(m.last_observed_at, m.updated_at) < now() - interval '30 days')
       )
    RETURNING 1)
  SELECT COUNT(*) INTO v_archived FROM low;

  RETURN jsonb_build_object('memories_created', v_created, 'memories_updated', v_updated,
                            'global_promoted', v_global, 'archived_low_relevance', v_archived,
                            'skipped_patterns', v_skipped);
END;
$fn$;

REVOKE ALL ON FUNCTION public.brain_mine_patterns(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brain_mine_patterns(uuid) TO service_role;