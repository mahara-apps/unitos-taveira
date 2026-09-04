-- Arquivamento reversível de tarefas (sem DELETE) + integridade tarefa->projeto->cliente
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tasks_brand_archived
  ON public.tasks (brand_id, archived_at);

CREATE OR REPLACE FUNCTION public.enforce_task_project_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  proj_brand uuid;
  proj_client uuid;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT brand_id, client_id INTO proj_brand, proj_client
  FROM public.projects WHERE id = NEW.project_id;

  IF proj_brand IS NULL THEN
    RAISE EXCEPTION 'Projeto inexistente';
  END IF;

  IF proj_brand <> NEW.brand_id THEN
    RAISE EXCEPTION 'O projeto pertence a outra workspace';
  END IF;

  IF proj_client IS NOT NULL AND NEW.client_id IS DISTINCT FROM proj_client THEN
    RAISE EXCEPTION 'O projeto pertence a outro cliente';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_task_project_client ON public.tasks;
CREATE TRIGGER trg_enforce_task_project_client
  BEFORE INSERT OR UPDATE OF project_id, client_id, brand_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_task_project_client();