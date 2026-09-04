
-- Message delivery logs for messaging tools (WhatsApp Evolution, WhatsApp Cloud API, Resend)
CREATE TABLE IF NOT EXISTS public.message_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  channel text NOT NULL,
  status text NOT NULL,
  provider_message_id text,
  recipient text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_logs_brand_sent_at_idx ON public.message_logs (brand_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS message_logs_brand_status_idx ON public.message_logs (brand_id, status);
CREATE INDEX IF NOT EXISTS message_logs_brand_channel_idx ON public.message_logs (brand_id, channel);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_logs TO authenticated;
GRANT ALL ON public.message_logs TO service_role;

ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand members can read message logs"
  ON public.message_logs FOR SELECT
  TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "brand members can insert message logs"
  ON public.message_logs FOR INSERT
  TO authenticated
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()));
