
-- =========================================================
-- NexusFlow: reset completo do modelo
-- =========================================================

-- Drop tabelas legadas que não encaixam
DROP TABLE IF EXISTS public.post_approvals CASCADE;
DROP TABLE IF EXISTS public.posts CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;
DROP TABLE IF EXISTS public.leads CASCADE;
DROP TABLE IF EXISTS public.ai_agents CASCADE;
DROP TABLE IF EXISTS public.campaigns CASCADE;

-- Enums
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('owner','manager','editor','designer','client');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TYPE public.project_status AS ENUM ('planning','in_progress','active','paused','done');
CREATE TYPE public.task_status    AS ENUM ('todo','in_progress','review','done');
CREATE TYPE public.task_priority  AS ENUM ('low','medium','high','urgent');
CREATE TYPE public.post_stage     AS ENUM ('idea','production','review','approved','scheduled','published');
CREATE TYPE public.post_channel   AS ENUM ('instagram','tiktok','linkedin','x','youtube','blog');
CREATE TYPE public.alert_severity AS ENUM ('info','warning','critical');
CREATE TYPE public.notification_kind AS ENUM ('mention','assignment','approval_requested','approval_decision','deadline','system');
CREATE TYPE public.approval_status AS ENUM ('pending','approved','changes_requested');

-- Trigger para updated_at (já existe update_updated_at_column)

-- ===================== brands =====================
CREATE TABLE public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  color text DEFAULT '#8b5cf6',
  logo_url text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;
GRANT ALL ON public.brands TO service_role;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_brands_updated BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===================== brand_members =====================
CREATE TABLE public.brand_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'editor',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_members TO authenticated;
GRANT ALL ON public.brand_members TO service_role;
ALTER TABLE public.brand_members ENABLE ROW LEVEL SECURITY;

-- Helper SECURITY DEFINER (sem recursão de RLS)
CREATE OR REPLACE FUNCTION public.is_brand_member(_brand_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.brand_members WHERE brand_id = _brand_id AND user_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.has_brand_role(_brand_id uuid, _user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.brand_members WHERE brand_id = _brand_id AND user_id = _user_id AND role = _role);
$$;

-- Policies brands / brand_members
CREATE POLICY "members read brand" ON public.brands FOR SELECT TO authenticated
  USING (public.is_brand_member(id, auth.uid()));
CREATE POLICY "any auth creates brand" ON public.brands FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "owner updates brand" ON public.brands FOR UPDATE TO authenticated
  USING (public.has_brand_role(id, auth.uid(), 'owner'))
  WITH CHECK (public.has_brand_role(id, auth.uid(), 'owner'));

CREATE POLICY "members read own memberships" ON public.brand_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_brand_member(brand_id, auth.uid()));
CREATE POLICY "owner manages members" ON public.brand_members FOR ALL TO authenticated
  USING (public.has_brand_role(brand_id, auth.uid(), 'owner') OR user_id = auth.uid())
  WITH CHECK (public.has_brand_role(brand_id, auth.uid(), 'owner') OR user_id = auth.uid());

-- Ao criar uma brand, adiciona o criador como owner
CREATE OR REPLACE FUNCTION public.add_brand_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.brand_members (brand_id, user_id, role) VALUES (NEW.id, NEW.created_by, 'owner');
  RETURN NEW;
END $$;
CREATE TRIGGER trg_brands_add_owner AFTER INSERT ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.add_brand_owner();

-- ===================== clients =====================
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  niche text,
  color text DEFAULT '#6366f1',
  contact_name text,
  contact_email text,
  contact_phone text,
  tone_of_voice text,
  palette jsonb DEFAULT '[]'::jsonb,
  socials jsonb DEFAULT '[]'::jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "brand members manage clients" ON public.clients FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

-- ===================== client_briefings =====================
CREATE TABLE public.client_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  personas jsonb DEFAULT '[]'::jsonb,
  target_audience text,
  hashtags text[] DEFAULT '{}',
  monthly_volume int DEFAULT 0,
  guidelines text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_briefings TO authenticated;
GRANT ALL ON public.client_briefings TO service_role;
ALTER TABLE public.client_briefings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_briefings_updated BEFORE UPDATE ON public.client_briefings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "brand members manage briefings" ON public.client_briefings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND public.is_brand_member(c.brand_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND public.is_brand_member(c.brand_id, auth.uid())));

-- ===================== projects =====================
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status public.project_status NOT NULL DEFAULT 'planning',
  progress int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  due_at timestamptz,
  owner_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "brand members manage projects" ON public.projects FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

-- ===================== tasks =====================
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status public.task_status NOT NULL DEFAULT 'todo',
  priority public.task_priority NOT NULL DEFAULT 'medium',
  assignee_id uuid REFERENCES auth.users(id),
  due_at timestamptz,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "brand members manage tasks" ON public.tasks FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

-- ===================== posts =====================
CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title text NOT NULL,
  copy text DEFAULT '',
  channels public.post_channel[] NOT NULL DEFAULT '{}',
  stage public.post_stage NOT NULL DEFAULT 'idea',
  scheduled_at timestamptz,
  published_at timestamptz,
  assignee_id uuid REFERENCES auth.users(id),
  cover_url text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT ALL ON public.posts TO service_role;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_posts_updated BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "brand members manage posts" ON public.posts FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

-- ===================== post_approvals =====================
CREATE TABLE public.post_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  status public.approval_status NOT NULL DEFAULT 'pending',
  notes text,
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_approvals TO authenticated;
GRANT ALL ON public.post_approvals TO service_role;
ALTER TABLE public.post_approvals ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_approvals_updated BEFORE UPDATE ON public.post_approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "brand members manage approvals" ON public.post_approvals FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND public.is_brand_member(p.brand_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND public.is_brand_member(p.brand_id, auth.uid())));

-- ===================== portal_tokens =====================
CREATE TABLE public.portal_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  label text,
  revoked_at timestamptz,
  expires_at timestamptz,
  last_seen_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_tokens TO authenticated;
GRANT ALL ON public.portal_tokens TO service_role;
ALTER TABLE public.portal_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand members manage portal tokens" ON public.portal_tokens FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND public.is_brand_member(c.brand_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND public.is_brand_member(c.brand_id, auth.uid())));

-- ===================== notifications =====================
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  kind public.notification_kind NOT NULL,
  title text NOT NULL,
  body text,
  href text,
  read_at timestamptz,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own notifications" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "user updates own notifications" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "brand members create notifications" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

-- ===================== activity_events =====================
CREATE TABLE public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  verb text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.activity_events TO authenticated;
GRANT ALL ON public.activity_events TO service_role;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX activity_events_brand_created_idx ON public.activity_events (brand_id, created_at DESC);
CREATE POLICY "brand members read activity" ON public.activity_events FOR SELECT TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()));

-- Triggers de activity_events
CREATE OR REPLACE FUNCTION public.log_task_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
    VALUES (NEW.brand_id, NEW.client_id, NEW.created_by, 'task', NEW.id, 'created', jsonb_build_object('title', NEW.title));
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> NEW.status THEN
    INSERT INTO public.activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
    VALUES (NEW.brand_id, NEW.client_id, auth.uid(), 'task', NEW.id, 'status_changed',
            jsonb_build_object('from', OLD.status, 'to', NEW.status, 'title', NEW.title));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_tasks_activity AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_activity();

CREATE OR REPLACE FUNCTION public.log_post_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
    VALUES (NEW.brand_id, NEW.client_id, NEW.created_by, 'post', NEW.id, 'created', jsonb_build_object('title', NEW.title));
  ELSIF TG_OP = 'UPDATE' AND OLD.stage <> NEW.stage THEN
    INSERT INTO public.activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
    VALUES (NEW.brand_id, NEW.client_id, auth.uid(), 'post', NEW.id, 'stage_changed',
            jsonb_build_object('from', OLD.stage, 'to', NEW.stage, 'title', NEW.title));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_posts_activity AFTER INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.log_post_activity();

-- Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.post_approvals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_events;
