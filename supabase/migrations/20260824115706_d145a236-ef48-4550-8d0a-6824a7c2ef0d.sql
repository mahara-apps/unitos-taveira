-- ============================================================
-- Fase 1 RBAC — herança de escopo (workspace → cliente → projeto → tarefa)
-- ============================================================

-- Função canônica de acesso a projeto (consolida a lógica inline das policies).
CREATE OR REPLACE FUNCTION public.can_access_project(_project_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = _project_id
       AND public.is_brand_member(p.brand_id, _user_id)
       AND (p.client_id IS NULL OR public.can_access_client(p.client_id, _user_id))
  );
$function$;

COMMENT ON FUNCTION public.can_access_project(uuid, uuid) IS
  'Escopo canônico de projeto: membro do workspace E (projeto sem cliente OU cliente no escopo do usuário).';

-- Tarefa: herda do projeto quando existir, senão do cliente/workspace.
CREATE OR REPLACE FUNCTION public.can_access_task(_task_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
     WHERE t.id = _task_id
       AND public.is_brand_member(t.brand_id, _user_id)
       AND (t.client_id IS NULL OR public.can_access_client(t.client_id, _user_id))
       AND (t.project_id IS NULL OR public.can_access_project(t.project_id, _user_id))
  );
$function$;

COMMENT ON FUNCTION public.is_agency_operator(uuid, uuid) IS
  'Operador interno do workspace (super_admin/admin/manager/user) — NÃO é verificação de autoridade administrativa nem de escopo de cliente.';

-- ------------------------------------------------------------
-- task_comments — herda da tarefa
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "brand members manage task comments" ON public.task_comments;
CREATE POLICY "task comments via parent task"
  ON public.task_comments FOR ALL TO authenticated
  USING (public.can_access_task(task_id, auth.uid()))
  WITH CHECK (public.can_access_task(task_id, auth.uid()));

-- ------------------------------------------------------------
-- task_time_entries — herda da tarefa (mantendo escrita apenas do próprio dono)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "time_entries brand members read" ON public.task_time_entries;
DROP POLICY IF EXISTS "time_entries own insert" ON public.task_time_entries;
DROP POLICY IF EXISTS "time_entries own update" ON public.task_time_entries;
DROP POLICY IF EXISTS "time_entries own delete" ON public.task_time_entries;

CREATE POLICY "time_entries read via parent task"
  ON public.task_time_entries FOR SELECT TO authenticated
  USING (public.can_access_task(task_id, auth.uid()));

CREATE POLICY "time_entries own insert via parent task"
  ON public.task_time_entries FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_access_task(task_id, auth.uid()));

CREATE POLICY "time_entries own update via parent task"
  ON public.task_time_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.can_access_task(task_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.can_access_task(task_id, auth.uid()));

CREATE POLICY "time_entries own delete via parent task"
  ON public.task_time_entries FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.can_access_task(task_id, auth.uid()));

-- ------------------------------------------------------------
-- monthly_plan_topics — herda do plano mensal (cliente)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Brand members can read monthly_plan_topics" ON public.monthly_plan_topics;
DROP POLICY IF EXISTS "topics insert agency only" ON public.monthly_plan_topics;
DROP POLICY IF EXISTS "topics update agency only" ON public.monthly_plan_topics;
DROP POLICY IF EXISTS "topics delete agency only" ON public.monthly_plan_topics;

CREATE POLICY "topics read in scope"
  ON public.monthly_plan_topics FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
     WHERE mp.id = monthly_plan_topics.monthly_plan_id
       AND (public.can_access_client(mp.client_id, auth.uid())
            OR public.is_portal_client_of(mp.client_id, auth.uid()))
  ));

CREATE POLICY "topics insert in scope"
  ON public.monthly_plan_topics FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
     WHERE mp.id = monthly_plan_topics.monthly_plan_id
       AND public.can_access_client(mp.client_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), mp.brand_id)
  ));

CREATE POLICY "topics update in scope"
  ON public.monthly_plan_topics FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
     WHERE mp.id = monthly_plan_topics.monthly_plan_id
       AND public.can_access_client(mp.client_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), mp.brand_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
     WHERE mp.id = monthly_plan_topics.monthly_plan_id
       AND public.can_access_client(mp.client_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), mp.brand_id)
  ));

CREATE POLICY "topics delete in scope"
  ON public.monthly_plan_topics FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
     WHERE mp.id = monthly_plan_topics.monthly_plan_id
       AND public.can_access_client(mp.client_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), mp.brand_id)
  ));

-- ------------------------------------------------------------
-- project_jobs — herda do projeto
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "project_jobs brand members" ON public.project_jobs;
CREATE POLICY "project_jobs via parent project"
  ON public.project_jobs FOR ALL TO authenticated
  USING (public.can_access_project(project_id, auth.uid()))
  WITH CHECK (public.can_access_project(project_id, auth.uid()));

-- ------------------------------------------------------------
-- card_approval_tokens / card_approval_events — herdam da peça (cliente)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "brand members manage approval tokens" ON public.card_approval_tokens;
CREATE POLICY "approval tokens in client scope"
  ON public.card_approval_tokens FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.posts p
     WHERE p.id = card_approval_tokens.post_id
       AND public.can_access_client(p.client_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), p.brand_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.posts p
     WHERE p.id = card_approval_tokens.post_id
       AND public.can_access_client(p.client_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), p.brand_id)
  ));

DROP POLICY IF EXISTS "brand members read approval events" ON public.card_approval_events;
CREATE POLICY "approval events in client scope"
  ON public.card_approval_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.posts p
     WHERE p.id = card_approval_events.post_id
       AND public.can_access_client(p.client_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), p.brand_id)
  ));

-- ------------------------------------------------------------
-- Cérebro — embeddings / versões / fila herdam o cliente de origem
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "brain_embeddings select by brand or super admin" ON public.brain_embeddings;
CREATE POLICY "brain_embeddings select in scope"
  ON public.brain_embeddings FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brain_events e
       WHERE e.id = brain_embeddings.event_id
         AND public.client_in_scope(e.client_id, e.brand_id)
    )
  );

DROP POLICY IF EXISTS "brain_memory_versions select by brand" ON public.brain_memory_versions;
CREATE POLICY "brain_memory_versions select in scope"
  ON public.brain_memory_versions FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brain_memory m
       WHERE m.id = brain_memory_versions.memory_id
         AND public.client_in_scope(m.client_id, m.brand_id)
    )
  );

DROP POLICY IF EXISTS "Members read queue for their brands" ON public.brain_learning_queue;
CREATE POLICY "brain_learning_queue read in scope"
  ON public.brain_learning_queue FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brain_events e
       WHERE e.id = brain_learning_queue.event_id
         AND public.client_in_scope(e.client_id, e.brand_id)
    )
  );