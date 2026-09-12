INSERT INTO public.feature_catalog (key, name, description, category, icon, is_core, sort_order, is_available, default_enabled)
VALUES ('automations', 'Automações', 'Disparos programados e por eventos via WhatsApp para cada cliente.', 'Comunicação', 'Zap', false, 115, true, false)
ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, category=EXCLUDED.category, icon=EXCLUDED.icon, is_core=false, sort_order=EXCLUDED.sort_order, is_available=true, default_enabled=false, updated_at=now();

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
    END IF;
    v_entity := NEW.id::text;
    v_context := jsonb_build_object('task', jsonb_build_object('id', NEW.id, 'title', NEW.title, 'due_at', NEW.due_at));
  ELSIF TG_TABLE_NAME = 'posts' THEN
    IF OLD.stage IS DISTINCT FROM NEW.stage AND NEW.stage = 'review'::public.post_stage THEN
      v_event := 'approval.requested';
    ELSIF OLD.stage IS DISTINCT FROM NEW.stage AND NEW.stage = 'approved'::public.post_stage THEN
      v_event := 'approval.approved';
    ELSIF OLD.review_status IS DISTINCT FROM NEW.review_status AND NEW.review_status = 'rework' THEN
      v_event := 'approval.rework';
    ELSIF OLD.scheduled_at IS NULL AND NEW.scheduled_at IS NOT NULL THEN
      v_event := 'publication.scheduled';
    ELSIF OLD.published_at IS NULL AND NEW.published_at IS NOT NULL THEN
      v_event := 'publication.published';
    ELSIF OLD.schedule_status IS DISTINCT FROM NEW.schedule_status AND NEW.schedule_status = 'failed' THEN
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
    IF TG_OP = 'INSERT' OR OLD.permissions IS DISTINCT FROM NEW.permissions OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id THEN
      v_event := 'portal.access';
    END IF;
    v_entity := NEW.client_id::text || ':' || md5(coalesce(NEW.permissions::text, '') || coalesce(NEW.owner_user_id::text, ''));
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