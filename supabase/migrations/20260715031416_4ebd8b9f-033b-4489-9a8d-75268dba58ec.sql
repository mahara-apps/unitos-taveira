
ALTER TABLE public.client_documents
  ADD COLUMN IF NOT EXISTS ai_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS ai_error text,
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS ai_summary jsonb,
  ADD COLUMN IF NOT EXISTS analyzed_at timestamptz,
  ADD COLUMN IF NOT EXISTS applied_to_briefing_at timestamptz;

ALTER TABLE public.client_documents
  DROP CONSTRAINT IF EXISTS client_documents_ai_status_chk;
ALTER TABLE public.client_documents
  ADD CONSTRAINT client_documents_ai_status_chk
  CHECK (ai_status IN ('idle','queued','running','done','failed'));

CREATE INDEX IF NOT EXISTS idx_client_documents_brand_client_created
  ON public.client_documents (brand_id, client_id, created_at DESC);
