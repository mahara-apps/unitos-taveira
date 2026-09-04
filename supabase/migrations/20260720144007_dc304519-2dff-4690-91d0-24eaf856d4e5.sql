
ALTER TABLE public.brand_ai_usage
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS brand_ai_usage_brand_created_idx
  ON public.brand_ai_usage(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brand_ai_usage_brand_client_created_idx
  ON public.brand_ai_usage(brand_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brand_ai_usage_brand_actor_created_idx
  ON public.brand_ai_usage(brand_id, actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_usage_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('brand','client','user')),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  period text NOT NULL DEFAULT 'monthly' CHECK (period IN ('monthly')),
  limit_usd numeric(12,4) NOT NULL CHECK (limit_usd >= 0),
  hard_stop boolean NOT NULL DEFAULT true,
  notify_at_pct int NOT NULL DEFAULT 80 CHECK (notify_at_pct BETWEEN 1 AND 100),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_limits_scope_shape CHECK (
    (scope = 'brand'  AND client_id IS NULL AND user_id IS NULL)
    OR (scope = 'client' AND client_id IS NOT NULL AND user_id IS NULL)
    OR (scope = 'user'   AND user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_limits_brand_unique
  ON public.ai_usage_limits(brand_id) WHERE scope = 'brand';
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_limits_client_unique
  ON public.ai_usage_limits(brand_id, client_id) WHERE scope = 'client';
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_limits_user_unique
  ON public.ai_usage_limits(brand_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), user_id) WHERE scope = 'user';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_usage_limits TO authenticated;
GRANT ALL ON public.ai_usage_limits TO service_role;

ALTER TABLE public.ai_usage_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_brand_ai_limits(_brand_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_members m
       WHERE m.brand_id = _brand_id AND m.user_id = _user_id
         AND m.role IN ('owner','manager')
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_brand_ai_limits(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_brand_ai_limits(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "ai_usage_limits_manage" ON public.ai_usage_limits;
CREATE POLICY "ai_usage_limits_manage"
  ON public.ai_usage_limits
  FOR ALL
  TO authenticated
  USING (public.can_manage_brand_ai_limits(brand_id, auth.uid()))
  WITH CHECK (public.can_manage_brand_ai_limits(brand_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_ai_usage_limits_touch()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS ai_usage_limits_touch ON public.ai_usage_limits;
CREATE TRIGGER ai_usage_limits_touch BEFORE UPDATE ON public.ai_usage_limits
  FOR EACH ROW EXECUTE FUNCTION public.tg_ai_usage_limits_touch();

CREATE OR REPLACE FUNCTION public.check_ai_usage_budget(
  _brand_id uuid,
  _client_id uuid,
  _user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  period_start timestamptz := date_trunc('month', now());
  brand_lim   record;
  client_lim  record;
  user_lim    record;
  brand_spent numeric := 0;
  client_spent numeric := 0;
  user_spent  numeric := 0;
BEGIN
  SELECT * INTO brand_lim FROM public.ai_usage_limits
   WHERE brand_id = _brand_id AND scope = 'brand' LIMIT 1;
  IF _client_id IS NOT NULL THEN
    SELECT * INTO client_lim FROM public.ai_usage_limits
     WHERE brand_id = _brand_id AND scope = 'client' AND client_id = _client_id LIMIT 1;
  END IF;
  IF _user_id IS NOT NULL THEN
    SELECT * INTO user_lim FROM public.ai_usage_limits
     WHERE brand_id = _brand_id AND scope = 'user' AND user_id = _user_id
       AND (client_id IS NULL OR client_id = _client_id)
     ORDER BY (client_id IS NOT NULL) DESC LIMIT 1;
  END IF;

  SELECT COALESCE(SUM(cost_usd),0) INTO brand_spent FROM public.brand_ai_usage
    WHERE brand_id = _brand_id AND created_at >= period_start;
  IF _client_id IS NOT NULL THEN
    SELECT COALESCE(SUM(cost_usd),0) INTO client_spent FROM public.brand_ai_usage
      WHERE brand_id = _brand_id AND client_id = _client_id AND created_at >= period_start;
  END IF;
  IF _user_id IS NOT NULL THEN
    SELECT COALESCE(SUM(cost_usd),0) INTO user_spent FROM public.brand_ai_usage
      WHERE brand_id = _brand_id AND actor_id = _user_id AND created_at >= period_start;
  END IF;

  IF user_lim.id IS NOT NULL AND user_lim.hard_stop AND user_spent >= user_lim.limit_usd THEN
    RETURN jsonb_build_object('allowed', false, 'blocked_by','user',
      'spent_usd', user_spent, 'limit_usd', user_lim.limit_usd);
  END IF;
  IF client_lim.id IS NOT NULL AND client_lim.hard_stop AND client_spent >= client_lim.limit_usd THEN
    RETURN jsonb_build_object('allowed', false, 'blocked_by','client',
      'spent_usd', client_spent, 'limit_usd', client_lim.limit_usd);
  END IF;
  IF brand_lim.id IS NOT NULL AND brand_lim.hard_stop AND brand_spent >= brand_lim.limit_usd THEN
    RETURN jsonb_build_object('allowed', false, 'blocked_by','brand',
      'spent_usd', brand_spent, 'limit_usd', brand_lim.limit_usd);
  END IF;

  RETURN jsonb_build_object('allowed', true,
    'brand', jsonb_build_object('spent', brand_spent, 'limit', brand_lim.limit_usd),
    'client', jsonb_build_object('spent', client_spent, 'limit', client_lim.limit_usd),
    'user', jsonb_build_object('spent', user_spent, 'limit', user_lim.limit_usd));
END; $$;

REVOKE ALL ON FUNCTION public.check_ai_usage_budget(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_ai_usage_budget(uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_ai_usage_overview(
  _brand_id uuid,
  _period_start timestamptz DEFAULT date_trunc('month', now()),
  _period_end   timestamptz DEFAULT (date_trunc('month', now()) + interval '1 month')
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  brand_spent numeric := 0;
  brand_limit numeric;
  brand_hard boolean;
  brand_notify int;
BEGIN
  IF NOT public.can_manage_brand_ai_limits(_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(cost_usd),0) INTO brand_spent
    FROM public.brand_ai_usage
   WHERE brand_id = _brand_id
     AND created_at >= _period_start AND created_at < _period_end;

  SELECT limit_usd, hard_stop, notify_at_pct
    INTO brand_limit, brand_hard, brand_notify
    FROM public.ai_usage_limits
   WHERE brand_id = _brand_id AND scope = 'brand' LIMIT 1;

  result := jsonb_build_object(
    'brand', jsonb_build_object(
      'spent', brand_spent,
      'limit', brand_limit,
      'hard_stop', brand_hard,
      'notify_at_pct', brand_notify
    ),
    'clients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'client_id', c.id,
        'client_name', c.name,
        'spent', COALESCE(u.spent, 0),
        'limit', l.limit_usd,
        'hard_stop', l.hard_stop,
        'notify_at_pct', l.notify_at_pct,
        'limit_id', l.id
      ) ORDER BY COALESCE(u.spent, 0) DESC)
      FROM public.clients c
      LEFT JOIN (
        SELECT client_id, SUM(cost_usd) AS spent
          FROM public.brand_ai_usage
         WHERE brand_id = _brand_id AND client_id IS NOT NULL
           AND created_at >= _period_start AND created_at < _period_end
         GROUP BY client_id
      ) u ON u.client_id = c.id
      LEFT JOIN public.ai_usage_limits l
        ON l.brand_id = _brand_id AND l.scope='client' AND l.client_id = c.id
     WHERE c.brand_id = _brand_id
    ), '[]'::jsonb),
    'unassigned_client_spent', COALESCE((
      SELECT SUM(cost_usd) FROM public.brand_ai_usage
       WHERE brand_id = _brand_id AND client_id IS NULL
         AND created_at >= _period_start AND created_at < _period_end
    ), 0),
    'users', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', u.actor_id,
        'client_id', u.client_id,
        'display_name', p.display_name,
        'email', p.email,
        'spent', u.spent,
        'limit', l.limit_usd,
        'hard_stop', l.hard_stop,
        'notify_at_pct', l.notify_at_pct,
        'limit_id', l.id
      ) ORDER BY u.spent DESC)
      FROM (
        SELECT actor_id, client_id, SUM(cost_usd) AS spent
          FROM public.brand_ai_usage
         WHERE brand_id = _brand_id AND actor_id IS NOT NULL
           AND created_at >= _period_start AND created_at < _period_end
         GROUP BY actor_id, client_id
      ) u
      LEFT JOIN public.user_profiles p ON p.user_id = u.actor_id
      LEFT JOIN public.ai_usage_limits l
        ON l.brand_id = _brand_id AND l.scope='user' AND l.user_id = u.actor_id
       AND (l.client_id IS NULL OR l.client_id = u.client_id)
    ), '[]'::jsonb)
  );

  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.list_ai_usage_overview(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_ai_usage_overview(uuid, timestamptz, timestamptz) TO authenticated, service_role;
