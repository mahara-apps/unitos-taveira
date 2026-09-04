ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS webhook_token text,
  ADD COLUMN IF NOT EXISTS webhook_configured_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS evolution_instances_webhook_token_key
  ON public.evolution_instances (webhook_token)
  WHERE webhook_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.evolution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.evolution_instances(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  instance_name text NOT NULL,
  event_type text NOT NULL,
  provider_event_id text,
  connection_state text,
  phone_number text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evolution_events_instance_idx
  ON public.evolution_events (instance_id, received_at DESC);
CREATE INDEX IF NOT EXISTS evolution_events_brand_idx
  ON public.evolution_events (brand_id, received_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS evolution_events_dedupe_key
  ON public.evolution_events (instance_id, event_type, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

GRANT SELECT ON public.evolution_events TO authenticated;
GRANT ALL ON public.evolution_events TO service_role;

ALTER TABLE public.evolution_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evolution_events_select_scope" ON public.evolution_events;
CREATE POLICY "evolution_events_select_scope"
ON public.evolution_events FOR SELECT TO authenticated
USING (public.client_in_scope(client_id, brand_id));