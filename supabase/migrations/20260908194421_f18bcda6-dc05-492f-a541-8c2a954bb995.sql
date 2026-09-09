CREATE TABLE IF NOT EXISTS public.critical_action_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action_key text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  target_label text,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  result text NOT NULL DEFAULT 'success',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS critical_action_events_created_idx
  ON public.critical_action_events (created_at DESC);
CREATE INDEX IF NOT EXISTS critical_action_events_actor_idx
  ON public.critical_action_events (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS critical_action_events_action_idx
  ON public.critical_action_events (action_key, created_at DESC);

GRANT SELECT ON public.critical_action_events TO authenticated;
GRANT ALL ON public.critical_action_events TO service_role;

ALTER TABLE public.critical_action_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "critical events readable by super admin" ON public.critical_action_events;
CREATE POLICY "critical events readable by super admin"
  ON public.critical_action_events
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));