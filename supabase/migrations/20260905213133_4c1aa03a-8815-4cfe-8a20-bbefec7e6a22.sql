ALTER TABLE public.client_requests
  ADD COLUMN IF NOT EXISTS last_team_reply_at timestamptz;

CREATE OR REPLACE FUNCTION public.portal_decide(_token text DEFAULT NULL::text, _post_id uuid DEFAULT NULL::uuid, _decision text DEFAULT NULL::text, _note text DEFAULT NULL::text, _identity text DEFAULT NULL::text, _client_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record; pst record; existing_id uuid; now_ts timestamptz := now();
  _kind public.notification_kind;
  _title text;
  _session_mode boolean := (_token IS NULL OR length(trim(_token)) = 0);
  _uid uuid;
  _who text;
  _dedupe text;
  _note_clean text := NULLIF(trim(COALESCE(_note, '')), '');
BEGIN
  IF _decision NOT IN ('approved','rejected','adjust','comment') THEN RAISE EXCEPTION 'bad_decision'; END IF;
  IF _post_id IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
  -- Pedido de ajuste sem explicacao nao e acionavel pela equipe.
  IF _decision = 'adjust' AND _note_clean IS NULL THEN RAISE EXCEPTION 'note_required'; END IF;
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);

  IF _session_mode THEN
    _uid := auth.uid();
    SELECT NULLIF(trim(COALESCE(_identity, up.full_name, '')), '') INTO _who
      FROM public.user_profiles up WHERE up.id = _uid;
    _who := COALESCE(_who, 'Cliente');
  ELSE
    IF _identity IS NULL OR length(trim(_identity)) = 0 THEN RAISE EXCEPTION 'identity_required'; END IF;
    _who := _identity;
  END IF;

  SELECT id, title, stage, published_at, deleted_at, visible_in_portal
    INTO pst
    FROM public.posts
   WHERE id = _post_id AND brand_id = s.brand_id AND client_id = s.client_id;

  IF pst.id IS NULL OR pst.deleted_at IS NOT NULL OR pst.visible_in_portal IS NOT TRUE THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  IF _decision <> 'comment'
     AND (pst.published_at IS NOT NULL OR pst.stage = 'published') THEN
    RAISE EXCEPTION 'post_already_published';
  END IF;

  IF _decision <> 'comment' THEN
    SELECT id INTO existing_id FROM public.post_approvals WHERE post_id = _post_id;
    IF existing_id IS NOT NULL THEN
      UPDATE public.post_approvals SET
        status = _decision::approval_status,
        -- Ajuste nunca sobrescreve a nota anterior com vazio.
        notes = CASE WHEN _decision = 'adjust' THEN COALESCE(_note_clean, notes) ELSE _note END,
        decided_at = now_ts, decided_by_name = _who,
        decided_by = _uid
      WHERE id = existing_id;
    ELSE
      INSERT INTO public.post_approvals(post_id, status, notes, decided_at, decided_by_name, decided_by)
      VALUES (_post_id, _decision::approval_status,
              CASE WHEN _decision = 'adjust' THEN _note_clean ELSE _note END,
              now_ts, _who, _uid);
    END IF;
    IF _decision = 'approved' THEN
      UPDATE public.posts SET approved_at = now_ts, review_status = 'approved' WHERE id = _post_id;
    ELSIF _decision = 'rejected' THEN
      UPDATE public.posts SET review_status = 'rejected' WHERE id = _post_id;
    ELSIF _decision = 'adjust' THEN
      UPDATE public.posts SET review_status = 'rework',
             rework_notes = COALESCE(_note_clean, rework_notes)
       WHERE id = _post_id;
    END IF;
  END IF;

  INSERT INTO public.activity_events(brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
  VALUES (s.brand_id, s.client_id, _uid, 'post', _post_id, 'portal_' || _decision,
          jsonb_build_object('note', COALESCE(_note,''), 'by', _who, 'title', pst.title,
                             'mode', CASE WHEN _session_mode THEN 'login' ELSE 'token' END));

  _kind := CASE WHEN _decision = 'comment' THEN 'mention'::public.notification_kind ELSE 'approval_decision'::public.notification_kind END;
  _title := CASE _decision
      WHEN 'approved' THEN 'Cliente aprovou um post'
      WHEN 'rejected' THEN 'Cliente rejeitou um post'
      WHEN 'adjust'   THEN 'Cliente pediu ajustes'
      ELSE 'Cliente comentou um post'
    END;

  _dedupe := 'portal_decision:' || _post_id::text || ':' || _decision;

  -- Destinatarios: responsavel pelo cliente, quem esta ligado ao cliente e
  -- TODOS os integrantes internos do espaco (owner, admin, manager, user...).
  -- Contatos do portal jamais recebem avisos internos.
  INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload, dedupe_key)
  SELECT DISTINCT t.user_id, s.brand_id, _kind, _title,
         _who || ': ' || COALESCE(pst.title, 'post'),
         '/customers/' || s.client_id::text,
         jsonb_build_object('source','portal_decision','post_id', _post_id,
                            'client_id', s.client_id, 'decision', _decision, 'by', _who),
         _dedupe
    FROM (
      SELECT c.owner_user_id AS user_id
        FROM public.clients c
       WHERE c.id = s.client_id AND c.owner_user_id IS NOT NULL
      UNION
      SELECT cm.user_id
        FROM public.client_members cm
       WHERE cm.client_id = s.client_id AND cm.role <> 'portal_client'
      UNION
      SELECT bm.user_id
        FROM public.brand_members bm
       WHERE bm.brand_id = s.brand_id
         AND bm.role::text <> 'portal_client'
    ) t
   WHERE t.user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.brand_members bm2
                  WHERE bm2.brand_id = s.brand_id AND bm2.user_id = t.user_id
                    AND bm2.role::text <> 'portal_client')
  ON CONFLICT (user_id, kind, dedupe_key)
    WHERE read_at IS NULL AND dedupe_key IS NOT NULL
    DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END $function$;