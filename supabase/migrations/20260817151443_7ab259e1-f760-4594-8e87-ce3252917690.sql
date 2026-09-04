-- 1) portal_decide: refletir a decisão do cliente em posts.review_status
CREATE OR REPLACE FUNCTION public.portal_decide(_token text DEFAULT NULL::text, _post_id uuid DEFAULT NULL::uuid, _decision text DEFAULT NULL::text, _note text DEFAULT NULL::text, _identity text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s record; post_title text; existing_id uuid; now_ts timestamptz := now();
  _kind public.notification_kind;
  _title text;
  _session_mode boolean := (_token IS NULL OR length(trim(_token)) = 0);
  _uid uuid;
  _who text;
BEGIN
  IF _decision NOT IN ('approved','rejected','adjust','comment') THEN RAISE EXCEPTION 'bad_decision'; END IF;
  IF _post_id IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
  SELECT * INTO s FROM public._portal_session_any(_token);

  IF _session_mode THEN
    _uid := auth.uid();
    SELECT NULLIF(trim(COALESCE(_identity, up.full_name, '')), '') INTO _who
      FROM public.user_profiles up WHERE up.id = _uid;
    _who := COALESCE(_who, 'Cliente');
  ELSE
    IF _identity IS NULL OR length(trim(_identity)) = 0 THEN RAISE EXCEPTION 'identity_required'; END IF;
    _who := _identity;
  END IF;

  SELECT title INTO post_title FROM public.posts
    WHERE id = _post_id AND brand_id = s.brand_id AND client_id = s.client_id;
  IF post_title IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;

  IF _decision <> 'comment' THEN
    SELECT id INTO existing_id FROM public.post_approvals WHERE post_id = _post_id;
    IF existing_id IS NOT NULL THEN
      UPDATE public.post_approvals SET
        status = _decision::approval_status,
        notes = _note, decided_at = now_ts, decided_by_name = _who,
        decided_by = _uid
      WHERE id = existing_id;
    ELSE
      INSERT INTO public.post_approvals(post_id, status, notes, decided_at, decided_by_name, decided_by)
      VALUES (_post_id, _decision::approval_status, _note, now_ts, _who, _uid);
    END IF;
    IF _decision = 'approved' THEN
      UPDATE public.posts SET approved_at = now_ts, review_status = 'approved' WHERE id = _post_id;
    ELSIF _decision = 'rejected' THEN
      UPDATE public.posts SET review_status = 'rejected' WHERE id = _post_id;
    ELSIF _decision = 'adjust' THEN
      UPDATE public.posts SET review_status = 'rework',
             rework_notes = COALESCE(NULLIF(_note, ''), rework_notes)
       WHERE id = _post_id;
    END IF;
  END IF;

  INSERT INTO public.activity_events(brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
  VALUES (s.brand_id, s.client_id, _uid, 'post', _post_id, 'portal_' || _decision,
          jsonb_build_object('note', COALESCE(_note,''), 'by', _who, 'title', post_title,
                             'mode', CASE WHEN _session_mode THEN 'login' ELSE 'token' END));

  _kind := CASE WHEN _decision = 'comment' THEN 'mention'::public.notification_kind ELSE 'approval_decision'::public.notification_kind END;
  _title := CASE _decision
      WHEN 'approved' THEN 'Cliente aprovou um post'
      WHEN 'rejected' THEN 'Cliente rejeitou um post'
      WHEN 'adjust'   THEN 'Cliente pediu ajustes'
      ELSE 'Cliente comentou um post'
    END;

  INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
  SELECT m.user_id, s.brand_id, _kind, _title,
         _who || ': ' || COALESCE(post_title, 'post'),
         '/customers/' || s.client_id::text,
         jsonb_build_object('source','portal_decision','post_id', _post_id, 'decision', _decision, 'by', _who)
    FROM public.brand_members m WHERE m.brand_id = s.brand_id;

  RETURN jsonb_build_object('ok', true);
END $function$;

-- 2) evento de conteúdo carrega o resultado da revisão (observabilidade)
CREATE OR REPLACE FUNCTION public.brain_trg_posts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_action text; v_type text; v_payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created'; v_type := 'content.created';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      v_action := 'stage_changed'; v_type := 'content.stage_changed';
    ELSE
      v_action := 'updated'; v_type := 'content.updated';
    END IF;
  END IF;

  v_payload := jsonb_build_object(
    'stage_id', NEW.stage_id,
    'title', NEW.title,
    'review_status', NEW.review_status,
    'review_notes', NEW.rework_notes
  );

  IF TG_OP = 'UPDATE' THEN
    v_payload := v_payload || jsonb_build_object(
      'previous_review_status', OLD.review_status,
      'review_status_changed', (NEW.review_status IS DISTINCT FROM OLD.review_status)
    );
    IF NEW.review_status IS DISTINCT FROM OLD.review_status THEN
      v_payload := v_payload || jsonb_build_object('decision', NEW.review_status);
    END IF;
  END IF;

  PERFORM public.emit_brain_event(
    NEW.brand_id, v_type, 'content', auth.uid(),
    'post', NEW.id, v_action, NEW.client_id, NULL,
    v_payload
  );
  RETURN NEW;
END; $function$;