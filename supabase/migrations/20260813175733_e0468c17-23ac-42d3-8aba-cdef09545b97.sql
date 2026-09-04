ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS tasks_post_id_idx ON public.tasks(post_id);

CREATE UNIQUE INDEX IF NOT EXISTS tasks_post_production_unique
  ON public.tasks(post_id)
  WHERE post_id IS NOT NULL;