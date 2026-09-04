ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS start_date timestamptz,
  ADD COLUMN IF NOT EXISTS goals text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='archived' AND enumtypid='project_status'::regtype) THEN
    ALTER TYPE public.project_status ADD VALUE 'archived';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();