-- 1) Comentários de projeto e job
CREATE TABLE public.work_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.project_jobs(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_comments_project_idx ON public.work_comments (project_id, created_at);
CREATE INDEX work_comments_job_idx ON public.work_comments (job_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_comments TO authenticated;
GRANT ALL ON public.work_comments TO service_role;
ALTER TABLE public.work_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_comments_select" ON public.work_comments
  FOR SELECT TO authenticated
  USING (public.can_access_project(project_id, auth.uid()));
CREATE POLICY "work_comments_insert" ON public.work_comments
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.can_access_project(project_id, auth.uid()));
CREATE POLICY "work_comments_update_own" ON public.work_comments
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid() AND public.can_access_project(project_id, auth.uid()))
  WITH CHECK (author_id = auth.uid());
CREATE POLICY "work_comments_delete_own" ON public.work_comments
  FOR DELETE TO authenticated
  USING (author_id = auth.uid() AND public.can_access_project(project_id, auth.uid()));

CREATE TRIGGER work_comments_touch
  BEFORE UPDATE ON public.work_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Envolvidos no projeto
CREATE TABLE public.project_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX project_participants_project_idx ON public.project_participants (project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_participants TO authenticated;
GRANT ALL ON public.project_participants TO service_role;
ALTER TABLE public.project_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_participants_select" ON public.project_participants
  FOR SELECT TO authenticated
  USING (public.can_access_project(project_id, auth.uid()));
CREATE POLICY "project_participants_insert" ON public.project_participants
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_project(project_id, auth.uid()));
CREATE POLICY "project_participants_delete" ON public.project_participants
  FOR DELETE TO authenticated
  USING (public.can_access_project(project_id, auth.uid()));

-- 3) Status cadastráveis por workspace
CREATE TABLE public.work_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('project', 'job', 'task')),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#8b5cf6',
  position integer NOT NULL DEFAULT 0,
  is_done boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_statuses_brand_scope_idx ON public.work_statuses (brand_id, scope, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_statuses TO authenticated;
GRANT ALL ON public.work_statuses TO service_role;
ALTER TABLE public.work_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_statuses_select" ON public.work_statuses
  FOR SELECT TO authenticated
  USING (public.brand_member_role(auth.uid(), brand_id) IS NOT NULL);
CREATE POLICY "work_statuses_write" ON public.work_statuses
  FOR ALL TO authenticated
  USING (public.brand_member_role(auth.uid(), brand_id) IN ('owner', 'admin'))
  WITH CHECK (public.brand_member_role(auth.uid(), brand_id) IN ('owner', 'admin'));

CREATE TRIGGER work_statuses_touch
  BEFORE UPDATE ON public.work_statuses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Campos adicionais em jobs, projetos e tarefas
ALTER TABLE public.project_jobs
  ADD COLUMN IF NOT EXISTS assignee_id uuid,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS due_at date,
  ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES public.work_statuses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS done_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES public.work_statuses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS done_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES public.work_statuses(id) ON DELETE SET NULL;