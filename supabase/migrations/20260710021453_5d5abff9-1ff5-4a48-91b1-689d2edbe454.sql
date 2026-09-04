
CREATE TABLE public.brand_connections (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  monthly_budget_usd numeric NOT NULL DEFAULT 500,
  text_provider text NOT NULL DEFAULT 'openai',
  image_provider text NOT NULL DEFAULT 'gemini',
  providers jsonb NOT NULL DEFAULT '{}'::jsonb,
  channels jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_connections TO authenticated;
GRANT ALL ON public.brand_connections TO service_role;

ALTER TABLE public.brand_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read brand connections"
  ON public.brand_connections FOR SELECT TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()));

CREATE POLICY "Members can upsert brand connections"
  ON public.brand_connections FOR INSERT TO authenticated
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

CREATE POLICY "Members can update brand connections"
  ON public.brand_connections FOR UPDATE TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

CREATE TRIGGER brand_connections_updated_at
  BEFORE UPDATE ON public.brand_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
