ALTER TABLE public.content_pipeline_stages
  ADD COLUMN IF NOT EXISTS sla_days integer;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS remind_at timestamptz,
  ADD COLUMN IF NOT EXISTS recurrence jsonb,
  ADD COLUMN IF NOT EXISTS assignees uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE INDEX IF NOT EXISTS posts_project_id_idx ON public.posts(project_id);
CREATE INDEX IF NOT EXISTS posts_remind_at_idx ON public.posts(remind_at) WHERE remind_at IS NOT NULL;