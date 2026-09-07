-- Não lidas por conversa (só conversas em que a pessoa participa e pode ver).
CREATE OR REPLACE FUNCTION public.message_unread_counts(_brand_id uuid)
RETURNS TABLE(thread_id uuid, unread integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.thread_id,
         COUNT(m.id)::int AS unread
    FROM public.message_thread_participants p
    JOIN public.message_threads t ON t.id = p.thread_id
    LEFT JOIN public.messages m
           ON m.thread_id = p.thread_id
          AND m.author_id <> p.user_id
          AND m.removed_at IS NULL
          AND m.created_at > COALESCE(p.last_read_at, 'epoch'::timestamptz)
   WHERE p.user_id = auth.uid()
     AND (_brand_id IS NULL OR t.brand_id = _brand_id)
     AND t.archived_at IS NULL
     AND public.can_access_message_thread(p.thread_id, auth.uid())
   GROUP BY p.thread_id;
$$;

REVOKE ALL ON FUNCTION public.message_unread_counts(uuid) FROM public;
REVOKE ALL ON FUNCTION public.message_unread_counts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.message_unread_counts(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.message_unread_total(_brand_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(unread), 0)::int FROM public.message_unread_counts(_brand_id);
$$;

REVOKE ALL ON FUNCTION public.message_unread_total(uuid) FROM public;
REVOKE ALL ON FUNCTION public.message_unread_total(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.message_unread_total(uuid) TO authenticated, service_role;