-- ============================================================
-- BLINDAGEM DO PORTAL DO CLIENTE
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_portal_client_of(_client_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _client_id IS NOT NULL AND _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.client_members
     WHERE client_id = _client_id AND user_id = _user_id AND role = 'portal_client'
  );
$$;

REVOKE ALL ON FUNCTION public.is_portal_client_of(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_portal_client_of(uuid, uuid) TO authenticated, service_role;

-- ---------------- POSTS ----------------
DROP POLICY IF EXISTS "brand members manage posts" ON public.posts;

CREATE POLICY "posts read scoped"
  ON public.posts FOR SELECT TO authenticated
  USING (
    public.can_access_client(client_id, auth.uid())
    AND (
      public.is_agency_operator(auth.uid(), brand_id)
      OR (visible_in_portal IS TRUE AND deleted_at IS NULL)
    )
  );

CREATE POLICY "posts insert agency only"
  ON public.posts FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_client(client_id, auth.uid())
    AND public.is_agency_operator(auth.uid(), brand_id)
  );

CREATE POLICY "posts update agency only"
  ON public.posts FOR UPDATE TO authenticated
  USING (
    public.can_access_client(client_id, auth.uid())
    AND public.is_agency_operator(auth.uid(), brand_id)
  )
  WITH CHECK (
    public.can_access_client(client_id, auth.uid())
    AND public.is_agency_operator(auth.uid(), brand_id)
  );

CREATE POLICY "posts delete agency only"
  ON public.posts FOR DELETE TO authenticated
  USING (
    public.can_access_client(client_id, auth.uid())
    AND public.is_agency_operator(auth.uid(), brand_id)
  );

-- ---------------- POST_APPROVALS ----------------
DROP POLICY IF EXISTS "brand members manage approvals" ON public.post_approvals;

CREATE POLICY "approvals read scoped"
  ON public.post_approvals FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.posts p
     WHERE p.id = post_approvals.post_id
       AND public.can_access_client(p.client_id, auth.uid())
       AND (
         public.is_agency_operator(auth.uid(), p.brand_id)
         OR (p.visible_in_portal IS TRUE AND p.deleted_at IS NULL)
       )
  ));

CREATE POLICY "approvals insert agency only"
  ON public.post_approvals FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.posts p
     WHERE p.id = post_approvals.post_id
       AND public.can_access_client(p.client_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), p.brand_id)
  ));

CREATE POLICY "approvals update agency only"
  ON public.post_approvals FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.posts p
     WHERE p.id = post_approvals.post_id
       AND public.can_access_client(p.client_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), p.brand_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.posts p
     WHERE p.id = post_approvals.post_id
       AND public.can_access_client(p.client_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), p.brand_id)
  ));

CREATE POLICY "approvals delete agency only"
  ON public.post_approvals FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.posts p
     WHERE p.id = post_approvals.post_id
       AND public.can_access_client(p.client_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), p.brand_id)
  ));

-- ---------------- MONTHLY_PLANS ----------------
DROP POLICY IF EXISTS "Client members access monthly_plans" ON public.monthly_plans;

CREATE POLICY "plans read scoped"
  ON public.monthly_plans FOR SELECT TO authenticated
  USING (public.can_access_client(client_id, auth.uid()));

CREATE POLICY "plans insert agency only"
  ON public.monthly_plans FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_client(client_id, auth.uid())
    AND public.is_agency_operator(auth.uid(), brand_id)
  );

CREATE POLICY "plans update agency only"
  ON public.monthly_plans FOR UPDATE TO authenticated
  USING (
    public.can_access_client(client_id, auth.uid())
    AND public.is_agency_operator(auth.uid(), brand_id)
  )
  WITH CHECK (
    public.can_access_client(client_id, auth.uid())
    AND public.is_agency_operator(auth.uid(), brand_id)
  );

CREATE POLICY "plans delete agency only"
  ON public.monthly_plans FOR DELETE TO authenticated
  USING (
    public.can_access_client(client_id, auth.uid())
    AND public.is_agency_operator(auth.uid(), brand_id)
  );

-- ---------------- MONTHLY_PLAN_TOPICS ----------------
DROP POLICY IF EXISTS "Brand members can insert monthly_plan_topics" ON public.monthly_plan_topics;
DROP POLICY IF EXISTS "Brand members can update monthly_plan_topics" ON public.monthly_plan_topics;
DROP POLICY IF EXISTS "Brand members can delete monthly_plan_topics" ON public.monthly_plan_topics;

CREATE POLICY "topics insert agency only"
  ON public.monthly_plan_topics FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
     WHERE mp.id = monthly_plan_topics.monthly_plan_id
       AND public.is_brand_member(mp.brand_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), mp.brand_id)
  ));

CREATE POLICY "topics update agency only"
  ON public.monthly_plan_topics FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
     WHERE mp.id = monthly_plan_topics.monthly_plan_id
       AND public.is_brand_member(mp.brand_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), mp.brand_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
     WHERE mp.id = monthly_plan_topics.monthly_plan_id
       AND public.is_brand_member(mp.brand_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), mp.brand_id)
  ));

CREATE POLICY "topics delete agency only"
  ON public.monthly_plan_topics FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
     WHERE mp.id = monthly_plan_topics.monthly_plan_id
       AND public.is_brand_member(mp.brand_id, auth.uid())
       AND public.is_agency_operator(auth.uid(), mp.brand_id)
  ));

-- ---------------- SESSÃO MULTI-CLIENTE ----------------
DROP FUNCTION IF EXISTS public._portal_session_user();
DROP FUNCTION IF EXISTS public._portal_session_any(text);

CREATE FUNCTION public._portal_session_user(_client_id uuid DEFAULT NULL)
RETURNS TABLE(client_id uuid, brand_id uuid, token_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;

  IF _client_id IS NOT NULL THEN
    SELECT cm.id, cm.client_id, cm.brand_id, cm.last_seen_at
      INTO r
      FROM public.client_members cm
     WHERE cm.user_id = uid AND cm.role = 'portal_client' AND cm.client_id = _client_id
     LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'client_not_allowed'; END IF;
  ELSE
    SELECT cm.id, cm.client_id, cm.brand_id, cm.last_seen_at
      INTO r
      FROM public.client_members cm
     WHERE cm.user_id = uid AND cm.role = 'portal_client'
     ORDER BY cm.last_seen_at DESC NULLS LAST, cm.created_at
     LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  END IF;

  IF r.last_seen_at IS NULL OR r.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE public.client_members SET last_seen_at = now() WHERE id = r.id;
  END IF;
  client_id := r.client_id; brand_id := r.brand_id; token_id := NULL;
  RETURN NEXT;
END $$;

CREATE FUNCTION public._portal_session_any(_token text DEFAULT NULL, _client_id uuid DEFAULT NULL)
RETURNS TABLE(client_id uuid, brand_id uuid, token_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _token IS NULL OR length(trim(_token)) = 0 THEN
    RETURN QUERY SELECT * FROM public._portal_session_user(_client_id);
  ELSE
    RETURN QUERY SELECT * FROM public._portal_session(_token);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._portal_session_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._portal_session_any(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._portal_session_user(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._portal_session_any(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.portal_my_clients()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
    SELECT cm.client_id, cm.brand_id, c.name AS client_name, b.name AS brand_name
      FROM public.client_members cm
      JOIN public.clients c ON c.id = cm.client_id
      JOIN public.brands b ON b.id = cm.brand_id
     WHERE cm.user_id = auth.uid() AND cm.role = 'portal_client'
     ORDER BY c.name
  ) x;
$$;

REVOKE ALL ON FUNCTION public.portal_my_clients() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_my_clients() TO authenticated, service_role;

-- ---------------- RPCs DO PORTAL ----------------
DROP FUNCTION IF EXISTS public.portal_resolve(text);
CREATE FUNCTION public.portal_resolve(_token text DEFAULT NULL, _client_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE s record; res jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  SELECT jsonb_build_object(
    'clientId', s.client_id,
    'brandId', s.brand_id,
    'client', jsonb_build_object(
      'id', cl.id,
      'name', cl.name,
      'niche', cl.niche,
      'color', cl.color,
      'socials', cl.socials,
      'contact_name', cl.contact_name,
      'contact_email', cl.contact_email,
      'logo_url', cl.logo_url,
      'portal_theme', cl.portal_theme
    ),
    'brand', jsonb_build_object('id', b.id, 'name', b.name)
  ) INTO res
  FROM public.clients cl, public.brands b
  WHERE cl.id = s.client_id AND b.id = s.brand_id;
  RETURN res;
END $$;

DROP FUNCTION IF EXISTS public.portal_metrics(text);
CREATE FUNCTION public.portal_metrics(_token text DEFAULT NULL, _client_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE s record; month_start timestamptz := date_trunc('month', now());
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  RETURN (
    WITH p AS (
      SELECT id, stage, scheduled_at, published_at, approved_at
        FROM public.posts
       WHERE brand_id = s.brand_id AND client_id = s.client_id
         AND visible_in_portal = true AND deleted_at IS NULL
    ),
    a AS (
      SELECT post_id, status FROM public.post_approvals WHERE post_id IN (SELECT id FROM p)
    )
    SELECT jsonb_build_object(
      'pending', (
        SELECT count(*) FROM p LEFT JOIN a ON a.post_id = p.id
         WHERE a.status IS NULL OR a.status = 'pending'
      ),
      'approvedThisMonth', (SELECT count(*) FROM p WHERE approved_at >= month_start),
      'scheduled', (SELECT count(*) FROM p WHERE stage = 'scheduled' OR (scheduled_at IS NOT NULL AND published_at IS NULL)),
      'total', (SELECT count(*) FROM p)
    )
  );
END $$;

DROP FUNCTION IF EXISTS public.portal_approvals(text, text);
CREATE FUNCTION public.portal_approvals(_token text DEFAULT NULL, _status text DEFAULT 'all', _client_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE s record; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO rows FROM (
    SELECT
      p.id, p.title, p.format, p.channels, p.scheduled_at, p.published_at, p.cover_url,
      p.reference_media, p.stage,
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
END $$;

DROP FUNCTION IF EXISTS public.portal_post(text, uuid);
CREATE FUNCTION public.portal_post(_token text DEFAULT NULL, _post_id uuid DEFAULT NULL, _client_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE s record; post_row jsonb; apprv jsonb;
BEGIN
  IF _post_id IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  SELECT to_jsonb(p) INTO post_row FROM (
    SELECT id, title, copy, format, channels, scheduled_at, published_at, cover_url,
           reference_media, script, stage
      FROM public.posts
     WHERE id = _post_id AND brand_id = s.brand_id AND client_id = s.client_id
       AND visible_in_portal = true AND deleted_at IS NULL
  ) p;
  IF post_row IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
  SELECT to_jsonb(a) INTO apprv FROM (
    SELECT status::text, notes, decided_at, decided_by_name
      FROM public.post_approvals WHERE post_id = _post_id
  ) a;
  RETURN jsonb_build_object('post', post_row, 'approval', apprv);
END $$;

DROP FUNCTION IF EXISTS public.portal_calendar(text, text);
CREATE FUNCTION public.portal_calendar(_token text DEFAULT NULL, _month text DEFAULT NULL, _client_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE s record; m_start timestamptz; m_end timestamptz; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
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
END $$;

DROP FUNCTION IF EXISTS public.portal_files(text, text);
CREATE FUNCTION public.portal_files(_token text DEFAULT NULL, _search text DEFAULT NULL, _client_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE s record; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO rows FROM (
    SELECT id, name, storage_path, mime_type, size_bytes, created_at
      FROM public.client_documents
     WHERE brand_id = s.brand_id AND client_id = s.client_id
       AND visible_to_client IS TRUE
       AND (_search IS NULL OR name ILIKE '%' || _search || '%')
     ORDER BY created_at DESC
  ) x;
  RETURN rows;
END $$;

DROP FUNCTION IF EXISTS public.portal_briefings(text);
CREATE FUNCTION public.portal_briefings(_token text DEFAULT NULL, _client_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE s record; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO rows FROM (
    SELECT id, token, label, expires_at, revoked_at, submitted_at, created_at
      FROM public.client_briefing_tokens
     WHERE brand_id = s.brand_id AND client_id = s.client_id
     ORDER BY created_at DESC
  ) x;
  RETURN rows;
END $$;

-- ---------------- DECISÃO ----------------
DROP FUNCTION IF EXISTS public.portal_decide(text, uuid, text, text, text);
CREATE FUNCTION public.portal_decide(
  _token text DEFAULT NULL,
  _post_id uuid DEFAULT NULL,
  _decision text DEFAULT NULL,
  _note text DEFAULT NULL,
  _identity text DEFAULT NULL,
  _client_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s record; pst record; existing_id uuid; now_ts timestamptz := now();
  _kind public.notification_kind;
  _title text;
  _session_mode boolean := (_token IS NULL OR length(trim(_token)) = 0);
  _uid uuid;
  _who text;
  _dedupe text;
BEGIN
  IF _decision NOT IN ('approved','rejected','adjust','comment') THEN RAISE EXCEPTION 'bad_decision'; END IF;
  IF _post_id IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
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
          jsonb_build_object('note', COALESCE(_note,''), 'by', _who, 'title', pst.title,
                             'mode', CASE WHEN _session_mode THEN 'login' ELSE 'token' END));

  _kind := CASE WHEN _decision = 'comment' THEN 'mention'::public.notification_kind ELSE 'approval_decision'::public.notification_kind END;
  _title := CASE _decision
      WHEN 'approved' THEN 'Cliente aprovou um post'
      WHEN 'rejected' THEN 'Cliente rejeitou um post'
      WHEN 'adjust'   THEN 'Cliente pediu ajustes'
      ELSE 'Cliente comentou um post'
    END;

  _dedupe := 'portal_decision:' || _post_id::text || ':' || _decision || ':'
             || to_char(now_ts, 'YYYYMMDDHH24MI');

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
       WHERE bm.brand_id = s.brand_id AND bm.role IN ('owner', 'manager')
    ) t
   WHERE t.user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.brand_members bm2
                  WHERE bm2.brand_id = s.brand_id AND bm2.user_id = t.user_id)
  ON CONFLICT (user_id, kind, dedupe_key) WHERE read_at IS NULL DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.portal_resolve(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_metrics(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_approvals(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_post(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_calendar(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_files(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_briefings(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_decide(text, uuid, text, text, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.portal_resolve(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_metrics(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_approvals(text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_post(text, uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_calendar(text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_files(text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_briefings(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_decide(text, uuid, text, text, text, uuid) TO anon, authenticated, service_role;