-- =====================================================================
-- FASE 5 — Fechamento de escopo em funções SECURITY DEFINER de leitura
-- e em agregações brand-only. Nenhuma mudança de schema.
-- Fonte única de autorização: client_in_scope / can_access_client /
-- app_access_role / is_super_admin (já canônicos).
-- =====================================================================

-- 1) Grafo do Brain: herda escopo por cliente (client_id NULL = brand-level).
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
       AND (public.is_super_admin(auth.uid())
            OR public.client_in_scope(r.client_id, r.brand_id))
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

-- 2) Vizinhança do Brain: mesmo escopo por cliente na travessia e nas arestas.
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
  v_super boolean := public.is_super_admin(auth.uid());
BEGIN
  IF _brand_id IS NOT NULL
     AND NOT v_super
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
       AND (v_super OR public.client_in_scope(r.client_id, r.brand_id))
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
       AND (v_super OR public.client_in_scope(r.client_id, r.brand_id))
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

-- 3) Busca semântica de eventos: herda escopo do evento pai (client_id).
CREATE OR REPLACE FUNCTION public.match_brain_events(
  _brand_id uuid,
  _query vector,
  _match_count integer DEFAULT 8
) RETURNS TABLE(
  event_id uuid,
  content_summary text,
  event_type text,
  source_module text,
  payload jsonb,
  created_at timestamptz,
  similarity double precision
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select
    e.id as event_id,
    em.content_summary,
    e.event_type,
    e.source_module,
    e.payload,
    e.created_at,
    1 - (em.embedding <=> _query) as similarity
  from public.brain_embeddings em
  join public.brain_events e on e.id = em.event_id
  where em.brand_id = _brand_id
    and em.embedding is not null
    and (
      public.is_super_admin(auth.uid())
      or public.client_in_scope(e.client_id, e.brand_id)
    )
  order by em.embedding <=> _query
  limit _match_count;
$$;

-- 4) Snapshots consolidados por canal cobrem o workspace inteiro (sem client_id):
--    somente super admin e ADMIN do workspace podem ler.
DROP POLICY IF EXISTS "brain_metrics select by brand or super admin" ON public.brain_metrics_snapshots;
CREATE POLICY "brain_metrics select admin scope"
ON public.brain_metrics_snapshots
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    brand_id IS NOT NULL
    AND public.app_access_role(auth.uid(), brand_id) IN ('super_admin', 'admin')
  )
);

-- 5) Custos de IA: ADMIN vê o workspace; MANAGER vê apenas clientes atribuídos
--    (e os totais são recalculados dentro desse escopo).
CREATE OR REPLACE FUNCTION public.list_ai_usage_overview(
  _brand_id uuid,
  _period_start timestamptz DEFAULT date_trunc('month', now()),
  _period_end timestamptz DEFAULT (date_trunc('month', now()) + interval '1 month')
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
  brand_spent numeric := 0;
  brand_limit numeric;
  brand_hard boolean;
  brand_notify int;
  v_full boolean;
BEGIN
  IF NOT public.can_manage_brand_ai_limits(_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Autoridade total no workspace (super admin / admin) vê a agregação completa.
  v_full := public.is_super_admin(auth.uid())
            OR public.app_access_role(auth.uid(), _brand_id) IN ('super_admin', 'admin');

  SELECT COALESCE(SUM(u.cost_usd), 0) INTO brand_spent
    FROM public.brand_ai_usage u
   WHERE u.brand_id = _brand_id
     AND u.created_at >= _period_start AND u.created_at < _period_end
     AND (v_full OR (u.client_id IS NOT NULL
                     AND public.can_access_client(u.client_id, auth.uid())));

  SELECT limit_usd, hard_stop, notify_at_pct
    INTO brand_limit, brand_hard, brand_notify
    FROM public.ai_usage_limits
   WHERE brand_id = _brand_id AND scope = 'brand' LIMIT 1;

  result := jsonb_build_object(
    'brand', jsonb_build_object(
      'spent', brand_spent,
      'limit', CASE WHEN v_full THEN brand_limit ELSE NULL END,
      'hard_stop', CASE WHEN v_full THEN brand_hard ELSE NULL END,
      'notify_at_pct', CASE WHEN v_full THEN brand_notify ELSE NULL END
    ),
    'scoped', NOT v_full,
    'clients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'client_id', c.id,
        'client_name', c.name,
        'spent', COALESCE(u.spent, 0),
        'limit', l.limit_usd,
        'hard_stop', l.hard_stop,
        'notify_at_pct', l.notify_at_pct,
        'limit_id', l.id
      ) ORDER BY COALESCE(u.spent, 0) DESC)
      FROM public.clients c
      LEFT JOIN (
        SELECT client_id, SUM(cost_usd) AS spent
          FROM public.brand_ai_usage
         WHERE brand_id = _brand_id AND client_id IS NOT NULL
           AND created_at >= _period_start AND created_at < _period_end
         GROUP BY client_id
      ) u ON u.client_id = c.id
      LEFT JOIN public.ai_usage_limits l
        ON l.brand_id = _brand_id AND l.scope = 'client' AND l.client_id = c.id
     WHERE c.brand_id = _brand_id
       AND (v_full OR public.can_access_client(c.id, auth.uid()))
    ), '[]'::jsonb),
    -- Consumo sem cliente é agregação de workspace: só para autoridade total.
    'unassigned_client_spent', CASE WHEN v_full THEN COALESCE((
      SELECT SUM(cost_usd) FROM public.brand_ai_usage
       WHERE brand_id = _brand_id AND client_id IS NULL
         AND created_at >= _period_start AND created_at < _period_end
    ), 0) ELSE 0 END,
    'users', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', u.actor_id,
        'client_id', u.client_id,
        'display_name', p.full_name,
        'email', au.email,
        'spent', u.spent,
        'limit', l.limit_usd,
        'hard_stop', l.hard_stop,
        'notify_at_pct', l.notify_at_pct,
        'limit_id', l.id
      ) ORDER BY u.spent DESC)
      FROM (
        SELECT actor_id, client_id, SUM(cost_usd) AS spent
          FROM public.brand_ai_usage
         WHERE brand_id = _brand_id AND actor_id IS NOT NULL
           AND created_at >= _period_start AND created_at < _period_end
         GROUP BY actor_id, client_id
      ) u
      LEFT JOIN public.user_profiles p ON p.id = u.actor_id
      LEFT JOIN auth.users au ON au.id = u.actor_id
      LEFT JOIN public.ai_usage_limits l
        ON l.brand_id = _brand_id AND l.scope = 'user' AND l.user_id = u.actor_id
       AND (l.client_id IS NULL OR l.client_id = u.client_id)
      WHERE v_full
         OR (u.client_id IS NOT NULL AND public.can_access_client(u.client_id, auth.uid()))
    ), '[]'::jsonb)
  );

  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.list_ai_usage_overview(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_ai_usage_overview(uuid, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_brain_graph(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_brain_neighborhood(uuid, text, uuid, integer) TO authenticated;
