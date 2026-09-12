CREATE OR REPLACE FUNCTION public.clean_mention_tokens(_body text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT regexp_replace(
    coalesce(_body, ''),
    '@\[([^]\n]+)\]\([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\)',
    '@\1',
    'g'
  )
$$;

REVOKE ALL ON FUNCTION public.clean_mention_tokens(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clean_mention_tokens(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sanitize_mention_body()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.body := public.clean_mention_tokens(NEW.body);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_sanitize_mentions ON public.messages;
CREATE TRIGGER messages_sanitize_mentions
BEFORE INSERT OR UPDATE OF body ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.sanitize_mention_body();

DROP TRIGGER IF EXISTS task_comments_sanitize_mentions ON public.task_comments;
CREATE TRIGGER task_comments_sanitize_mentions
BEFORE INSERT OR UPDATE OF body ON public.task_comments
FOR EACH ROW EXECUTE FUNCTION public.sanitize_mention_body();

DROP TRIGGER IF EXISTS work_comments_sanitize_mentions ON public.work_comments;
CREATE TRIGGER work_comments_sanitize_mentions
BEFORE INSERT OR UPDATE OF body ON public.work_comments
FOR EACH ROW EXECUTE FUNCTION public.sanitize_mention_body();

CREATE OR REPLACE FUNCTION public.bump_message_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.message_threads
     SET last_message_at = NEW.created_at,
         last_message_preview = left(public.clean_mention_tokens(NEW.body), 280),
         updated_at = now()
   WHERE id = NEW.thread_id;

  UPDATE public.message_thread_participants
     SET last_read_at = NEW.created_at
   WHERE thread_id = NEW.thread_id AND user_id = NEW.author_id;

  RETURN NEW;
END;
$$;