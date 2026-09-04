-- FASE 10F.2 — hardening das superfícies públicas (idempotente)

-- 1) Rate limit genérico para superfícies públicas (reusa portal_rate_limit)
CREATE OR REPLACE FUNCTION public.public_surface_rate_hit(
  _key text,
  _max integer DEFAULT 30,
  _window_seconds integer DEFAULT 300,
  _block_seconds integer DEFAULT 600
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  win interval := make_interval(secs => GREATEST(_window_seconds, 1));
  blk interval := make_interval(secs => GREATEST(_block_seconds, 1));
BEGIN
  IF _key IS NULL OR length(_key) < 8 THEN
    RETURN jsonb_build_object('blocked', false, 'retry_after', 0);
  END IF;

  SELECT * INTO r FROM public.portal_rate_limit WHERE ip_hash = _key FOR UPDATE;
  IF FOUND AND r.blocked_until IS NOT NULL AND r.blocked_until > now() THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'retry_after', ceil(extract(epoch FROM (r.blocked_until - now())))::int
    );
  END IF;

  INSERT INTO public.portal_rate_limit (ip_hash, window_start, fail_count)
  VALUES (_key, now(), 1)
  ON CONFLICT (ip_hash) DO UPDATE
    SET fail_count = CASE
          WHEN public.portal_rate_limit.window_start < now() - win THEN 1
          ELSE public.portal_rate_limit.fail_count + 1
        END,
        window_start = CASE
          WHEN public.portal_rate_limit.window_start < now() - win THEN now()
          ELSE public.portal_rate_limit.window_start
        END,
        blocked_until = CASE
          WHEN public.portal_rate_limit.blocked_until IS NOT NULL
           AND public.portal_rate_limit.blocked_until <= now() THEN NULL
          ELSE public.portal_rate_limit.blocked_until
        END,
        updated_at = now()
  RETURNING * INTO r;

  IF r.fail_count > _max THEN
    UPDATE public.portal_rate_limit
       SET blocked_until = now() + blk, updated_at = now()
     WHERE ip_hash = _key;
    RETURN jsonb_build_object('blocked', true, 'retry_after', GREATEST(_block_seconds, 1));
  END IF;

  RETURN jsonb_build_object('blocked', false, 'retry_after', 0, 'count', r.fail_count);
END $$;

REVOKE ALL ON FUNCTION public.public_surface_rate_hit(text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_surface_rate_hit(text, integer, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_surface_rate_hit(text, integer, integer, integer) TO service_role;

-- 2) Decisão pública de aprovação: transacional, single-decision, anti-replay
CREATE OR REPLACE FUNCTION public.card_approval_public_decide(
  _token text,
  _verb text,
  _comment text DEFAULT NULL,
  _ip text DEFAULT NULL,
  _ua text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t record;
  p record;
BEGIN
  IF _verb IS NULL OR _verb NOT IN ('approved', 'changes_requested') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_verb', 'status', 400);
  END IF;
  IF _token IS NULL OR length(_token) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token', 'status', 404);
  END IF;

  SELECT * INTO t
    FROM public.card_approval_tokens
   WHERE token = _token
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token', 'status', 404);
  END IF;
  IF t.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token_used_or_revoked', 'status', 410);
  END IF;
  IF t.expires_at IS NOT NULL AND t.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token_expired', 'status', 410);
  END IF;

  SELECT id, brand_id, client_id, review_status, deleted_at
    INTO p
    FROM public.posts
   WHERE id = t.post_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'post_not_found', 'status', 404);
  END IF;
  IF p.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'post_deleted', 'status', 410);
  END IF;
  IF p.brand_id IS DISTINCT FROM t.brand_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'scope_mismatch', 'status', 403);
  END IF;
  IF p.review_status IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_decided', 'status', 409);
  END IF;

  INSERT INTO public.card_approval_events (post_id, token_id, brand_id, verb, comment, ip, user_agent)
  VALUES (
    p.id, t.id, t.brand_id, _verb,
    NULLIF(left(COALESCE(_comment, ''), 2000), ''),
    CASE WHEN _ip IS NULL OR _ip = '' THEN NULL ELSE _ip::inet END,
    NULLIF(left(COALESCE(_ua, ''), 500), '')
  );

  IF _verb = 'approved' THEN
    UPDATE public.posts
       SET review_status = 'approved', approved_at = now()
     WHERE id = p.id;
  ELSE
    UPDATE public.posts
       SET review_status = 'rework',
           rework_notes = NULLIF(left(COALESCE(_comment, ''), 2000), '')
     WHERE id = p.id;
  END IF;

  -- Single-decision: o link deixa de ser reutilizável após uma decisão válida.
  UPDATE public.card_approval_tokens
     SET revoked_at = now()
   WHERE id = t.id;

  RETURN jsonb_build_object('ok', true, 'verb', _verb);
END $$;

REVOKE ALL ON FUNCTION public.card_approval_public_decide(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.card_approval_public_decide(text, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_approval_public_decide(text, text, text, text, text) TO service_role;