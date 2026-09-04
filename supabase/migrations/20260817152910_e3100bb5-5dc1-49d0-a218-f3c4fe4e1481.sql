CREATE OR REPLACE FUNCTION public.brain_trg_post_approvals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_brand uuid; v_client uuid;
BEGIN
  SELECT brand_id, client_id INTO v_brand, v_client FROM public.posts WHERE id = NEW.post_id;
  PERFORM public.emit_brain_event(
    v_brand, 'content.approval', 'approvals', NEW.decided_by,
    'post_approval', NEW.id, COALESCE(NEW.status::text, 'reviewed'), v_client, NULL,
    jsonb_build_object(
      'post_id', NEW.post_id,
      'status', NEW.status,
      'notes', NEW.notes,
      'decided_by_name', NEW.decided_by_name,
      'decided_at', NEW.decided_at
    )
  );
  RETURN NEW;
END; $function$;