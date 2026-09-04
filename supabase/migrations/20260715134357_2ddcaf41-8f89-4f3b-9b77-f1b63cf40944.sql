-- =========================================================
-- 1) Fix task mention + assignment triggers (href / enum)
-- =========================================================
CREATE OR REPLACE FUNCTION public.notify_task_mentions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  task_title text;
  task_brand uuid;
BEGIN
  SELECT title, brand_id INTO task_title, task_brand FROM public.tasks WHERE id = NEW.task_id;
  IF NEW.mentions IS NOT NULL THEN
    FOREACH uid IN ARRAY NEW.mentions LOOP
      IF uid <> NEW.author_id THEN
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
END $$;

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
END $$;

-- Reattach triggers idempotently
DROP TRIGGER IF EXISTS task_comments_notify ON public.task_comments;
CREATE TRIGGER task_comments_notify
  AFTER INSERT ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_mentions();

DROP TRIGGER IF EXISTS tasks_notify_assigned ON public.tasks;
CREATE TRIGGER tasks_notify_assigned
  AFTER INSERT OR UPDATE OF assignee_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_assigned();

-- =========================================================
-- 2) Fix portal_decide notifications (href + valid enum)
-- =========================================================
CREATE OR REPLACE FUNCTION public.portal_decide(_token text, _post_id uuid, _decision text, _note text, _identity text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE s record; post_title text; existing_id uuid; now_ts timestamptz := now();
  _kind public.notification_kind;
  _title text;
BEGIN
  IF _decision NOT IN ('approved','rejected','adjust','comment') THEN RAISE EXCEPTION 'bad_decision'; END IF;
  IF _identity IS NULL OR length(trim(_identity)) = 0 THEN RAISE EXCEPTION 'identity_required'; END IF;
  SELECT * INTO s FROM public._portal_session(_token);
  SELECT title INTO post_title FROM public.posts
    WHERE id = _post_id AND brand_id = s.brand_id AND client_id = s.client_id;
  IF post_title IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;

  IF _decision <> 'comment' THEN
    SELECT id INTO existing_id FROM public.post_approvals WHERE post_id = _post_id;
    IF existing_id IS NOT NULL THEN
      UPDATE public.post_approvals SET
        status = _decision::approval_status,
        notes = _note, decided_at = now_ts, decided_by_name = _identity
      WHERE id = existing_id;
    ELSE
      INSERT INTO public.post_approvals(post_id, status, notes, decided_at, decided_by_name)
      VALUES (_post_id, _decision::approval_status, _note, now_ts, _identity);
    END IF;
    IF _decision = 'approved' THEN
      UPDATE public.posts SET approved_at = now_ts, review_status = 'approved' WHERE id = _post_id;
    END IF;
  END IF;

  INSERT INTO public.activity_events(brand_id, client_id, entity_type, entity_id, verb, payload)
  VALUES (s.brand_id, s.client_id, 'post', _post_id, 'portal_' || _decision,
          jsonb_build_object('note', COALESCE(_note,''), 'by', _identity, 'title', post_title));

  _kind := CASE WHEN _decision = 'comment' THEN 'mention'::public.notification_kind ELSE 'approval_decision'::public.notification_kind END;
  _title := CASE _decision
      WHEN 'approved' THEN 'Cliente aprovou um post'
      WHEN 'rejected' THEN 'Cliente rejeitou um post'
      WHEN 'adjust'   THEN 'Cliente pediu ajustes'
      ELSE 'Cliente comentou um post'
    END;

  INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
  SELECT m.user_id, s.brand_id, _kind, _title,
         _identity || ': ' || COALESCE(post_title, 'post'),
         '/customers/' || s.client_id::text,
         jsonb_build_object('source','portal_decision','post_id', _post_id, 'decision', _decision, 'by', _identity)
    FROM public.brand_members m WHERE m.brand_id = s.brand_id;

  RETURN jsonb_build_object('ok', true);
END $function$;

-- =========================================================
-- 3) Post approval requested / decision triggers
-- =========================================================
CREATE OR REPLACE FUNCTION public.notify_post_approval_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
BEGIN
  -- Approval requested: post moves into 'approval' stage
  IF TG_OP = 'UPDATE'
     AND NEW.stage = 'approval'::public.post_stage
     AND OLD.stage IS DISTINCT FROM NEW.stage THEN
    -- Notify every brand member (approvers pool). Skip actor to avoid self-notify.
    INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
    SELECT m.user_id, NEW.brand_id, 'approval_requested',
           'Post aguardando aprovação',
           NEW.title,
           '/customers/' || COALESCE(NEW.client_id::text, '') || '?post=' || NEW.id::text,
           jsonb_build_object('source','post','post_id', NEW.id)
      FROM public.brand_members m
     WHERE m.brand_id = NEW.brand_id
       AND m.user_id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
  END IF;

  -- Approval decision: approved / rejected stage transitions
  IF TG_OP = 'UPDATE'
     AND OLD.stage IS DISTINCT FROM NEW.stage
     AND NEW.stage IN ('approved'::public.post_stage, 'rejected'::public.post_stage) THEN
    target := COALESCE(NEW.assignee_id, NEW.created_by);
    IF target IS NOT NULL AND target <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
      VALUES (
        target, NEW.brand_id, 'approval_decision',
        CASE WHEN NEW.stage = 'approved'::public.post_stage
             THEN 'Post aprovado'
             ELSE 'Post rejeitado' END,
        NEW.title,
        '/customers/' || COALESCE(NEW.client_id::text, '') || '?post=' || NEW.id::text,
        jsonb_build_object('source','post','post_id', NEW.id, 'stage', NEW.stage)
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS posts_notify_approval ON public.posts;
CREATE TRIGGER posts_notify_approval
  AFTER UPDATE OF stage ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.notify_post_approval_events();

-- =========================================================
-- 4) AI job completion trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.notify_ai_job_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IN ('completed','failed')
     AND COALESCE(OLD.status, '') <> NEW.status
     AND NEW.user_id IS NOT NULL THEN
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
END $$;

DROP TRIGGER IF EXISTS ai_jobs_notify_completed ON public.ai_jobs;
CREATE TRIGGER ai_jobs_notify_completed
  AFTER UPDATE OF status ON public.ai_jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_ai_job_completed();

-- =========================================================
-- 5) Deadline notifications (24h window) with dedup
-- =========================================================
CREATE OR REPLACE FUNCTION public.enqueue_deadline_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted integer := 0;
BEGIN
  -- Tasks with due_at in the next 24h, not done, with assignee
  WITH candidates AS (
    SELECT t.id AS entity_id, t.brand_id, t.assignee_id AS user_id, t.title, t.due_at
      FROM public.tasks t
     WHERE t.assignee_id IS NOT NULL
       AND t.done = false
       AND t.due_at IS NOT NULL
       AND t.due_at > now()
       AND t.due_at <= now() + interval '24 hours'
  ),
  filtered AS (
    SELECT c.* FROM candidates c
     WHERE NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = c.user_id
          AND n.kind = 'deadline'
          AND n.payload->>'source' = 'task'
          AND n.payload->>'entity_id' = c.entity_id::text
          AND n.created_at > now() - interval '20 hours'
     )
  ),
  ins AS (
    INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
    SELECT user_id, brand_id, 'deadline',
           'Tarefa vence em breve',
           title,
           '/tasks?task=' || entity_id::text,
           jsonb_build_object('source','task','entity_id', entity_id, 'due_at', due_at)
      FROM filtered
    RETURNING 1
  )
  SELECT COALESCE(count(*),0) INTO inserted FROM ins;

  -- Posts scheduled in next 24h, with assignee, not published
  WITH candidates AS (
    SELECT p.id AS entity_id, p.brand_id, p.client_id, p.assignee_id AS user_id, p.title, p.scheduled_at
      FROM public.posts p
     WHERE p.assignee_id IS NOT NULL
       AND p.scheduled_at IS NOT NULL
       AND p.scheduled_at > now()
       AND p.scheduled_at <= now() + interval '24 hours'
       AND p.stage <> 'published'::public.post_stage
       AND p.deleted_at IS NULL
  ),
  filtered AS (
    SELECT c.* FROM candidates c
     WHERE NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = c.user_id
          AND n.kind = 'deadline'
          AND n.payload->>'source' = 'post'
          AND n.payload->>'entity_id' = c.entity_id::text
          AND n.created_at > now() - interval '20 hours'
     )
  ),
  ins AS (
    INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
    SELECT user_id, brand_id, 'deadline',
           'Publicação agendada em breve',
           title,
           '/customers/' || COALESCE(client_id::text,'') || '?post=' || entity_id::text,
           jsonb_build_object('source','post','entity_id', entity_id, 'scheduled_at', scheduled_at)
      FROM filtered
    RETURNING 1
  )
  SELECT inserted + COALESCE(count(*),0) INTO inserted FROM ins;

  RETURN inserted;
END $$;

-- Schedule via pg_cron every 30 minutes (idempotent)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('deadline-notifications')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deadline-notifications');
    PERFORM cron.schedule(
      'deadline-notifications',
      '*/30 * * * *',
      $$SELECT public.enqueue_deadline_notifications();$$
    );
  END IF;
END
$cron$;