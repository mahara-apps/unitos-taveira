-- FASE 3 — Briefing solicitado ao cliente + resposta como PROPOSTA.
-- A proposta nunca altera clients.brand_hub: fica isolada, vinculada ao
-- cliente e à versão atual do briefing (brand_briefing_versions).

CREATE TABLE public.brand_briefing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  requested_fields text[] NOT NULL DEFAULT '{}',
  message text,
  status text NOT NULL DEFAULT 'requested',
  base_version_id uuid REFERENCES public.brand_briefing_versions(id) ON DELETE SET NULL,
  due_at timestamptz,
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_briefing_requests_status_chk
    CHECK (status IN ('requested','submitted','in_review'))
);

CREATE INDEX brand_briefing_requests_scope_idx
  ON public.brand_briefing_requests (brand_id, client_id, requested_at DESC);

CREATE TABLE public.brand_briefing_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.brand_briefing_requests(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  base_version_id uuid REFERENCES public.brand_briefing_versions(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  submitted_via text NOT NULL DEFAULT 'portal_session',
  submitted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_briefing_proposals_via_chk
    CHECK (submitted_via IN ('portal_session','portal_token'))
);

CREATE INDEX brand_briefing_proposals_request_idx
  ON public.brand_briefing_proposals (request_id, created_at DESC);
CREATE INDEX brand_briefing_proposals_scope_idx
  ON public.brand_briefing_proposals (brand_id, client_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_briefing_requests TO authenticated;
GRANT ALL ON public.brand_briefing_requests TO service_role;
GRANT SELECT ON public.brand_briefing_proposals TO authenticated;
GRANT ALL ON public.brand_briefing_proposals TO service_role;

ALTER TABLE public.brand_briefing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_briefing_proposals ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário com acesso ao cliente (equipe da marca no escopo
-- ou cliente vinculado ao portal). Escrita: somente equipe da marca.
CREATE POLICY "briefing_requests_select_scoped"
  ON public.brand_briefing_requests FOR SELECT TO authenticated
  USING (public.can_access_client(client_id, auth.uid()));

CREATE POLICY "briefing_requests_write_staff"
  ON public.brand_briefing_requests FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_client(client_id, auth.uid())
    AND public.app_access_role(auth.uid(), brand_id) IN ('super_admin','owner','manager','editor')
  );

CREATE POLICY "briefing_requests_update_staff"
  ON public.brand_briefing_requests FOR UPDATE TO authenticated
  USING (
    public.can_access_client(client_id, auth.uid())
    AND public.app_access_role(auth.uid(), brand_id) IN ('super_admin','owner','manager','editor')
  )
  WITH CHECK (
    public.can_access_client(client_id, auth.uid())
    AND public.app_access_role(auth.uid(), brand_id) IN ('super_admin','owner','manager','editor')
  );

CREATE POLICY "briefing_proposals_select_scoped"
  ON public.brand_briefing_proposals FOR SELECT TO authenticated
  USING (public.can_access_client(client_id, auth.uid()));