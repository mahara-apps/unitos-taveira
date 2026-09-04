
CREATE TABLE public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','whatsapp')),
  subject text,
  body text NOT NULL DEFAULT '',
  variables_used text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, event_key, channel)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_templates TO authenticated;
GRANT ALL ON public.message_templates TO service_role;

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand members read templates"
  ON public.message_templates FOR SELECT
  TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "brand members write templates"
  ON public.message_templates FOR ALL
  TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE TRIGGER update_message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
