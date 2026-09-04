
-- 1. project_jobs
CREATE TABLE public.project_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_jobs TO authenticated;
GRANT ALL ON public.project_jobs TO service_role;
ALTER TABLE public.project_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_jobs brand members" ON public.project_jobs FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
CREATE INDEX project_jobs_project_pos_idx ON public.project_jobs (project_id, position);

-- 2. project_templates
CREATE TABLE public.project_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID REFERENCES public.brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_templates TO authenticated;
GRANT ALL ON public.project_templates TO service_role;
ALTER TABLE public.project_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_templates read visible" ON public.project_templates FOR SELECT TO authenticated
  USING (is_system OR (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid())));
CREATE POLICY "project_templates insert brand" ON public.project_templates FOR INSERT TO authenticated
  WITH CHECK (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid()));
CREATE POLICY "project_templates update brand" ON public.project_templates FOR UPDATE TO authenticated
  USING (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid()));
CREATE POLICY "project_templates delete brand" ON public.project_templates FOR DELETE TO authenticated
  USING (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid()));

-- 3. project_template_jobs
CREATE TABLE public.project_template_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.project_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_template_jobs TO authenticated;
GRANT ALL ON public.project_template_jobs TO service_role;
ALTER TABLE public.project_template_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "template_jobs read" ON public.project_template_jobs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.project_templates t WHERE t.id = template_id
    AND (t.is_system OR (t.brand_id IS NOT NULL AND public.is_brand_member(t.brand_id, auth.uid())))));
CREATE POLICY "template_jobs write" ON public.project_template_jobs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.project_templates t WHERE t.id = template_id
    AND t.brand_id IS NOT NULL AND public.is_brand_member(t.brand_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.project_templates t WHERE t.id = template_id
    AND t.brand_id IS NOT NULL AND public.is_brand_member(t.brand_id, auth.uid())));
CREATE INDEX template_jobs_tpl_pos_idx ON public.project_template_jobs (template_id, position);

-- 4. project_template_tasks
CREATE TABLE public.project_template_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_job_id UUID NOT NULL REFERENCES public.project_template_jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT,
  estimated_minutes INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_template_tasks TO authenticated;
GRANT ALL ON public.project_template_tasks TO service_role;
ALTER TABLE public.project_template_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "template_tasks read" ON public.project_template_tasks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.project_template_jobs j
    JOIN public.project_templates t ON t.id = j.template_id
    WHERE j.id = template_job_id
    AND (t.is_system OR (t.brand_id IS NOT NULL AND public.is_brand_member(t.brand_id, auth.uid())))));
CREATE POLICY "template_tasks write" ON public.project_template_tasks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.project_template_jobs j
    JOIN public.project_templates t ON t.id = j.template_id
    WHERE j.id = template_job_id
    AND t.brand_id IS NOT NULL AND public.is_brand_member(t.brand_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.project_template_jobs j
    JOIN public.project_templates t ON t.id = j.template_id
    WHERE j.id = template_job_id
    AND t.brand_id IS NOT NULL AND public.is_brand_member(t.brand_id, auth.uid())));
CREATE INDEX template_tasks_job_pos_idx ON public.project_template_tasks (template_job_id, position);

-- 5. tasks: add columns
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.project_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS total_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS tasks_project_job_pos_idx ON public.tasks (project_id, job_id, position);

-- 6. task_time_entries
CREATE TABLE public.task_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  minutes INTEGER,
  description TEXT,
  is_rework BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('timer','manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_time_entries TO authenticated;
GRANT ALL ON public.task_time_entries TO service_role;
ALTER TABLE public.task_time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "time_entries brand members read" ON public.task_time_entries FOR SELECT TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()));
CREATE POLICY "time_entries own insert" ON public.task_time_entries FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_brand_member(brand_id, auth.uid()));
CREATE POLICY "time_entries own update" ON public.task_time_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_brand_member(brand_id, auth.uid()));
CREATE POLICY "time_entries own delete" ON public.task_time_entries FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_brand_member(brand_id, auth.uid()));

CREATE UNIQUE INDEX task_time_entries_one_running_per_user
  ON public.task_time_entries (user_id) WHERE ended_at IS NULL;
CREATE INDEX task_time_entries_task_idx ON public.task_time_entries (task_id, started_at DESC);

-- 7. updated_at triggers
CREATE TRIGGER trg_project_jobs_updated BEFORE UPDATE ON public.project_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_project_templates_updated BEFORE UPDATE ON public.project_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_task_time_entries_updated BEFORE UPDATE ON public.task_time_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. refresh totals
CREATE OR REPLACE FUNCTION public.refresh_task_total_minutes(_task_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _total INTEGER;
BEGIN
  SELECT COALESCE(SUM(minutes),0) INTO _total
  FROM public.task_time_entries
  WHERE task_id = _task_id AND ended_at IS NOT NULL AND minutes IS NOT NULL;
  UPDATE public.tasks SET total_minutes = _total, updated_at = now() WHERE id = _task_id;
  RETURN _total;
END; $$;
REVOKE ALL ON FUNCTION public.refresh_task_total_minutes(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_task_total_minutes(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_time_entry_refresh_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_task_total_minutes(OLD.task_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_task_total_minutes(NEW.task_id);
  IF TG_OP = 'UPDATE' AND NEW.task_id <> OLD.task_id THEN
    PERFORM public.refresh_task_total_minutes(OLD.task_id);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_time_entry_totals
AFTER INSERT OR UPDATE OR DELETE ON public.task_time_entries
FOR EACH ROW EXECUTE FUNCTION public.trg_time_entry_refresh_totals();

-- 9. start_timer
CREATE OR REPLACE FUNCTION public.start_timer(_task_id UUID, _brand_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _new_id UUID; _now TIMESTAMPTZ := now();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;
  IF NOT public.is_brand_member(_brand_id, _uid) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE public.task_time_entries
    SET ended_at = _now,
        minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (_now - started_at))/60.0)::INT)
    WHERE user_id = _uid AND ended_at IS NULL;
  INSERT INTO public.task_time_entries (task_id, user_id, brand_id, started_at, source)
    VALUES (_task_id, _uid, _brand_id, _now, 'timer')
    RETURNING id INTO _new_id;
  RETURN _new_id;
END; $$;
REVOKE ALL ON FUNCTION public.start_timer(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_timer(UUID, UUID) TO authenticated;

-- 10. stop_timer
CREATE OR REPLACE FUNCTION public.stop_timer(_entry_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _mins INTEGER; _now TIMESTAMPTZ := now();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;
  UPDATE public.task_time_entries
    SET ended_at = _now,
        minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (_now - started_at))/60.0)::INT)
    WHERE id = _entry_id AND user_id = _uid AND ended_at IS NULL
    RETURNING minutes INTO _mins;
  RETURN COALESCE(_mins, 0);
END; $$;
REVOKE ALL ON FUNCTION public.stop_timer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stop_timer(UUID) TO authenticated;

-- 11. instantiate_project_template
CREATE OR REPLACE FUNCTION public.instantiate_project_template(
  _template_id UUID, _brand_id UUID, _client_id UUID, _project_name TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _new_project UUID; _tpl_visible BOOLEAN;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;
  IF NOT public.is_brand_member(_brand_id, _uid) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT (is_system OR (brand_id IS NOT NULL AND public.is_brand_member(brand_id, _uid)))
    INTO _tpl_visible FROM public.project_templates WHERE id = _template_id;
  IF NOT COALESCE(_tpl_visible, false) THEN RAISE EXCEPTION 'Template not visible'; END IF;

  INSERT INTO public.projects (brand_id, client_id, name, status, owner_id)
    VALUES (_brand_id, _client_id, _project_name, 'active', _uid)
    RETURNING id INTO _new_project;

  WITH job_map AS (
    INSERT INTO public.project_jobs (project_id, brand_id, name, description, color, position)
      SELECT _new_project, _brand_id, tj.name, tj.description, tj.color, tj.position
      FROM public.project_template_jobs tj
      WHERE tj.template_id = _template_id
      RETURNING id, name, position
  ),
  paired AS (
    SELECT jm.id AS new_job_id, tj.id AS tpl_job_id
    FROM public.project_template_jobs tj
    JOIN job_map jm ON jm.name = tj.name AND jm.position = tj.position
    WHERE tj.template_id = _template_id
  )
  INSERT INTO public.tasks (brand_id, client_id, project_id, job_id, title, description, priority, estimated_minutes, position, status, created_by)
    SELECT _brand_id, _client_id, _new_project, p.new_job_id, tt.title, tt.description,
           COALESCE(tt.priority, 'medium')::task_priority,
           tt.estimated_minutes, tt.position, 'todo'::task_status, _uid
    FROM paired p
    JOIN public.project_template_tasks tt ON tt.template_job_id = p.tpl_job_id;

  RETURN _new_project;
END; $$;
REVOKE ALL ON FUNCTION public.instantiate_project_template(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.instantiate_project_template(UUID, UUID, UUID, TEXT) TO authenticated;

-- 12. Seed system template
DO $$
DECLARE _tpl UUID; _job1 UUID; _job2 UUID; _job3 UUID;
BEGIN
  INSERT INTO public.project_templates (brand_id, name, description, icon, is_system)
    VALUES (NULL, 'Modelo Redes Mensal', 'Estrutura padrão para gestão mensal de redes sociais.', 'instagram', true)
    RETURNING id INTO _tpl;
  INSERT INTO public.project_template_jobs (template_id, name, color, position)
    VALUES (_tpl, 'Planejamento', '#8b5cf6', 0) RETURNING id INTO _job1;
  INSERT INTO public.project_template_jobs (template_id, name, color, position)
    VALUES (_tpl, 'Produção', '#3b82f6', 1) RETURNING id INTO _job2;
  INSERT INTO public.project_template_jobs (template_id, name, color, position)
    VALUES (_tpl, 'Publicação & Report', '#10b981', 2) RETURNING id INTO _job3;
  INSERT INTO public.project_template_tasks (template_job_id, title, priority, estimated_minutes, position) VALUES
    (_job1, 'Briefing mensal', 'medium', 60, 0),
    (_job1, 'Definição de temas e datas', 'high', 90, 1),
    (_job2, 'Criação de copies', 'medium', 120, 0),
    (_job2, 'Design de posts', 'high', 240, 1),
    (_job2, 'Revisão interna', 'medium', 60, 2),
    (_job3, 'Aprovação cliente', 'high', 45, 0),
    (_job3, 'Agendamento nas redes', 'medium', 45, 1),
    (_job3, 'Relatório mensal', 'medium', 90, 2);
END $$;
