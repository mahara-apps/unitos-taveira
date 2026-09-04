
CREATE TABLE public.brand_api_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  provider text NOT NULL,
  ciphertext text NOT NULL,
  masked text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_api_credentials TO authenticated;
GRANT ALL ON public.brand_api_credentials TO service_role;

ALTER TABLE public.brand_api_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand members manage credentials"
  ON public.brand_api_credentials FOR ALL
  TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE TRIGGER trg_brand_api_credentials_updated_at
  BEFORE UPDATE ON public.brand_api_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
