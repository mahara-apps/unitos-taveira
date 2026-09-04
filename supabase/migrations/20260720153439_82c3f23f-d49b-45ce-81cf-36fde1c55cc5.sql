
CREATE TABLE public.sla_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('project','user_role','agent')),
  scope_ref text,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  target_hours integer NOT NULL CHECK (target_hours > 0),
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sla_rules_unique_scope
  ON public.sla_rules (brand_id, scope, COALESCE(scope_ref,''), COALESCE(project_id::text,''));

CREATE INDEX sla_rules_brand_scope_idx ON public.sla_rules (brand_id, scope);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sla_rules TO authenticated;
GRANT ALL ON public.sla_rules TO service_role;

ALTER TABLE public.sla_rules ENABLE ROW LEVEL SECURITY;

-- Read: any member of the brand or super admin
CREATE POLICY "sla_rules_read_members"
  ON public.sla_rules FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = sla_rules.brand_id AND bm.user_id = auth.uid()
    )
  );

-- Write: owners/managers of the brand or super admin
CREATE POLICY "sla_rules_write_managers"
  ON public.sla_rules FOR ALL
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = sla_rules.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner','manager')
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = sla_rules.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner','manager')
    )
  );

CREATE TRIGGER sla_rules_set_updated_at
  BEFORE UPDATE ON public.sla_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
