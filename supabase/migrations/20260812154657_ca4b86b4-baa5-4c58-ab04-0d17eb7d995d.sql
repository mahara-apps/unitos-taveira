CREATE TABLE public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  position integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE INDEX task_subtasks_task_id_idx ON public.task_subtasks(task_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_subtasks TO authenticated;
GRANT ALL ON public.task_subtasks TO service_role;
ALTER TABLE public.task_subtasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand members manage task subtasks" ON public.task_subtasks FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
CREATE TRIGGER task_subtasks_touch BEFORE UPDATE ON public.task_subtasks FOR EACH ROW EXECUTE FUNCTION public.brain_touch_updated_at();