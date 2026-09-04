ALTER TABLE public.brand_briefing_requests
  DROP CONSTRAINT IF EXISTS brand_briefing_requests_status_chk;
ALTER TABLE public.brand_briefing_requests
  ADD CONSTRAINT brand_briefing_requests_status_chk
  CHECK (status = ANY (ARRAY['requested','submitted','in_review','approved']));

ALTER TABLE public.brand_briefing_requests
  ADD COLUMN IF NOT EXISTS accepted_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pending_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS review_decision text,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS promoted_version_id uuid REFERENCES public.brand_briefing_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by uuid;

ALTER TABLE public.brand_briefing_requests
  DROP CONSTRAINT IF EXISTS brand_briefing_requests_decision_chk;
ALTER TABLE public.brand_briefing_requests
  ADD CONSTRAINT brand_briefing_requests_decision_chk
  CHECK (review_decision IS NULL OR review_decision = ANY (ARRAY['approved','partial','changes_requested']));

CREATE TABLE IF NOT EXISTS public.brand_briefing_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.brand_briefing_requests(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES public.brand_briefing_proposals(id) ON DELETE SET NULL,
  brand_id uuid NOT NULL,
  client_id uuid NOT NULL,
  decision text NOT NULL,
  accepted_fields text[] NOT NULL DEFAULT '{}',
  pending_fields text[] NOT NULL DEFAULT '{}',
  promoted jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  version_id uuid REFERENCES public.brand_briefing_versions(id) ON DELETE SET NULL,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_briefing_reviews_decision_chk
    CHECK (decision = ANY (ARRAY['approved','partial','changes_requested']))
);

CREATE INDEX IF NOT EXISTS brand_briefing_reviews_request_idx
  ON public.brand_briefing_reviews (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brand_briefing_reviews_scope_idx
  ON public.brand_briefing_reviews (brand_id, client_id, created_at DESC);

GRANT SELECT ON public.brand_briefing_reviews TO authenticated;
GRANT ALL ON public.brand_briefing_reviews TO service_role;

ALTER TABLE public.brand_briefing_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "briefing_reviews_select_scoped" ON public.brand_briefing_reviews;
CREATE POLICY "briefing_reviews_select_scoped"
  ON public.brand_briefing_reviews FOR SELECT TO authenticated
  USING (public.can_access_client(client_id, auth.uid()));

DROP POLICY IF EXISTS "briefing_reviews_insert_staff" ON public.brand_briefing_reviews;
CREATE POLICY "briefing_reviews_insert_staff"
  ON public.brand_briefing_reviews FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_client(client_id, auth.uid())
    AND public.app_access_role(auth.uid(), brand_id) IN ('super_admin','owner','manager','editor')
  );