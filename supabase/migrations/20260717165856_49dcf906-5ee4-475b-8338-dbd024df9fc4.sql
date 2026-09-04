
-- Extend brain_memory to match the requested BrainMemory contract
ALTER TABLE public.brain_memory
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS source_event uuid REFERENCES public.brain_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS relations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Backfill entity_* from subject_* if empty
UPDATE public.brain_memory
   SET entity_type = COALESCE(entity_type, subject_type),
       entity_id   = COALESCE(entity_id, subject_id),
       category    = COALESCE(category, memory_type),
       title       = COALESCE(title, key)
 WHERE entity_type IS NULL OR entity_id IS NULL OR category IS NULL OR title IS NULL;

-- Make subject_* nullable so future inserts can rely on entity_* only
ALTER TABLE public.brain_memory ALTER COLUMN subject_type DROP NOT NULL;
ALTER TABLE public.brain_memory ALTER COLUMN subject_id   DROP NOT NULL;

-- Indexes for list/search/filter/group
CREATE INDEX IF NOT EXISTS idx_brain_memory_brand         ON public.brain_memory (brand_id);
CREATE INDEX IF NOT EXISTS idx_brain_memory_entity        ON public.brain_memory (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_brain_memory_category      ON public.brain_memory (category);
CREATE INDEX IF NOT EXISTS idx_brain_memory_status        ON public.brain_memory (status);
CREATE INDEX IF NOT EXISTS idx_brain_memory_tags          ON public.brain_memory USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_brain_memory_confidence    ON public.brain_memory (confidence DESC);

-- Unique key per (brand, entity, category, title) — enables deterministic upserts by the consolidator
CREATE UNIQUE INDEX IF NOT EXISTS uq_brain_memory_ident
  ON public.brain_memory (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_id, category, title);

-- Deterministic consolidator: transforms brain_events into structured memories
-- (no AI, pure aggregation) — safe to run repeatedly.
CREATE OR REPLACE FUNCTION public.consolidate_brain_memory(_brand_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  written integer := 0;
  r record;
BEGIN
  -- 1) Approval latency per client (avg hours between post created and approved)
  FOR r IN
    SELECT p.brand_id, p.client_id,
           AVG(EXTRACT(EPOCH FROM (p.approved_at - p.created_at))/3600.0) AS avg_hours,
           COUNT(*) AS n
      FROM public.posts p
     WHERE p.approved_at IS NOT NULL
       AND (_brand_id IS NULL OR p.brand_id = _brand_id)
     GROUP BY p.brand_id, p.client_id
    HAVING COUNT(*) >= 3
  LOOP
    INSERT INTO public.brain_memory
      (brand_id, subject_type, subject_id, memory_type, scope, key, content, confidence,
       entity_type, entity_id, category, title, description, tags, relations, metadata, status)
    VALUES
      (r.brand_id, 'client', r.client_id, 'pattern', 'client', 'approval_latency_hours',
       jsonb_build_object('avg_hours', round(r.avg_hours::numeric, 2), 'sample_size', r.n),
       LEAST(0.5 + (r.n::numeric / 50.0), 0.98),
       'client', r.client_id, 'approval_pattern',
       'Tempo médio de aprovação',
       'Aprovações levam em média ' || round(r.avg_hours::numeric, 1) || 'h (amostra: ' || r.n || ' posts).',
       ARRAY['approval','latency','client'], '[]'::jsonb,
       jsonb_build_object('avg_hours', round(r.avg_hours::numeric, 2), 'sample_size', r.n),
       'active')
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_id, category, title)
    DO UPDATE SET
      content    = EXCLUDED.content,
      metadata   = EXCLUDED.metadata,
      confidence = EXCLUDED.confidence,
      description= EXCLUDED.description,
      updated_at = now();
    written := written + 1;
  END LOOP;

  -- 2) Best performing publish slot (day-of-week + hour) per brand
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
       entity_type, entity_id, category, title, description, tags, relations, metadata, status)
    VALUES
      (r.brand_id, 'brand', r.brand_id, 'pattern', 'brand',
       'publish_slot_' || r.dow || '_' || r.hour,
       jsonb_build_object('dow', r.dow, 'hour', r.hour, 'sample_size', r.n),
       LEAST(0.4 + (r.n::numeric / 40.0), 0.95),
       'brand', r.brand_id, 'publish_slot',
       'Slot recorrente: dia ' || r.dow || ' às ' || r.hour || 'h',
       'Padrão de publicação identificado (amostra: ' || r.n || ').',
       ARRAY['publish','schedule','pattern'], '[]'::jsonb,
       jsonb_build_object('dow', r.dow, 'hour', r.hour, 'sample_size', r.n),
       'active')
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_id, category, title)
    DO UPDATE SET
      content    = EXCLUDED.content,
      metadata   = EXCLUDED.metadata,
      confidence = EXCLUDED.confidence,
      updated_at = now();
    written := written + 1;
  END LOOP;

  -- 3) Project size / delay risk
  FOR r IN
    SELECT pr.brand_id, pr.id AS project_id, pr.name,
           COUNT(t.id)                                   AS tasks,
           COUNT(t.id) FILTER (WHERE t.due_at < now() AND t.done = false) AS overdue
      FROM public.projects pr
      LEFT JOIN public.tasks t ON t.project_id = pr.id
     WHERE (_brand_id IS NULL OR pr.brand_id = _brand_id)
     GROUP BY pr.brand_id, pr.id, pr.name
    HAVING COUNT(t.id) >= 10
  LOOP
    INSERT INTO public.brain_memory
      (brand_id, subject_type, subject_id, memory_type, scope, key, content, confidence,
       entity_type, entity_id, category, title, description, tags, relations, metadata, status)
    VALUES
      (r.brand_id, 'project', r.project_id, 'risk', 'project', 'project_delay_risk',
       jsonb_build_object('tasks', r.tasks, 'overdue', r.overdue),
       LEAST(0.5 + (r.overdue::numeric / GREATEST(r.tasks,1))*0.5, 0.98),
       'project', r.project_id, 'delay_risk',
       'Risco de atraso: ' || coalesce(r.name,'projeto'),
       r.tasks || ' tarefas, ' || r.overdue || ' em atraso.',
       ARRAY['project','risk','delay'], '[]'::jsonb,
       jsonb_build_object('tasks', r.tasks, 'overdue', r.overdue),
       CASE WHEN r.overdue = 0 THEN 'archived' ELSE 'active' END)
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
END $$;

GRANT EXECUTE ON FUNCTION public.consolidate_brain_memory(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.consolidate_brain_memory(uuid) FROM anon, public;
