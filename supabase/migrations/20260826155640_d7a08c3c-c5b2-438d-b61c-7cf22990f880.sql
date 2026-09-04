CREATE TABLE public.evolution_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  instance_name text NOT NULL,
  label text,
  status text NOT NULL DEFAULT 'created',
  connection_state text,
  phone_number text,
  last_state_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX evolution_instances_brand_name_key
  ON public.evolution_instances (brand_id, lower(instance_name));
CREATE INDEX evolution_instances_brand_idx ON public.evolution_instances (brand_id);
CREATE INDEX evolution_instances_client_idx ON public.evolution_instances (client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.evolution_instances TO authenticated;
GRANT ALL ON public.evolution_instances TO service_role;

ALTER TABLE public.evolution_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "evolution_instances_select_scope"
ON public.evolution_instances FOR SELECT TO authenticated
USING (public.client_in_scope(client_id, brand_id));

CREATE POLICY "evolution_instances_insert_admin"
ON public.evolution_instances FOR INSERT TO authenticated
WITH CHECK (
  public.app_access_role(auth.uid(), brand_id) IN ('super_admin','admin','manager')
  AND public.client_in_scope(client_id, brand_id)
);

CREATE POLICY "evolution_instances_update_admin"
ON public.evolution_instances FOR UPDATE TO authenticated
USING (
  public.app_access_role(auth.uid(), brand_id) IN ('super_admin','admin','manager')
  AND public.client_in_scope(client_id, brand_id)
)
WITH CHECK (
  public.app_access_role(auth.uid(), brand_id) IN ('super_admin','admin','manager')
  AND public.client_in_scope(client_id, brand_id)
);

CREATE POLICY "evolution_instances_delete_admin"
ON public.evolution_instances FOR DELETE TO authenticated
USING (
  public.app_access_role(auth.uid(), brand_id) IN ('super_admin','admin','manager')
  AND public.client_in_scope(client_id, brand_id)
);

CREATE TRIGGER evolution_instances_touch_updated_at
BEFORE UPDATE ON public.evolution_instances
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();