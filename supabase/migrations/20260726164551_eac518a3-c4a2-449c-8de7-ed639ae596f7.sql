
-- 1. New commercial fields on clients + journey stage
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS monthly_contract_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS margin_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS contract_start_date date,
  ADD COLUMN IF NOT EXISTS contract_renewal_date date,
  ADD COLUMN IF NOT EXISTS contract_status text NOT NULL DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS journey_stage text NOT NULL DEFAULT 'onboarding';

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_contract_status_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_contract_status_check
  CHECK (contract_status IN ('ativo','pausado','encerrado'));

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_journey_stage_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_journey_stage_check
  CHECK (journey_stage IN ('onboarding','ativacao','operacao','expansao','renovacao'));

-- 2. client_journey_events
CREATE TABLE IF NOT EXISTS public.client_journey_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  note text,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  moved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_journey_events_client
  ON public.client_journey_events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_journey_events_brand
  ON public.client_journey_events (brand_id, created_at DESC);

GRANT SELECT, INSERT ON public.client_journey_events TO authenticated;
GRANT ALL ON public.client_journey_events TO service_role;

ALTER TABLE public.client_journey_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "journey_events_select_brand_members"
  ON public.client_journey_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = client_journey_events.brand_id
        AND bm.user_id = auth.uid()
    )
  );

CREATE POLICY "journey_events_insert_admin_manager"
  ON public.client_journey_events FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = client_journey_events.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner','manager')
    )
  );

-- 3. brand_journey_stage_templates
CREATE TABLE IF NOT EXISTS public.brand_journey_stage_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  stage text NOT NULL,
  project_template_id uuid NOT NULL REFERENCES public.project_templates(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, stage)
);

ALTER TABLE public.brand_journey_stage_templates
  DROP CONSTRAINT IF EXISTS brand_journey_stage_templates_stage_check;
ALTER TABLE public.brand_journey_stage_templates
  ADD CONSTRAINT brand_journey_stage_templates_stage_check
  CHECK (stage IN ('onboarding','ativacao','operacao','expansao','renovacao'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_journey_stage_templates TO authenticated;
GRANT ALL ON public.brand_journey_stage_templates TO service_role;

ALTER TABLE public.brand_journey_stage_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stage_templates_select_brand_members"
  ON public.brand_journey_stage_templates FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = brand_journey_stage_templates.brand_id
        AND bm.user_id = auth.uid()
    )
  );

CREATE POLICY "stage_templates_modify_admin_manager"
  ON public.brand_journey_stage_templates FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = brand_journey_stage_templates.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner','manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = brand_journey_stage_templates.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner','manager')
    )
  );

-- updated_at trigger reuse
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $f$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $f$ LANGUAGE plpgsql SET search_path = public;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_stage_templates_updated_at ON public.brand_journey_stage_templates;
CREATE TRIGGER trg_stage_templates_updated_at
  BEFORE UPDATE ON public.brand_journey_stage_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
