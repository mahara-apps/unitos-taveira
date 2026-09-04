-- =====================================================================
-- FASE 5 — Herança de escopo em funções SECURITY DEFINER de escrita
-- =====================================================================

-- 1) Template -> Projeto: cliente precisa pertencer ao workspace E estar no escopo do ator.
CREATE OR REPLACE FUNCTION public.instantiate_project_template(
  _template_id uuid, _brand_id uuid, _client_id uuid, _project_name text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid UUID := auth.uid(); _new_project UUID; _tpl_visible BOOLEAN;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;
  IF NOT public.is_brand_member(_brand_id, _uid) AND NOT public.is_super_admin(_uid) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _client_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.brand_id = _brand_id
    ) THEN
      RAISE EXCEPTION 'client_out_of_workspace';
    END IF;
    IF NOT public.can_access_client(_client_id, _uid) THEN
      RAISE EXCEPTION 'client_out_of_scope';
    END IF;
  END IF;

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
END; $function$;

-- 2) Cronômetro: herda escopo da tarefa.
CREATE OR REPLACE FUNCTION public.start_timer(_task_id uuid, _brand_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID := auth.uid();
  _new_id UUID;
  _now TIMESTAMPTZ := now();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;
  IF NOT public.is_brand_member(_brand_id, _uid) AND NOT public.is_super_admin(_uid) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = _task_id AND t.brand_id = _brand_id) THEN
    RAISE EXCEPTION 'task_out_of_workspace';
  END IF;
  IF NOT public.can_access_task(_task_id, _uid) THEN
    RAISE EXCEPTION 'task_out_of_scope';
  END IF;

  UPDATE public.task_time_entries
  SET ended_at = _now,
      seconds = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (_now - started_at)))::INT),
      minutes = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (_now - started_at)) / 60.0)::INT),
      ended_reason = 'auto'
  WHERE user_id = _uid AND ended_at IS NULL;

  INSERT INTO public.task_time_entries (task_id, user_id, brand_id, started_at, source)
  VALUES (_task_id, _uid, _brand_id, _now, 'timer')
  RETURNING id INTO _new_id;

  RETURN _new_id;
END; $function$;

-- 3) brain_memory_evolve: exposta a authenticated; exige escopo de workspace/cliente.
CREATE OR REPLACE FUNCTION public.brain_memory_guard_scope(_brand_id uuid, _client_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- service_role (workers) não tem auth.uid(): mantém acesso irrestrito.
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF public.is_super_admin(auth.uid()) THEN RETURN; END IF;
  IF _brand_id IS NULL OR NOT public.is_brand_member(_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _client_id IS NOT NULL AND NOT public.can_access_client(_client_id, auth.uid()) THEN
    RAISE EXCEPTION 'client_out_of_scope' USING ERRCODE = '42501';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.brain_memory_guard_scope(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brain_memory_guard_scope(uuid, uuid) TO authenticated, service_role;

-- 4) Orçamento de IA: exige membro do workspace consultado.
CREATE OR REPLACE FUNCTION public.check_ai_usage_budget(_brand_id uuid, _client_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  period_start timestamptz := date_trunc('month', now());
  brand_lim   record;
  client_lim  record;
  user_lim    record;
  brand_spent numeric := 0;
  client_spent numeric := 0;
  user_spent  numeric := 0;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_super_admin(auth.uid())
     AND NOT public.is_brand_member(_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO brand_lim FROM public.ai_usage_limits
   WHERE brand_id = _brand_id AND scope = 'brand' LIMIT 1;
  IF _client_id IS NOT NULL THEN
    SELECT * INTO client_lim FROM public.ai_usage_limits
     WHERE brand_id = _brand_id AND scope = 'client' AND client_id = _client_id LIMIT 1;
  END IF;
  IF _user_id IS NOT NULL THEN
    SELECT * INTO user_lim FROM public.ai_usage_limits
     WHERE brand_id = _brand_id AND scope = 'user' AND user_id = _user_id
       AND (client_id IS NULL OR client_id = _client_id)
     ORDER BY (client_id IS NOT NULL) DESC LIMIT 1;
  END IF;

  SELECT COALESCE(SUM(cost_usd),0) INTO brand_spent FROM public.brand_ai_usage
    WHERE brand_id = _brand_id AND created_at >= period_start;
  IF _client_id IS NOT NULL THEN
    SELECT COALESCE(SUM(cost_usd),0) INTO client_spent FROM public.brand_ai_usage
      WHERE brand_id = _brand_id AND client_id = _client_id AND created_at >= period_start;
  END IF;
  IF _user_id IS NOT NULL THEN
    SELECT COALESCE(SUM(cost_usd),0) INTO user_spent FROM public.brand_ai_usage
      WHERE brand_id = _brand_id AND actor_id = _user_id AND created_at >= period_start;
  END IF;

  IF user_lim.id IS NOT NULL AND user_lim.hard_stop AND user_spent >= user_lim.limit_usd THEN
    RETURN jsonb_build_object('allowed', false, 'blocked_by','user',
      'spent_usd', user_spent, 'limit_usd', user_lim.limit_usd);
  END IF;
  IF client_lim.id IS NOT NULL AND client_lim.hard_stop AND client_spent >= client_lim.limit_usd THEN
    RETURN jsonb_build_object('allowed', false, 'blocked_by','client',
      'spent_usd', client_spent, 'limit_usd', client_lim.limit_usd);
  END IF;
  IF brand_lim.id IS NOT NULL AND brand_lim.hard_stop AND brand_spent >= brand_lim.limit_usd THEN
    RETURN jsonb_build_object('allowed', false, 'blocked_by','brand',
      'spent_usd', brand_spent, 'limit_usd', brand_lim.limit_usd);
  END IF;

  RETURN jsonb_build_object('allowed', true,
    'brand', jsonb_build_object('spent', brand_spent, 'limit', brand_lim.limit_usd),
    'client', jsonb_build_object('spent', client_spent, 'limit', client_lim.limit_usd),
    'user', jsonb_build_object('spent', user_spent, 'limit', user_lim.limit_usd));
END; $function$;
