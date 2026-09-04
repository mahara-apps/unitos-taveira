CREATE TABLE public.ai_model_catalog_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL,
  role text NOT NULL,
  model_id text NOT NULL,
  replaced_model_id text,
  reason text,
  source text NOT NULL DEFAULT 'auto_health_check',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, role)
);

GRANT SELECT ON public.ai_model_catalog_overrides TO authenticated;
GRANT ALL ON public.ai_model_catalog_overrides TO service_role;

ALTER TABLE public.ai_model_catalog_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super admins read model overrides"
ON public.ai_model_catalog_overrides
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

ALTER TABLE public.ai_model_health ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'operational';