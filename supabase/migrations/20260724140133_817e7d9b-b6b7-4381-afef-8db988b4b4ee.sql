CREATE TABLE public.ai_model_health (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','failed')),
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_model_health_checked_at_idx ON public.ai_model_health (checked_at DESC);
CREATE INDEX ai_model_health_provider_idx ON public.ai_model_health (provider, checked_at DESC);

GRANT SELECT ON public.ai_model_health TO authenticated;
GRANT ALL ON public.ai_model_health TO service_role;

ALTER TABLE public.ai_model_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view ai model health"
  ON public.ai_model_health FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.is_super_admin = true
    )
  );