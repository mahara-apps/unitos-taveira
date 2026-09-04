ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key text;

-- Backfill a dedupe key for the recurring kinds that caused accumulation
UPDATE public.notifications
   SET dedupe_key = 'sla_overdue:' || COALESCE(payload->>'post_id','-')
 WHERE kind = 'sla_overdue' AND dedupe_key IS NULL;

UPDATE public.notifications
   SET dedupe_key = 'sla_overdue_manager:' || COALESCE(brand_id::text,'-')
 WHERE kind = 'sla_overdue_manager' AND dedupe_key IS NULL;

UPDATE public.notifications
   SET dedupe_key = 'deadline:' || COALESCE(payload->>'source','-') || ':' || COALESCE(payload->>'entity_id','-')
 WHERE kind = 'deadline' AND dedupe_key IS NULL;

-- Collapse existing pending duplicates: keep only the most recent unread per key
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id, kind, dedupe_key ORDER BY created_at DESC) AS rn
    FROM public.notifications
   WHERE read_at IS NULL AND dedupe_key IS NOT NULL
)
UPDATE public.notifications n
   SET read_at = now()
  FROM ranked r
 WHERE n.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_unread_dedupe
  ON public.notifications (user_id, kind, dedupe_key)
  WHERE read_at IS NULL AND dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION public.enqueue_deadline_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inserted integer := 0;
  added integer := 0;
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