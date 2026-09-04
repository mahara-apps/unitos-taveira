-- 1) Canonical pref gate ------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_pref_for_kind(_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _kind
    WHEN 'mention' THEN 'comments'
    WHEN 'assignment' THEN 'assignments'
    WHEN 'approval_requested' THEN 'approvals'
    WHEN 'approval_decision' THEN 'approvals'
    WHEN 'deadline' THEN 'deadlines'
    WHEN 'system' THEN 'ai_jobs'
    ELSE NULL   -- kinds críticos: sla_overdue, sla_overdue_manager, briefing_submitted
  END
$$;

CREATE OR REPLACE FUNCTION public.notification_prefs_allows(_user_id uuid, _kind text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.notification_pref_for_kind(_kind) IS NULL THEN true
    ELSE COALESCE(
      (SELECT (up.notification_prefs -> public.notification_pref_for_kind(_kind))::text
         FROM public.user_profiles up WHERE up.id = _user_id) <> 'false',
      true)
  END
$$;

REVOKE ALL ON FUNCTION public.notification_prefs_allows(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.notification_prefs_allows(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notification_pref_for_kind(text) TO authenticated, service_role;

-- 2) Normaliza prefs existentes para o formato real --------------------
UPDATE public.user_profiles up
   SET notification_prefs = jsonb_build_object(
     'comments',    COALESCE((up.notification_prefs->>'comments')::boolean, true),
     'assignments', COALESCE((up.notification_prefs->>'assignments')::boolean, true),
     'approvals',   COALESCE((up.notification_prefs->>'approvals')::boolean, true),
     'deadlines',   COALESCE((up.notification_prefs->>'deadlines')::boolean, true),
     'ai_jobs',     COALESCE((up.notification_prefs->>'ai_jobs')::boolean, true)
   );

ALTER TABLE public.user_profiles
  ALTER COLUMN notification_prefs SET DEFAULT
  '{"comments":true,"assignments":true,"approvals":true,"deadlines":true,"ai_jobs":true}'::jsonb;

-- 3) Emissores respeitam as preferências ------------------------------
CREATE OR REPLACE FUNCTION public.notify_task_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.assignee_id IS NOT NULL
     AND NEW.assignee_id <> COALESCE(OLD.assignee_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND NEW.assignee_id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
     AND public.notification_prefs_allows(NEW.assignee_id, 'assignment')
  THEN
    INSERT INTO public.notifications (user_id, brand_id, kind, title, body, href, payload)
    VALUES (
      NEW.assignee_id, NEW.brand_id, 'assignment',
      'Nova tarefa atribuída',
      NEW.title,
      '/tasks?task=' || NEW.id::text,
      jsonb_build_object('source', 'task', 'task_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.notify_task_mentions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  uid uuid;
  task_title text;
  task_brand uuid;
BEGIN
  SELECT title, brand_id INTO task_title, task_brand FROM public.tasks WHERE id = NEW.task_id;
  IF NEW.mentions IS NOT NULL THEN
    FOREACH uid IN ARRAY NEW.mentions LOOP
      IF uid <> NEW.author_id AND public.notification_prefs_allows(uid, 'mention') THEN
        INSERT INTO public.notifications (user_id, brand_id, kind, title, body, href, payload)
        VALUES (
          uid, COALESCE(task_brand, NEW.brand_id), 'mention',
          'Você foi mencionado',
          coalesce(task_title, 'Tarefa') || ': ' || left(NEW.body, 140),
          '/tasks?task=' || NEW.task_id::text,
          jsonb_build_object('source', 'task_comment', 'task_id', NEW.task_id, 'comment_id', NEW.id)
        );
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.notify_ai_job_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IN ('completed','failed')
     AND COALESCE(OLD.status, '') <> NEW.status
     AND NEW.user_id IS NOT NULL
     AND public.notification_prefs_allows(NEW.user_id, 'system') THEN
    INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
    VALUES (
      NEW.user_id, NEW.brand_id, 'system',
      CASE WHEN NEW.status = 'completed'
           THEN COALESCE(NEW.title, 'Job de IA') || ' concluído'
           ELSE COALESCE(NEW.title, 'Job de IA') || ' falhou' END,
      COALESCE(NEW.subtitle, NEW.error, NULL),
      NEW.target_route,
      jsonb_build_object('source','ai_job','job_id', NEW.id, 'status', NEW.status, 'kind', NEW.kind)
    );
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.notify_post_approval_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  target uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.stage = 'review'::public.post_stage
     AND OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
    SELECT m.user_id, NEW.brand_id, 'approval_requested',
           'Post aguardando aprovação',
           NEW.title,
           '/customers/' || COALESCE(NEW.client_id::text, '') || '?post=' || NEW.id::text,
           jsonb_build_object('source','post','post_id', NEW.id)
      FROM public.brand_members m
     WHERE m.brand_id = NEW.brand_id
       AND m.user_id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
       AND public.notification_prefs_allows(m.user_id, 'approval_requested');
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.stage IS DISTINCT FROM NEW.stage
     AND NEW.stage = 'approved'::public.post_stage THEN
    target := COALESCE(NEW.assignee_id, NEW.created_by);
    IF target IS NOT NULL
       AND target <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
       AND public.notification_prefs_allows(target, 'approval_decision') THEN
      INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
      VALUES (
        target, NEW.brand_id, 'approval_decision',
        'Post aprovado',
        NEW.title,
        '/customers/' || COALESCE(NEW.client_id::text, '') || '?post=' || NEW.id::text,
        jsonb_build_object('source','post','post_id', NEW.id, 'stage', NEW.stage)
      );
    END IF;
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.enqueue_deadline_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  inserted integer := 0;
  added integer := 0;
BEGIN
  WITH candidates AS (
    SELECT t.id AS entity_id, t.brand_id, t.assignee_id AS user_id, t.title, t.due_at
      FROM public.tasks t
     WHERE t.assignee_id IS NOT NULL
       AND t.done = false
       AND t.due_at IS NOT NULL
       AND t.due_at > now()
       AND t.due_at <= now() + interval '24 hours'
       AND public.notification_prefs_allows(t.assignee_id, 'deadline')
  ),
  filtered AS (
    SELECT c.* FROM candidates c
     WHERE NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = c.user_id
          AND n.kind = 'deadline'
          AND n.dedupe_key = 'deadline:task:' || c.entity_id::text
          AND (n.read_at IS NULL OR n.created_at > now() - interval '20 hours')
     )
  ),
  ins AS (
    INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload, dedupe_key)
    SELECT user_id, brand_id, 'deadline',
           'Tarefa vence em breve',
           title,
           '/tasks?task=' || entity_id::text,
           jsonb_build_object('source','task','entity_id', entity_id, 'due_at', due_at),
           'deadline:task:' || entity_id::text
      FROM filtered
    ON CONFLICT (user_id, kind, dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT COALESCE(count(*),0) INTO inserted FROM ins;

  WITH candidates AS (
    SELECT p.id AS entity_id, p.brand_id, p.client_id, p.assignee_id AS user_id, p.title, p.scheduled_at
      FROM public.posts p
     WHERE p.assignee_id IS NOT NULL
       AND p.scheduled_at IS NOT NULL
       AND p.scheduled_at > now()
       AND p.scheduled_at <= now() + interval '24 hours'
       AND p.stage <> 'published'::public.post_stage
       AND p.deleted_at IS NULL
       AND public.notification_prefs_allows(p.assignee_id, 'deadline')
  ),
  filtered AS (
    SELECT c.* FROM candidates c
     WHERE NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = c.user_id
          AND n.kind = 'deadline'
          AND n.dedupe_key = 'deadline:post:' || c.entity_id::text
          AND (n.read_at IS NULL OR n.created_at > now() - interval '20 hours')
     )
  ),
  ins AS (
    INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload, dedupe_key)
    SELECT user_id, brand_id, 'deadline',
           'Publicação agendada em breve',
           title,
           '/customers/' || COALESCE(client_id::text,'') || '?post=' || entity_id::text,
           jsonb_build_object('source','post','entity_id', entity_id, 'scheduled_at', scheduled_at),
           'deadline:post:' || entity_id::text
      FROM filtered
    ON CONFLICT (user_id, kind, dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT COALESCE(count(*),0) INTO added FROM ins;

  RETURN inserted + added;
END $function$;