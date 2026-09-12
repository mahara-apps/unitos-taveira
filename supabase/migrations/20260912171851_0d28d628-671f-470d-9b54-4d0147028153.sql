CREATE OR REPLACE FUNCTION public.set_client_default_whatsapp_recipient(
  _brand_id uuid, _client_id uuid, _recipient_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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
  UPDATE public.whatsapp_recipients
  SET is_default = (id = _recipient_id)
  WHERE brand_id = _brand_id AND client_id = _client_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_client_default_whatsapp_recipient(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_client_default_whatsapp_recipient(uuid,uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.emit_client_automation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
  v_entity text;
  v_context jsonb;
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    IF TG_OP = 'INSERT' AND NEW.assignee_id IS NOT NULL THEN
      v_event := 'task.assigned';
    ELSIF TG_OP = 'UPDATE' AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id AND NEW.assignee_id IS NOT NULL THEN
      v_event := 'task.assigned';
    ELSIF TG_OP = 'UPDATE' AND NEW.due_at IS NOT NULL AND NEW.due_at <= now()
          AND (OLD.due_at IS NULL OR OLD.due_at > now()) THEN
      v_event := 'task.due';
    END IF;
    v_entity := NEW.id::text;
    v_context := jsonb_build_object('task', jsonb_build_object('id', NEW.id, 'title', NEW.title, 'due_at', NEW.due_at));
  ELSIF TG_TABLE_NAME = 'posts' THEN
    IF TG_OP = 'UPDATE' AND OLD.stage IS DISTINCT FROM NEW.stage AND NEW.stage = 'review'::public.post_stage THEN
      v_event := 'approval.requested';
    ELSIF TG_OP = 'UPDATE' AND OLD.stage IS DISTINCT FROM NEW.stage AND NEW.stage = 'approved'::public.post_stage THEN
      v_event := 'approval.approved';
    ELSIF TG_OP = 'UPDATE' AND OLD.review_status IS DISTINCT FROM NEW.review_status AND NEW.review_status = 'rework' THEN
      v_event := 'approval.rework';
    ELSIF TG_OP = 'UPDATE' AND OLD.schedule_status IS DISTINCT FROM NEW.schedule_status AND NEW.schedule_status = 'scheduled' THEN
      v_event := 'publication.scheduled';
    ELSIF TG_OP = 'UPDATE' AND OLD.published_at IS NULL AND NEW.published_at IS NOT NULL THEN
      v_event := 'publication.published';
    ELSIF TG_OP = 'UPDATE' AND OLD.schedule_status IS DISTINCT FROM NEW.schedule_status AND NEW.schedule_status = 'failed' THEN
      v_event := 'publication.failed';
    END IF;
    v_entity := NEW.id::text;
    v_context := jsonb_build_object('post', jsonb_build_object('id', NEW.id, 'title', NEW.title, 'scheduled_at', NEW.scheduled_at));
  ELSIF TG_TABLE_NAME = 'brand_briefing_requests' THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'requested') THEN
      v_event := 'briefing.requested';
    END IF;
    v_entity := NEW.id::text;
    v_context := jsonb_build_object('briefing', jsonb_build_object('id', NEW.id, 'due_at', NEW.due_at));
  ELSIF TG_TABLE_NAME = 'client_portal_access' THEN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      v_event := 'portal.access';
    END IF;
    v_entity := NEW.client_id::text || ':' || extract(epoch FROM NEW.updated_at)::bigint::text;
    v_context := '{}'::jsonb;
  END IF;

  IF v_event IS NOT NULL AND NEW.brand_id IS NOT NULL AND NEW.client_id IS NOT NULL THEN
    PERFORM public.enqueue_client_automation_event(NEW.brand_id, NEW.client_id, v_event, v_entity, v_context);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.emit_client_automation_event() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_client_automation_event() TO service_role;

CREATE TRIGGER tasks_emit_client_automation
AFTER INSERT OR UPDATE OF assignee_id, due_at ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.emit_client_automation_event();
CREATE TRIGGER posts_emit_client_automation
AFTER UPDATE OF stage, review_status, schedule_status, published_at ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.emit_client_automation_event();
CREATE TRIGGER briefing_requests_emit_client_automation
AFTER INSERT OR UPDATE OF status ON public.brand_briefing_requests
FOR EACH ROW EXECUTE FUNCTION public.emit_client_automation_event();
CREATE TRIGGER portal_access_emit_client_automation
AFTER INSERT OR UPDATE ON public.client_portal_access
FOR EACH ROW EXECUTE FUNCTION public.emit_client_automation_event();