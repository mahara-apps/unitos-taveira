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

CREATE OR REPLACE FUNCTION public.set_client_default_whatsapp_recipient(
  _brand_id uuid, _client_id uuid, _recipient_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_client_automations(_brand_id, _client_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_recipients
    WHERE id = _recipient_id AND brand_id = _brand_id AND client_id = _client_id AND is_active
  ) THEN
    RAISE EXCEPTION 'destino inválido para este cliente';
  END IF;
  UPDATE public.whatsapp_recipients SET is_default = false
  WHERE brand_id = _brand_id AND client_id = _client_id AND is_default;
  UPDATE public.whatsapp_recipients SET is_default = true
  WHERE id = _recipient_id AND brand_id = _brand_id AND client_id = _client_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_client_default_whatsapp_recipient(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_client_default_whatsapp_recipient(uuid,uuid,uuid) TO authenticated, service_role;

DROP TRIGGER IF EXISTS posts_emit_client_automation ON public.posts;
CREATE TRIGGER posts_emit_client_automation
AFTER UPDATE OF stage, review_status, schedule_status, scheduled_at, published_at ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.emit_client_automation_event();