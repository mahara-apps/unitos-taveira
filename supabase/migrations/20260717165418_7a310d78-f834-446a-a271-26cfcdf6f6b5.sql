
-- =========================================================================
-- 1. EXTEND brain_events
-- =========================================================================
ALTER TABLE public.brain_events
  ADD COLUMN IF NOT EXISTS actor_id uuid,
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS confidence numeric(4,3) DEFAULT 1.000 CHECK (confidence >= 0 AND confidence <= 1),
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

CREATE INDEX IF NOT EXISTS brain_events_brand_created_idx ON public.brain_events(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brain_events_entity_idx ON public.brain_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS brain_events_actor_idx ON public.brain_events(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brain_events_type_idx ON public.brain_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS brain_events_unprocessed_idx ON public.brain_events(created_at) WHERE processed_at IS NULL;

-- =========================================================================
-- 2. brain_knowledge — fatos duráveis
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.brain_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid,
  category text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500 CHECK (confidence >= 0 AND confidence <= 1),
  source text NOT NULL DEFAULT 'system',
  source_event_ids uuid[] DEFAULT ARRAY[]::uuid[],
  reinforcement_count integer NOT NULL DEFAULT 1,
  last_reinforced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, client_id, category, key)
);

GRANT SELECT ON public.brain_knowledge TO authenticated;
GRANT ALL ON public.brain_knowledge TO service_role;
ALTER TABLE public.brain_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brain_knowledge select by brand or super admin"
  ON public.brain_knowledge FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()) OR (brand_id IS NOT NULL AND is_brand_member(brand_id, auth.uid())));

CREATE INDEX IF NOT EXISTS brain_knowledge_brand_cat_idx ON public.brain_knowledge(brand_id, category);
CREATE INDEX IF NOT EXISTS brain_knowledge_client_idx ON public.brain_knowledge(client_id);

-- =========================================================================
-- 3. brain_recommendations — sugestões acionáveis
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.brain_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid,
  target_user_id uuid,
  recommendation_type text NOT NULL,
  title text NOT NULL,
  description text,
  action_payload jsonb DEFAULT '{}'::jsonb,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','shown','accepted','dismissed','expired')),
  confidence numeric(4,3) NOT NULL DEFAULT 0.500 CHECK (confidence >= 0 AND confidence <= 1),
  source_insight_id uuid REFERENCES public.brain_insights(id) ON DELETE SET NULL,
  source_event_ids uuid[] DEFAULT ARRAY[]::uuid[],
  expires_at timestamptz,
  acted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.brain_recommendations TO authenticated;
GRANT ALL ON public.brain_recommendations TO service_role;
ALTER TABLE public.brain_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brain_recommendations select by brand or super admin"
  ON public.brain_recommendations FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()) OR (brand_id IS NOT NULL AND is_brand_member(brand_id, auth.uid())));

CREATE INDEX IF NOT EXISTS brain_recs_brand_status_idx ON public.brain_recommendations(brand_id, status, priority DESC);
CREATE INDEX IF NOT EXISTS brain_recs_user_idx ON public.brain_recommendations(target_user_id, status);

-- =========================================================================
-- 4. brain_memory — memória de curto/longo prazo por sujeito
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.brain_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  memory_type text NOT NULL CHECK (memory_type IN ('short_term','long_term','episodic','semantic')),
  scope text NOT NULL DEFAULT 'brand',
  key text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500 CHECK (confidence >= 0 AND confidence <= 1),
  decay_rate numeric(4,3) NOT NULL DEFAULT 0.000,
  access_count integer NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, subject_type, subject_id, memory_type, key)
);

GRANT SELECT ON public.brain_memory TO authenticated;
GRANT ALL ON public.brain_memory TO service_role;
ALTER TABLE public.brain_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brain_memory select by brand or super admin"
  ON public.brain_memory FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()) OR (brand_id IS NOT NULL AND is_brand_member(brand_id, auth.uid())));

CREATE INDEX IF NOT EXISTS brain_memory_subject_idx ON public.brain_memory(brand_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS brain_memory_expires_idx ON public.brain_memory(expires_at) WHERE expires_at IS NOT NULL;

-- =========================================================================
-- 5. brain_relationships — grafo entre entidades
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.brain_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  from_type text NOT NULL,
  from_id uuid NOT NULL,
  to_type text NOT NULL,
  to_id uuid NOT NULL,
  relationship_type text NOT NULL,
  strength numeric(4,3) NOT NULL DEFAULT 0.500 CHECK (strength >= 0 AND strength <= 1),
  confidence numeric(4,3) NOT NULL DEFAULT 0.500 CHECK (confidence >= 0 AND confidence <= 1),
  bidirectional boolean NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  observation_count integer NOT NULL DEFAULT 1,
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, from_type, from_id, to_type, to_id, relationship_type)
);

GRANT SELECT ON public.brain_relationships TO authenticated;
GRANT ALL ON public.brain_relationships TO service_role;
ALTER TABLE public.brain_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brain_relationships select by brand or super admin"
  ON public.brain_relationships FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()) OR (brand_id IS NOT NULL AND is_brand_member(brand_id, auth.uid())));

CREATE INDEX IF NOT EXISTS brain_rel_from_idx ON public.brain_relationships(brand_id, from_type, from_id);
CREATE INDEX IF NOT EXISTS brain_rel_to_idx ON public.brain_relationships(brand_id, to_type, to_id);

-- =========================================================================
-- 6. EVENT BUS — emit_brain_event
-- =========================================================================
CREATE OR REPLACE FUNCTION public.emit_brain_event(
  p_brand_id uuid,
  p_event_type text,
  p_source_module text,
  p_actor_id uuid DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_confidence numeric DEFAULT 1.0,
  p_correlation_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.brain_events (
    brand_id, event_type, source_module, actor_id,
    entity_type, entity_id, action, client_id, project_id,
    payload, confidence, correlation_id
  ) VALUES (
    p_brand_id, p_event_type, p_source_module, p_actor_id,
    p_entity_type, p_entity_id, p_action, p_client_id, p_project_id,
    COALESCE(p_payload, '{}'::jsonb), COALESCE(p_confidence, 1.0), p_correlation_id
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_brain_event(uuid,text,text,uuid,text,uuid,text,uuid,uuid,jsonb,numeric,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emit_brain_event(uuid,text,text,uuid,text,uuid,text,uuid,uuid,jsonb,numeric,uuid) TO service_role;

-- =========================================================================
-- 7. TRIGGERS — auto-emit on core tables
-- =========================================================================

-- tasks
CREATE OR REPLACE FUNCTION public.brain_trg_tasks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text; v_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created'; v_type := 'task.created';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'status_changed';
      v_type := CASE WHEN NEW.status = 'done' THEN 'task.completed' ELSE 'task.updated' END;
    ELSE
      v_action := 'updated'; v_type := 'task.updated';
    END IF;
  END IF;
  PERFORM public.emit_brain_event(
    NEW.brand_id, v_type, 'tasks', auth.uid(),
    'task', NEW.id, v_action, NEW.client_id, NEW.project_id,
    jsonb_build_object('status', NEW.status, 'priority', NEW.priority, 'title', NEW.title)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS brain_tasks_evt ON public.tasks;
CREATE TRIGGER brain_tasks_evt AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.brain_trg_tasks();

-- posts (content)
CREATE OR REPLACE FUNCTION public.brain_trg_posts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text; v_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created'; v_type := 'content.created';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      v_action := 'stage_changed'; v_type := 'content.stage_changed';
    ELSE
      v_action := 'updated'; v_type := 'content.updated';
    END IF;
  END IF;
  PERFORM public.emit_brain_event(
    NEW.brand_id, v_type, 'content', auth.uid(),
    'post', NEW.id, v_action, NEW.client_id, NULL,
    jsonb_build_object('stage_id', NEW.stage_id, 'title', NEW.title)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS brain_posts_evt ON public.posts;
CREATE TRIGGER brain_posts_evt AFTER INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.brain_trg_posts();

-- projects
CREATE OR REPLACE FUNCTION public.brain_trg_projects() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text; v_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN v_action := 'created'; v_type := 'project.created';
  ELSE v_action := 'updated'; v_type := 'project.updated';
  END IF;
  PERFORM public.emit_brain_event(
    NEW.brand_id, v_type, 'projects', auth.uid(),
    'project', NEW.id, v_action, NEW.client_id, NEW.id,
    jsonb_build_object('status', NEW.status, 'name', NEW.name)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS brain_projects_evt ON public.projects;
CREATE TRIGGER brain_projects_evt AFTER INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.brain_trg_projects();

-- clients (customers)
CREATE OR REPLACE FUNCTION public.brain_trg_clients() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_type text;
BEGIN
  v_type := CASE WHEN TG_OP = 'INSERT' THEN 'customer.created' ELSE 'customer.updated' END;
  PERFORM public.emit_brain_event(
    NEW.brand_id, v_type, 'customers', auth.uid(),
    'customer', NEW.id, lower(TG_OP), NEW.id, NULL,
    jsonb_build_object('name', NEW.name)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS brain_clients_evt ON public.clients;
CREATE TRIGGER brain_clients_evt AFTER INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.brain_trg_clients();

-- task_comments
CREATE OR REPLACE FUNCTION public.brain_trg_task_comments() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_brand uuid; v_client uuid; v_project uuid;
BEGIN
  SELECT brand_id, client_id, project_id INTO v_brand, v_client, v_project
  FROM public.tasks WHERE id = NEW.task_id;
  PERFORM public.emit_brain_event(
    v_brand, 'comment.created', 'tasks', NEW.author_id,
    'task_comment', NEW.id, 'created', v_client, v_project,
    jsonb_build_object('task_id', NEW.task_id)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS brain_task_comments_evt ON public.task_comments;
CREATE TRIGGER brain_task_comments_evt AFTER INSERT ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.brain_trg_task_comments();

-- client_documents (uploads)
CREATE OR REPLACE FUNCTION public.brain_trg_client_documents() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.emit_brain_event(
    NEW.brand_id, 'file.uploaded', 'documents', auth.uid(),
    'document', NEW.id, 'created', NEW.client_id, NULL,
    jsonb_build_object('file_name', NEW.file_name)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS brain_client_docs_evt ON public.client_documents;
CREATE TRIGGER brain_client_docs_evt AFTER INSERT ON public.client_documents
  FOR EACH ROW EXECUTE FUNCTION public.brain_trg_client_documents();

-- post_approvals
CREATE OR REPLACE FUNCTION public.brain_trg_post_approvals() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_brand uuid; v_client uuid;
BEGIN
  SELECT brand_id, client_id INTO v_brand, v_client FROM public.posts WHERE id = NEW.post_id;
  PERFORM public.emit_brain_event(
    v_brand, 'content.approval', 'approvals', NEW.reviewer_id,
    'post_approval', NEW.id, COALESCE(NEW.status, 'reviewed'), v_client, NULL,
    jsonb_build_object('post_id', NEW.post_id, 'status', NEW.status)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS brain_post_approvals_evt ON public.post_approvals;
CREATE TRIGGER brain_post_approvals_evt AFTER INSERT OR UPDATE ON public.post_approvals
  FOR EACH ROW EXECUTE FUNCTION public.brain_trg_post_approvals();

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.brain_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS brain_knowledge_touch ON public.brain_knowledge;
CREATE TRIGGER brain_knowledge_touch BEFORE UPDATE ON public.brain_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.brain_touch_updated_at();

DROP TRIGGER IF EXISTS brain_recs_touch ON public.brain_recommendations;
CREATE TRIGGER brain_recs_touch BEFORE UPDATE ON public.brain_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.brain_touch_updated_at();

DROP TRIGGER IF EXISTS brain_memory_touch ON public.brain_memory;
CREATE TRIGGER brain_memory_touch BEFORE UPDATE ON public.brain_memory
  FOR EACH ROW EXECUTE FUNCTION public.brain_touch_updated_at();

DROP TRIGGER IF EXISTS brain_rel_touch ON public.brain_relationships;
CREATE TRIGGER brain_rel_touch BEFORE UPDATE ON public.brain_relationships
  FOR EACH ROW EXECUTE FUNCTION public.brain_touch_updated_at();
