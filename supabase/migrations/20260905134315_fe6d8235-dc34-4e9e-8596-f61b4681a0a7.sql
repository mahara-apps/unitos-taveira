-- =========================================================
-- Portal do cliente: pedidos, conversa de aprovação, prazos
-- =========================================================

CREATE TABLE IF NOT EXISTS public.client_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  desired_due_at timestamptz,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','info_needed','accepted','in_production','done','rejected','cancelled')),
  owner_user_id uuid,
  created_by uuid,
  created_by_name text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_requests_client_idx ON public.client_requests (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_requests_brand_idx ON public.client_requests (brand_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_requests TO authenticated;
GRANT ALL ON public.client_requests TO service_role;
ALTER TABLE public.client_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_requests_select" ON public.client_requests;
CREATE POLICY "client_requests_select" ON public.client_requests
  FOR SELECT TO authenticated
  USING (
    public.is_portal_client_of(client_id, auth.uid())
    OR public.can_access_client(client_id, auth.uid())
  );

DROP POLICY IF EXISTS "client_requests_insert" ON public.client_requests;
CREATE POLICY "client_requests_insert" ON public.client_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_portal_client_of(client_id, auth.uid())
    OR public.can_access_client(client_id, auth.uid())
  );

DROP POLICY IF EXISTS "client_requests_update" ON public.client_requests;
CREATE POLICY "client_requests_update" ON public.client_requests
  FOR UPDATE TO authenticated
  USING (
    public.can_access_client(client_id, auth.uid())
    OR (
      public.is_portal_client_of(client_id, auth.uid())
      AND created_by = auth.uid()
      AND status IN ('submitted','info_needed')
    )
  )
  WITH CHECK (
    public.can_access_client(client_id, auth.uid())
    OR (
      public.is_portal_client_of(client_id, auth.uid())
      AND created_by = auth.uid()
      AND status IN ('submitted','info_needed','cancelled')
    )
  );

DROP POLICY IF EXISTS "client_requests_delete" ON public.client_requests;
CREATE POLICY "client_requests_delete" ON public.client_requests
  FOR DELETE TO authenticated
  USING (public.can_access_client(client_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.client_requests_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS client_requests_touch_updated_at ON public.client_requests;
CREATE TRIGGER client_requests_touch_updated_at
  BEFORE UPDATE ON public.client_requests
  FOR EACH ROW EXECUTE FUNCTION public.client_requests_touch();

-- ---------------------------------------------------------
-- Histórico do pedido
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.client_requests(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_name text,
  actor_side text NOT NULL DEFAULT 'team' CHECK (actor_side IN ('client','team')),
  kind text NOT NULL CHECK (kind IN ('created','status','comment','info_needed','cancelled')),
  note text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_request_events_request_idx
  ON public.client_request_events (request_id, created_at);

GRANT SELECT, INSERT ON public.client_request_events TO authenticated;
GRANT ALL ON public.client_request_events TO service_role;
ALTER TABLE public.client_request_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_request_events_select" ON public.client_request_events;
CREATE POLICY "client_request_events_select" ON public.client_request_events
  FOR SELECT TO authenticated
  USING (
    public.is_portal_client_of(client_id, auth.uid())
    OR public.can_access_client(client_id, auth.uid())
  );

DROP POLICY IF EXISTS "client_request_events_insert" ON public.client_request_events;
CREATE POLICY "client_request_events_insert" ON public.client_request_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_portal_client_of(client_id, auth.uid())
    OR public.can_access_client(client_id, auth.uid())
  );

-- ---------------------------------------------------------
-- Conversa e marcação nos conteúdos em aprovação
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.post_client_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_user_id uuid,
  author_name text,
  author_side text NOT NULL DEFAULT 'client' CHECK (author_side IN ('client','team')),
  body text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  anchor jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_client_comments_post_idx
  ON public.post_client_comments (post_id, created_at);

GRANT SELECT, INSERT, UPDATE ON public.post_client_comments TO authenticated;
GRANT ALL ON public.post_client_comments TO service_role;
ALTER TABLE public.post_client_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_client_comments_select" ON public.post_client_comments;
CREATE POLICY "post_client_comments_select" ON public.post_client_comments
  FOR SELECT TO authenticated
  USING (
    public.is_portal_client_of(client_id, auth.uid())
    OR public.can_access_client(client_id, auth.uid())
  );

DROP POLICY IF EXISTS "post_client_comments_insert" ON public.post_client_comments;
CREATE POLICY "post_client_comments_insert" ON public.post_client_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_portal_client_of(client_id, auth.uid())
    OR public.can_access_client(client_id, auth.uid())
  );

DROP POLICY IF EXISTS "post_client_comments_update" ON public.post_client_comments;
CREATE POLICY "post_client_comments_update" ON public.post_client_comments
  FOR UPDATE TO authenticated
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- ---------------------------------------------------------
-- Prazo do cliente no conteúdo
-- ---------------------------------------------------------

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS client_due_at timestamptz;

-- ---------------------------------------------------------
-- Preferências de aviso do contato do portal
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.portal_notification_prefs (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  email_enabled boolean NOT NULL DEFAULT true,
  kinds jsonb NOT NULL DEFAULT '{"approvals":true,"deadlines":true,"requests":true,"comments":true}'::jsonb,
  daily_digest boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_id)
);

GRANT SELECT, INSERT, UPDATE ON public.portal_notification_prefs TO authenticated;
GRANT ALL ON public.portal_notification_prefs TO service_role;
ALTER TABLE public.portal_notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portal_notification_prefs_own" ON public.portal_notification_prefs;
CREATE POLICY "portal_notification_prefs_own" ON public.portal_notification_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.can_access_client(client_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.can_access_client(client_id, auth.uid()));

DROP TRIGGER IF EXISTS portal_notification_prefs_touch ON public.portal_notification_prefs;
CREATE TRIGGER portal_notification_prefs_touch
  BEFORE UPDATE ON public.portal_notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.client_requests_touch();
