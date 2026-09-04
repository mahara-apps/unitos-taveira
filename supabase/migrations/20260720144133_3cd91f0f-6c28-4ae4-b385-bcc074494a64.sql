
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
        'display_name', p.full_name,
        'email', au.email,
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
      LEFT JOIN public.user_profiles p ON p.id = u.actor_id
      LEFT JOIN auth.users au ON au.id = u.actor_id
      LEFT JOIN public.ai_usage_limits l
        ON l.brand_id = _brand_id AND l.scope='user' AND l.user_id = u.actor_id
       AND (l.client_id IS NULL OR l.client_id = u.client_id)
    ), '[]'::jsonb)
  );

  RETURN result;
END; $$;
