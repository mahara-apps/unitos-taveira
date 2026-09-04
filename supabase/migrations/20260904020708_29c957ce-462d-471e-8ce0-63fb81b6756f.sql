CREATE TABLE public.work_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.project_jobs(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES public.monthly_plan_topics(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text,
  source text NOT NULL DEFAULT 'link',
  created_by uuid,
  created_by_client boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_links_url_scheme CHECK (url ~* '^https?://.{3,}$' AND length(url) <= 2000),
  CONSTRAINT work_links_single_target CHECK (
    (CASE WHEN project_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN job_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN task_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN post_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN topic_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);

CREATE INDEX work_links_project_idx ON public.work_links (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX work_links_job_idx ON public.work_links (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX work_links_task_idx ON public.work_links (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX work_links_post_idx ON public.work_links (post_id) WHERE post_id IS NOT NULL;
CREATE INDEX work_links_topic_idx ON public.work_links (topic_id) WHERE topic_id IS NOT NULL;
CREATE INDEX work_links_brand_idx ON public.work_links (brand_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_links TO authenticated;
GRANT ALL ON public.work_links TO service_role;

ALTER TABLE public.work_links ENABLE ROW LEVEL SECURITY;

-- Membros do workspace: escopo herdado do cliente (owner/admin cobrem o workspace;
-- manager/user só clientes atribuídos). Links sem cliente exigem membership no brand.
CREATE POLICY "work_links_select_members" ON public.work_links
  FOR SELECT TO authenticated
  USING (
    (client_id IS NOT NULL AND public.can_access_client(client_id, auth.uid()))
    OR (client_id IS NULL AND public.brand_member_role(auth.uid(), brand_id) IS NOT NULL)
    OR (client_id IS NOT NULL AND public.is_portal_client_of(client_id, auth.uid()))
  );

CREATE POLICY "work_links_insert_members" ON public.work_links
  FOR INSERT TO authenticated
  WITH CHECK (
    (client_id IS NOT NULL AND public.can_access_client(client_id, auth.uid()))
    OR (client_id IS NULL AND public.brand_member_role(auth.uid(), brand_id) IS NOT NULL)
    OR (client_id IS NOT NULL AND public.is_portal_client_of(client_id, auth.uid()) AND created_by_client)
  );

CREATE POLICY "work_links_update_members" ON public.work_links
  FOR UPDATE TO authenticated
  USING (
    (client_id IS NOT NULL AND public.can_access_client(client_id, auth.uid()))
    OR (client_id IS NULL AND public.brand_member_role(auth.uid(), brand_id) IS NOT NULL)
  )
  WITH CHECK (
    (client_id IS NOT NULL AND public.can_access_client(client_id, auth.uid()))
    OR (client_id IS NULL AND public.brand_member_role(auth.uid(), brand_id) IS NOT NULL)
  );

-- Agência apaga qualquer link do seu escopo; cliente do portal apaga só o que ele enviou.
CREATE POLICY "work_links_delete_members" ON public.work_links
  FOR DELETE TO authenticated
  USING (
    (client_id IS NOT NULL AND public.can_access_client(client_id, auth.uid()))
    OR (client_id IS NULL AND public.brand_member_role(auth.uid(), brand_id) IS NOT NULL)
    OR (
      client_id IS NOT NULL
      AND public.is_portal_client_of(client_id, auth.uid())
      AND created_by_client
      AND created_by = auth.uid()
    )
  );

CREATE TRIGGER work_links_touch_updated_at
  BEFORE UPDATE ON public.work_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();