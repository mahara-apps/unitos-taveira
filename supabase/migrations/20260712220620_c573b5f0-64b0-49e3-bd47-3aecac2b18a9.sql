
CREATE TABLE public.client_briefing_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  submitted_at timestamptz,
  submission jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_briefing_tokens TO authenticated;
GRANT ALL ON public.client_briefing_tokens TO service_role;

ALTER TABLE public.client_briefing_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand members manage briefing tokens"
  ON public.client_briefing_tokens
  FOR ALL
  TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

CREATE INDEX client_briefing_tokens_brand_idx ON public.client_briefing_tokens(brand_id);
CREATE INDEX client_briefing_tokens_client_idx ON public.client_briefing_tokens(client_id);

CREATE TRIGGER trg_client_briefing_tokens_updated
BEFORE UPDATE ON public.client_briefing_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
