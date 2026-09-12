ALTER TABLE public.whatsapp_recipients
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_recipients_one_default_per_client
  ON public.whatsapp_recipients (brand_id, client_id)
  WHERE client_id IS NOT NULL AND is_default = true AND is_active = true;

CREATE TABLE public.client_automation_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  date_value date NOT NULL,
  send_time time NOT NULL DEFAULT '09:00',
  repeats_annually boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_automation_dates TO authenticated;
GRANT ALL ON public.client_automation_dates TO service_role;
ALTER TABLE public.client_automation_dates ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.client_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.whatsapp_recipients(id) ON DELETE RESTRICT,
  instance_id uuid NOT NULL REFERENCES public.evolution_instances(id) ON DELETE RESTRICT,
  custom_date_id uuid REFERENCES public.client_automation_dates(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_type text NOT NULL,
  event_key text,
  schedule_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  message_template text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  is_active boolean NOT NULL DEFAULT false,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_automation_rules_trigger_type CHECK (trigger_type IN ('fixed','recurring','system_event','client_date')),
  CONSTRAINT client_automation_rules_event_shape CHECK (
    (trigger_type = 'system_event' AND event_key IS NOT NULL)
    OR (trigger_type = 'client_date' AND custom_date_id IS NOT NULL)
    OR (trigger_type IN ('fixed','recurring') AND event_key IS NULL AND custom_date_id IS NULL)
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_automation_rules TO authenticated;
GRANT ALL ON public.client_automation_rules TO service_role;
ALTER TABLE public.client_automation_rules ENABLE ROW LEVEL SECURITY;

CREATE INDEX client_automation_rules_due_idx
  ON public.client_automation_rules (next_run_at)
  WHERE is_active = true AND next_run_at IS NOT NULL;
CREATE INDEX client_automation_rules_event_idx
  ON public.client_automation_rules (brand_id, client_id, event_key)
  WHERE is_active = true AND trigger_type = 'system_event';

CREATE TABLE public.client_automation_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.client_automation_rules(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.whatsapp_recipients(id) ON DELETE RESTRICT,
  instance_id uuid NOT NULL REFERENCES public.evolution_instances(id) ON DELETE RESTRICT,
  occurrence_key text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 4,
  retry_at timestamptz,
  locked_at timestamptz,
  lock_owner text,
  event_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  rendered_message text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_automation_dispatches_status CHECK (status IN ('pending','processing','retry','sent','failed','cancelled')),
  CONSTRAINT client_automation_dispatches_attempts CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 10),
  CONSTRAINT client_automation_dispatches_occurrence_unique UNIQUE (rule_id, occurrence_key)
);
GRANT SELECT ON public.client_automation_dispatches TO authenticated;
GRANT ALL ON public.client_automation_dispatches TO service_role;
ALTER TABLE public.client_automation_dispatches ENABLE ROW LEVEL SECURITY;
CREATE INDEX client_automation_dispatches_due_idx
  ON public.client_automation_dispatches (coalesce(retry_at, scheduled_at), created_at)
  WHERE status IN ('pending','retry');

CREATE TABLE public.client_automation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.client_automation_dispatches(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  status text NOT NULL,
  masked_destination text,
  provider_message_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_automation_attempts_status CHECK (status IN ('sent','failed','skipped')),
  CONSTRAINT client_automation_attempts_unique UNIQUE (dispatch_id, attempt_number)
);
GRANT SELECT ON public.client_automation_attempts TO authenticated;
GRANT ALL ON public.client_automation_attempts TO service_role;
ALTER TABLE public.client_automation_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_client_automations(_brand_id uuid, _client_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access_client(_client_id, _user_id)
    AND public.app_access_role(_user_id, _brand_id) = ANY (ARRAY['super_admin','admin']);
$$;
REVOKE ALL ON FUNCTION public.can_manage_client_automations(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_client_automations(uuid,uuid,uuid) TO authenticated, service_role;

CREATE POLICY client_automation_dates_read ON public.client_automation_dates
  FOR SELECT TO authenticated USING (public.can_access_client(client_id, auth.uid()));
CREATE POLICY client_automation_dates_manage ON public.client_automation_dates
  FOR ALL TO authenticated
  USING (public.can_manage_client_automations(brand_id, client_id, auth.uid()))
  WITH CHECK (public.can_manage_client_automations(brand_id, client_id, auth.uid()));

CREATE POLICY client_automation_rules_read ON public.client_automation_rules
  FOR SELECT TO authenticated USING (public.can_access_client(client_id, auth.uid()));
CREATE POLICY client_automation_rules_manage ON public.client_automation_rules
  FOR ALL TO authenticated
  USING (public.can_manage_client_automations(brand_id, client_id, auth.uid()))
  WITH CHECK (public.can_manage_client_automations(brand_id, client_id, auth.uid()));

CREATE POLICY client_automation_dispatches_read ON public.client_automation_dispatches
  FOR SELECT TO authenticated USING (public.can_access_client(client_id, auth.uid()));
CREATE POLICY client_automation_attempts_read ON public.client_automation_attempts
  FOR SELECT TO authenticated USING (public.can_access_client(client_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.validate_client_automation_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = NEW.client_id AND c.brand_id = NEW.brand_id) THEN
    RAISE EXCEPTION 'cliente fora do workspace';
  END IF;
  IF TG_TABLE_NAME = 'client_automation_rules' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.whatsapp_recipients r
      WHERE r.id = NEW.recipient_id AND r.brand_id = NEW.brand_id AND r.client_id = NEW.client_id AND r.is_active
    ) THEN RAISE EXCEPTION 'destino inválido para o cliente'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.evolution_instances i
      WHERE i.id = NEW.instance_id AND i.brand_id = NEW.brand_id AND (i.client_id IS NULL OR i.client_id = NEW.client_id)
    ) THEN RAISE EXCEPTION 'instância inválida para o cliente'; END IF;
    IF NEW.custom_date_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.client_automation_dates d
      WHERE d.id = NEW.custom_date_id AND d.brand_id = NEW.brand_id AND d.client_id = NEW.client_id
    ) THEN RAISE EXCEPTION 'data personalizada inválida para o cliente'; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_client_automation_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_client_automation_scope() TO service_role;

CREATE TRIGGER client_automation_dates_validate
BEFORE INSERT OR UPDATE ON public.client_automation_dates
FOR EACH ROW EXECUTE FUNCTION public.validate_client_automation_scope();
CREATE TRIGGER client_automation_rules_validate
BEFORE INSERT OR UPDATE ON public.client_automation_rules
FOR EACH ROW EXECUTE FUNCTION public.validate_client_automation_scope();

CREATE OR REPLACE FUNCTION public.claim_client_automation_dispatches(_owner text, _limit integer DEFAULT 25, _lease_seconds integer DEFAULT 300)
RETURNS SETOF public.client_automation_dispatches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT d.id
    FROM public.client_automation_dispatches d
    WHERE (
      d.status IN ('pending','retry')
      AND coalesce(d.retry_at, d.scheduled_at) <= now()
    ) OR (
      d.status = 'processing'
      AND d.locked_at < now() - make_interval(secs => _lease_seconds)
    )
    ORDER BY coalesce(d.retry_at, d.scheduled_at), d.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(_limit, 1), 100)
  )
  UPDATE public.client_automation_dispatches d
  SET status = 'processing', locked_at = now(), lock_owner = _owner,
      attempts = d.attempts + 1, updated_at = now()
  FROM due
  WHERE d.id = due.id
  RETURNING d.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_client_automation_dispatches(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_client_automation_dispatches(text,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_client_automation_event(
  _brand_id uuid, _client_id uuid, _event_key text, _entity_key text, _context jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.client_automation_dispatches (
    brand_id, client_id, rule_id, recipient_id, instance_id, occurrence_key,
    scheduled_at, event_context
  )
  SELECT r.brand_id, r.client_id, r.id, r.recipient_id, r.instance_id,
         _event_key || ':' || _entity_key, now(), coalesce(_context, '{}'::jsonb)
  FROM public.client_automation_rules r
  JOIN public.brand_features bf ON bf.brand_id = r.brand_id AND bf.feature_key = 'automations' AND bf.enabled
  WHERE r.brand_id = _brand_id AND r.client_id = _client_id
    AND r.trigger_type = 'system_event' AND r.event_key = _event_key AND r.is_active
  ON CONFLICT (rule_id, occurrence_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_client_automation_event(uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_client_automation_event(uuid,uuid,text,text,jsonb) TO service_role;