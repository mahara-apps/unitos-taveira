
-- Comments/discussion thread on tasks with @mentions
CREATE TABLE public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand members manage task comments"
  ON public.task_comments
  FOR ALL
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

CREATE INDEX task_comments_task_idx ON public.task_comments(task_id, created_at DESC);

CREATE TRIGGER task_comments_updated_at
  BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Notify mentioned users
CREATE OR REPLACE FUNCTION public.notify_task_mentions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  task_title text;
BEGIN
  SELECT title INTO task_title FROM public.tasks WHERE id = NEW.task_id;
  IF NEW.mentions IS NOT NULL THEN
    FOREACH uid IN ARRAY NEW.mentions LOOP
      IF uid <> NEW.author_id THEN
        INSERT INTO public.notifications (user_id, brand_id, kind, title, body, url)
        VALUES (
          uid, NEW.brand_id, 'mention',
          'Você foi mencionado',
          coalesce(task_title, 'Tarefa') || ': ' || left(NEW.body, 140),
          '/tasks?task=' || NEW.task_id::text
        );
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER task_comments_notify
  AFTER INSERT ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_mentions();

-- Notify assignee when task is (re)assigned
CREATE OR REPLACE FUNCTION public.notify_task_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assignee_id IS NOT NULL
     AND NEW.assignee_id <> COALESCE(OLD.assignee_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND NEW.assignee_id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  THEN
    INSERT INTO public.notifications (user_id, brand_id, kind, title, body, url)
    VALUES (
      NEW.assignee_id, NEW.brand_id, 'task_assigned',
      'Nova tarefa atribuída',
      NEW.title,
      '/tasks?task=' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tasks_notify_assigned
  AFTER INSERT OR UPDATE OF assignee_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_assigned();
