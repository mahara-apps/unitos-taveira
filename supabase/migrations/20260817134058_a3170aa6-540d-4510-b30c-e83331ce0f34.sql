-- Ignora pares (created_at, approved_at) inconsistentes: evita média negativa.
CREATE OR REPLACE FUNCTION public.consolidate_brain_memory(_brand_id uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
       AND p.approved_at > p.created_at            -- <== descarta inconsistências
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
      status     = 'active',
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
      status     = 'active',
      updated_at = now();
    written := written + 1;
  END LOOP;

  -- 3) Risco de atraso por projeto (memória de MARCA).
  FOR r IN
    SELECT pr.brand_id, pr.id AS project_id, pr.name,
           COUNT(t.id)                                                    AS tasks,
           COUNT(t.id) FILTER (WHERE t.due_at < now() AND t.done = false)  AS overdue
      FROM public.projects pr
      LEFT JOIN public.tasks t ON t.project_id = pr.id
     WHERE (_brand_id IS NULL OR pr.brand_id = _brand_id)
     GROUP BY pr.brand_id, pr.id, pr.name
    HAVING COUNT(t.id) >= 10 AND COUNT(t.id) FILTER (WHERE t.due_at < now() AND t.done = false) > 0
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
       'Risco de atraso: ' || coalesce(r.name, 'projeto'),
       r.overdue || ' de ' || r.tasks || ' tarefas em atraso.',
       ARRAY['delay','risk','project'],
       jsonb_build_object('tasks', r.tasks, 'overdue', r.overdue),
       'active', 'consolidation')
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_id, category, title)
    DO UPDATE SET
      content    = EXCLUDED.content,
      metadata   = EXCLUDED.metadata,
      confidence = EXCLUDED.confidence,
      description= EXCLUDED.description,
      status     = 'active',
      updated_at = now();
    written := written + 1;
  END LOOP;

  RETURN written;
END;
$fn$;

REVOKE ALL ON FUNCTION public.consolidate_brain_memory(uuid) FROM PUBLIC, anon, authenticated;

-- Neutraliza as memórias já gravadas com média negativa até o recálculo.
UPDATE public.brain_memory
   SET status = 'archived',
       metadata = coalesce(metadata,'{}'::jsonb)
                  || jsonb_build_object('archived_reason','invalid_negative_latency')
 WHERE category = 'padrao_de_aprovacao'
   AND status = 'active'
   AND (metadata->>'avg_hours')::numeric <= 0;