CREATE TABLE IF NOT EXISTS public.portal_rate_limit (
  ip_hash text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  fail_count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.portal_rate_limit TO service_role;
ALTER TABLE public.portal_rate_limit ENABLE ROW LEVEL SECURITY;
-- Nenhuma policy: acesso somente via funções SECURITY DEFINER abaixo.

CREATE INDEX IF NOT EXISTS portal_rate_limit_updated_idx ON public.portal_rate_limit (updated_at);

CREATE OR REPLACE FUNCTION public.portal_rate_status(_ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  IF _ip_hash IS NULL OR length(_ip_hash) < 8 THEN
    RETURN jsonb_build_object('blocked', false, 'retry_after', 0);
  END IF;
  SELECT * INTO r FROM public.portal_rate_limit WHERE ip_hash = _ip_hash;
  IF NOT FOUND OR r.blocked_until IS NULL OR r.blocked_until <= now() THEN
    RETURN jsonb_build_object('blocked', false, 'retry_after', 0);
  END IF;
  RETURN jsonb_build_object(
    'blocked', true,
    'retry_after', ceil(extract(epoch FROM (r.blocked_until - now())))::int
  );
END $$;

CREATE OR REPLACE FUNCTION public.portal_rate_register_failure(_ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  _max_fails constant int := 10;
  _window constant interval := interval '1 minute';
  _block constant interval := interval '15 minutes';
BEGIN
  IF _ip_hash IS NULL OR length(_ip_hash) < 8 THEN
    RETURN jsonb_build_object('blocked', false, 'retry_after', 0);
  END IF;

  INSERT INTO public.portal_rate_limit (ip_hash, window_start, fail_count)
  VALUES (_ip_hash, now(), 1)
  ON CONFLICT (ip_hash) DO UPDATE
    SET fail_count = CASE
          WHEN public.portal_rate_limit.window_start < now() - _window THEN 1
          ELSE public.portal_rate_limit.fail_count + 1
        END,
        window_start = CASE
          WHEN public.portal_rate_limit.window_start < now() - _window THEN now()
          ELSE public.portal_rate_limit.window_start
        END,
        updated_at = now()
  RETURNING * INTO r;

  IF r.fail_count >= _max_fails THEN
    UPDATE public.portal_rate_limit
       SET blocked_until = now() + _block, updated_at = now()
     WHERE ip_hash = _ip_hash
     RETURNING * INTO r;
  END IF;

  -- limpeza oportunista
  DELETE FROM public.portal_rate_limit
   WHERE updated_at < now() - interval '1 day'
     AND (blocked_until IS NULL OR blocked_until < now());

  RETURN jsonb_build_object(
    'blocked', r.blocked_until IS NOT NULL AND r.blocked_until > now(),
    'retry_after', GREATEST(0, ceil(extract(epoch FROM (COALESCE(r.blocked_until, now()) - now())))::int)
  );
END $$;

REVOKE ALL ON FUNCTION public.portal_rate_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_rate_register_failure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_rate_status(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_rate_register_failure(text) TO anon, authenticated, service_role;

-- last_seen_at condicional (no máximo a cada 5 minutos)
CREATE OR REPLACE FUNCTION public._portal_session(_token text)
 RETURNS TABLE(client_id uuid, brand_id uuid, token_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  SELECT pt.id, pt.client_id, pt.revoked_at, pt.expires_at, pt.last_seen_at, c.brand_id
    INTO r
    FROM public.portal_tokens pt
    JOIN public.clients c ON c.id = pt.client_id
   WHERE pt.token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF r.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'token_revoked'; END IF;
  IF r.expires_at IS NOT NULL AND r.expires_at < now() THEN RAISE EXCEPTION 'token_expired'; END IF;
  IF r.last_seen_at IS NULL OR r.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE public.portal_tokens SET last_seen_at = now() WHERE id = r.id;
  END IF;
  client_id := r.client_id; brand_id := r.brand_id; token_id := r.id;
  RETURN NEXT;
END $function$;