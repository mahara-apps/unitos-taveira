-- Fase B: resolver de sessão do portal em dual-mode (token OU login)

CREATE OR REPLACE FUNCTION public._portal_session_user()
RETURNS TABLE(client_id uuid, brand_id uuid, token_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;
  SELECT cm.id, cm.client_id, cm.brand_id, cm.last_seen_at
    INTO r
    FROM public.client_members cm
   WHERE cm.user_id = uid AND cm.role = 'portal_client'
   ORDER BY cm.created_at
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF r.last_seen_at IS NULL OR r.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE public.client_members SET last_seen_at = now() WHERE id = r.id;
  END IF;
  client_id := r.client_id; brand_id := r.brand_id; token_id := NULL;
  RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION public._portal_session_any(_token text DEFAULT NULL)
RETURNS TABLE(client_id uuid, brand_id uuid, token_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _token IS NULL OR length(trim(_token)) = 0 THEN
    RETURN QUERY SELECT * FROM public._portal_session_user();
  ELSE
    RETURN QUERY SELECT * FROM public._portal_session(_token);
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public._portal_session_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._portal_session_any(text) FROM PUBLIC, anon, authenticated;

-- RPCs em dual-mode: _token passa a aceitar NULL (modo sessão)

CREATE OR REPLACE FUNCTION public.portal_resolve(_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE s record; res jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token);
  SELECT jsonb_build_object(
    'clientId', s.client_id,
    'brandId', s.brand_id,
    'client', to_jsonb(cl.*) - 'created_at' - 'updated_at',
    'brand', jsonb_build_object('id', b.id, 'name', b.name)
  ) INTO res
  FROM public.clients cl, public.brands b
  WHERE cl.id = s.client_id AND b.id = s.brand_id;
  RETURN res;
END $function$;

CREATE OR REPLACE FUNCTION public.portal_metrics(_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE s record; month_start timestamptz := date_trunc('month', now());
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token);
  RETURN (
    WITH p AS (
      SELECT id, stage, scheduled_at, published_at, approved_at
        FROM public.posts
       WHERE brand_id = s.brand_id AND client_id = s.client_id
         AND visible_in_portal = true AND deleted_at IS NULL
    ),
    a AS (
      SELECT status FROM public.post_approvals WHERE post_id IN (SELECT id FROM p)
    )
    SELECT jsonb_build_object(
      'pending', (SELECT count(*) FROM a WHERE status = 'pending'),
      'approvedThisMonth', (SELECT count(*) FROM p WHERE approved_at >= month_start),
      'scheduled', (SELECT count(*) FROM p WHERE stage = 'scheduled' OR (scheduled_at IS NOT NULL AND published_at IS NULL)),
      'total', (SELECT count(*) FROM p)
    )
  );
END $function$;

CREATE OR REPLACE FUNCTION public.portal_approvals(_token text DEFAULT NULL, _status text DEFAULT 'all'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE s record; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token);
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO rows FROM (
    SELECT
      p.id, p.title, p.format, p.channels, p.scheduled_at, p.cover_url, p.reference_media, p.stage,
      jsonb_build_object(
        'status', COALESCE(a.status::text, 'pending'),
        'notes', a.notes,
        'decided_at', a.decided_at
      ) AS approval
    FROM public.posts p
    LEFT JOIN public.post_approvals a ON a.post_id = p.id
    WHERE p.brand_id = s.brand_id AND p.client_id = s.client_id
      AND p.visible_in_portal = true AND p.deleted_at IS NULL
      AND (
        _status = 'all'
        OR (_status = 'pending' AND (a.status IS NULL OR a.status = 'pending'))
        OR (_status = 'approved' AND a.status = 'approved')
        OR (_status = 'adjust' AND a.status = 'adjust')
      )
    ORDER BY p.scheduled_at ASC NULLS LAST
  ) x;
  RETURN rows;
END $function$;

CREATE OR REPLACE FUNCTION public.portal_calendar(_token text DEFAULT NULL, _month text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE s record; m_start timestamptz; m_end timestamptz; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token);
  IF _month IS NULL THEN
    m_start := date_trunc('month', now());
  ELSE
    m_start := (_month || '-01')::timestamptz;
  END IF;
  m_end := m_start + interval '1 month';
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO rows FROM (
    SELECT id, title, format, channels, scheduled_at, stage, cover_url
      FROM public.posts
     WHERE brand_id = s.brand_id AND client_id = s.client_id
       AND visible_in_portal = true AND deleted_at IS NULL
       AND scheduled_at >= m_start AND scheduled_at < m_end
     ORDER BY scheduled_at ASC
  ) x;
  RETURN rows;
END $function$;

CREATE OR REPLACE FUNCTION public.portal_files(_token text DEFAULT NULL, _search text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE s record; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token);
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO rows FROM (
    SELECT id, name, storage_path, mime_type, size_bytes, created_at
      FROM public.client_documents
     WHERE brand_id = s.brand_id AND client_id = s.client_id
       AND visible_to_client IS TRUE
       AND (_search IS NULL OR name ILIKE '%' || _search || '%')
     ORDER BY created_at DESC
  ) x;
  RETURN rows;
END $function$;

CREATE OR REPLACE FUNCTION public.portal_briefings(_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE s record; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token);
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO rows FROM (
    SELECT id, token, label, expires_at, revoked_at, submitted_at, created_at
      FROM public.client_briefing_tokens
     WHERE brand_id = s.brand_id AND client_id = s.client_id
     ORDER BY created_at DESC
  ) x;
  RETURN rows;
END $function$;

CREATE OR REPLACE FUNCTION public.portal_post(_token text DEFAULT NULL, _post_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE s record; post_row jsonb; apprv jsonb;
BEGIN
  IF _post_id IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
  SELECT * INTO s FROM public._portal_session_any(_token);
  SELECT to_jsonb(p) INTO post_row FROM (
    SELECT id, title, copy, format, channels, scheduled_at, cover_url, reference_media, script, stage
      FROM public.posts
     WHERE id = _post_id AND brand_id = s.brand_id AND client_id = s.client_id AND visible_in_portal = true
  ) p;
  IF post_row IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
  SELECT to_jsonb(a) INTO apprv FROM (
    SELECT status::text, notes, decided_at, decided_by_name
      FROM public.post_approvals WHERE post_id = _post_id
  ) a;
  RETURN jsonb_build_object('post', post_row, 'approval', apprv);
END $function$;

CREATE OR REPLACE FUNCTION public.portal_decide(
  _token text DEFAULT NULL,
  _post_id uuid DEFAULT NULL,
  _decision text DEFAULT NULL,
  _note text DEFAULT NULL,
  _identity text DEFAULT NULL
)
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

-- Execução: mantém anon (modo token) e habilita authenticated (modo sessão)
GRANT EXECUTE ON FUNCTION public.portal_resolve(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_metrics(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_approvals(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_calendar(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_files(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_briefings(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_post(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_decide(text, uuid, text, text, text) TO anon, authenticated;