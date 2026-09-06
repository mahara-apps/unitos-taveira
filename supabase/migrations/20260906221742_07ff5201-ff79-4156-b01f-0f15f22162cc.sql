-- =========================================================
-- Comunicador interno (Mensagens): equipe, clientes e portal
-- =========================================================

ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'message';

-- ---------- Conversas ----------
CREATE TABLE public.message_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('client', 'team_dm', 'project')),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  subject text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'shared_with_client')),
  created_by uuid,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Coerência estrutural: cada tipo de conversa exige seu vínculo.
  CONSTRAINT message_threads_scope_link CHECK (
    (scope = 'client'   AND client_id IS NOT NULL) OR
    (scope = 'project'  AND project_id IS NOT NULL) OR
    (scope = 'team_dm'  AND client_id IS NULL AND project_id IS NULL)
  ),
  -- Conversa interna nunca é compartilhada com o cliente.
  CONSTRAINT message_threads_visibility_scope CHECK (
    visibility = 'internal' OR scope = 'client'
  )
);

GRANT SELECT, INSERT, UPDATE ON public.message_threads TO authenticated;
GRANT ALL ON public.message_threads TO service_role;

CREATE INDEX message_threads_brand_recent_idx
  ON public.message_threads (brand_id, last_message_at DESC);
CREATE INDEX message_threads_client_recent_idx
  ON public.message_threads (client_id, last_message_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX message_threads_project_idx
  ON public.message_threads (project_id) WHERE project_id IS NOT NULL;

-- ---------- Participantes ----------
CREATE TABLE public.message_thread_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role_in_thread text NOT NULL DEFAULT 'team' CHECK (role_in_thread IN ('team', 'portal_client')),
  notify boolean NOT NULL DEFAULT true,
  last_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_thread_participants TO authenticated;
GRANT ALL ON public.message_thread_participants TO service_role;

CREATE INDEX message_thread_participants_user_idx
  ON public.message_thread_participants (user_id, thread_id);

-- ---------- Mensagens ----------
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  author_kind text NOT NULL DEFAULT 'team' CHECK (author_kind IN ('team', 'portal_client')),
  body text NOT NULL,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  mentions uuid[] NOT NULL DEFAULT '{}'::uuid[],
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

CREATE INDEX messages_thread_created_idx ON public.messages (thread_id, created_at DESC);

-- ---------- Guard de acesso (fail-closed, sem recursão) ----------
CREATE OR REPLACE FUNCTION public.is_message_thread_participant(_thread_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _thread_id IS NOT NULL AND _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.message_thread_participants p
     WHERE p.thread_id = _thread_id AND p.user_id = _user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_message_thread_participant(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.is_message_thread_participant(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_message_thread_participant(uuid, uuid) TO authenticated, service_role;

-- Escopo canônico de uma conversa. Cliente do portal só alcança conversa
-- compartilhada do próprio cliente e na qual foi incluído.
CREATE OR REPLACE FUNCTION public.can_access_message_thread(_thread_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.message_threads;
BEGIN
  IF _thread_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO t FROM public.message_threads WHERE id = _thread_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Contato do portal: só conversa compartilhada, do próprio cliente,
  -- e somente se estiver na lista de participantes.
  IF public.is_portal_client_of(t.client_id, _user_id) THEN
    RETURN t.scope = 'client'
       AND t.visibility = 'shared_with_client'
       AND public.is_message_thread_participant(_thread_id, _user_id);
  END IF;

  -- Equipe: precisa ser membro do workspace.
  IF NOT public.is_brand_member(t.brand_id, _user_id) THEN
    RETURN false;
  END IF;

  IF t.scope = 'client' THEN
    RETURN public.can_access_client(t.client_id, _user_id);
  ELSIF t.scope = 'project' THEN
    RETURN public.can_access_project(t.project_id, _user_id);
  END IF;

  -- Conversa direta: apenas os participantes.
  RETURN public.is_message_thread_participant(_thread_id, _user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_message_thread(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.can_access_message_thread(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_message_thread(uuid, uuid) TO authenticated, service_role;

-- ---------- RLS ----------
ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_thread_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "threads read in scope" ON public.message_threads
FOR SELECT TO authenticated
USING (public.can_access_message_thread(id, auth.uid()));

-- Somente equipe cria conversa, e dentro do próprio escopo.
CREATE POLICY "threads insert by team in scope" ON public.message_threads
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.is_brand_member(brand_id, auth.uid())
  AND (client_id IS NULL OR public.can_access_client(client_id, auth.uid()))
  AND (project_id IS NULL OR public.can_access_project(project_id, auth.uid()))
);

CREATE POLICY "threads update in scope" ON public.message_threads
FOR UPDATE TO authenticated
USING (public.can_access_message_thread(id, auth.uid()) AND public.is_brand_member(brand_id, auth.uid()))
WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

CREATE POLICY "thread participants read in scope" ON public.message_thread_participants
FOR SELECT TO authenticated
USING (public.can_access_message_thread(thread_id, auth.uid()));

-- Só equipe com acesso à conversa gerencia participantes.
CREATE POLICY "thread participants managed by team" ON public.message_thread_participants
FOR INSERT TO authenticated
WITH CHECK (
  public.can_access_message_thread(thread_id, auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.message_threads t
     WHERE t.id = thread_id AND public.is_brand_member(t.brand_id, auth.uid())
  )
);

CREATE POLICY "thread participants delete by team" ON public.message_thread_participants
FOR DELETE TO authenticated
USING (
  public.can_access_message_thread(thread_id, auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.message_threads t
     WHERE t.id = thread_id AND public.is_brand_member(t.brand_id, auth.uid())
  )
);

-- Cada pessoa atualiza a própria marcação de leitura; equipe ajusta a conversa.
CREATE POLICY "thread participants update self or team" ON public.message_thread_participants
FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  OR (
    public.can_access_message_thread(thread_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.message_threads t
       WHERE t.id = thread_id AND public.is_brand_member(t.brand_id, auth.uid())
    )
  )
)
WITH CHECK (public.can_access_message_thread(thread_id, auth.uid()));

CREATE POLICY "messages read in scope" ON public.messages
FOR SELECT TO authenticated
USING (public.can_access_message_thread(thread_id, auth.uid()));

CREATE POLICY "messages insert by participant" ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND public.can_access_message_thread(thread_id, auth.uid())
  AND public.is_message_thread_participant(thread_id, auth.uid())
);

-- Histórico é preservado: só marcar a própria mensagem como removida.
CREATE POLICY "messages soft delete by author" ON public.messages
FOR UPDATE TO authenticated
USING (author_id = auth.uid() AND public.can_access_message_thread(thread_id, auth.uid()))
WITH CHECK (author_id = auth.uid());

-- ---------- Atualização automática da conversa ----------
CREATE OR REPLACE FUNCTION public.bump_message_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.message_threads
     SET last_message_at = NEW.created_at,
         last_message_preview = left(NEW.body, 280),
         updated_at = now()
   WHERE id = NEW.thread_id;

  -- Autor já leu o que acabou de escrever.
  UPDATE public.message_thread_participants
     SET last_read_at = NEW.created_at
   WHERE thread_id = NEW.thread_id AND user_id = NEW.author_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_bump_thread
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.bump_message_thread();

CREATE TRIGGER message_threads_touch_updated_at
BEFORE UPDATE ON public.message_threads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Tempo real ----------
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_threads REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_threads;