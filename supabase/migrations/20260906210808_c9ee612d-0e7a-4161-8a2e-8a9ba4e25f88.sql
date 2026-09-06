ALTER TABLE public.brand_members
  ADD COLUMN IF NOT EXISTS hourly_cost_cents integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS task_time_entries_brand_started_idx
  ON public.task_time_entries (brand_id, started_at DESC);
CREATE INDEX IF NOT EXISTS task_time_entries_brand_user_started_idx
  ON public.task_time_entries (brand_id, user_id, started_at DESC);

CREATE OR REPLACE FUNCTION public.timesheet_report_entries(
  _brand_id uuid,
  _from timestamptz,
  _to timestamptz
)
RETURNS TABLE (
  entry_id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  seconds integer,
  is_rework boolean,
  source text,
  description text,
  user_id uuid,
  user_name text,
  user_email text,
  avatar_url text,
  hourly_cost_cents integer,
  task_id uuid,
  task_title text,
  task_estimated_minutes integer,
  project_id uuid,
  project_name text,
  client_id uuid,
  client_name text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _can_cost boolean;
BEGIN
  IF _uid IS NULL OR _brand_id IS NULL THEN
    RETURN;
  END IF;

  _role := public.app_access_role(_uid, _brand_id);

  IF _role IS NULL OR _role = 'client' THEN
    RETURN;
  END IF;

  _can_cost := _role IN ('super_admin', 'admin', 'manager');

  RETURN QUERY
  SELECT
    e.id,
    e.started_at,
    e.ended_at,
    COALESCE(e.seconds, COALESCE(e.minutes, 0) * 60)::int,
    COALESCE(e.is_rework, false),
    COALESCE(e.source, 'timer')::text,
    e.description,
    e.user_id,
    COALESCE(p.full_name, '')::text,
    COALESCE(p.email, '')::text,
    p.avatar_url,
    CASE WHEN _can_cost THEN COALESCE(bm.hourly_cost_cents, 0) ELSE 0 END::int,
    t.id,
    t.title,
    t.estimated_minutes,
    t.project_id,
    pr.name,
    t.client_id,
    c.name
  FROM public.task_time_entries e
  JOIN public.tasks t ON t.id = e.task_id
  LEFT JOIN public.projects pr ON pr.id = t.project_id
  LEFT JOIN public.clients c ON c.id = t.client_id
  LEFT JOIN public.user_profiles p ON p.id = e.user_id
  LEFT JOIN public.brand_members bm ON bm.brand_id = e.brand_id AND bm.user_id = e.user_id
  WHERE e.brand_id = _brand_id
    AND e.ended_at IS NOT NULL
    AND e.started_at >= _from
    AND e.started_at <= _to
    AND (
      _role IN ('super_admin', 'admin')
      OR (_role = 'manager' AND t.client_id IS NOT NULL AND public.can_access_client(t.client_id, _uid))
      OR e.user_id = _uid
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.timesheet_report_entries(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.timesheet_report_entries(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.timesheet_report_entries(uuid, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.set_member_hourly_cost(
  _brand_id uuid,
  _user_id uuid,
  _hourly_cost_cents integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  _role := public.app_access_role(_uid, _brand_id);
  IF _role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _hourly_cost_cents IS NULL OR _hourly_cost_cents < 0 THEN
    RAISE EXCEPTION 'invalid hourly cost';
  END IF;

  UPDATE public.brand_members
     SET hourly_cost_cents = _hourly_cost_cents
   WHERE brand_id = _brand_id AND user_id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found';
  END IF;

  RETURN _hourly_cost_cents;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_member_hourly_cost(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_hourly_cost(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_hourly_cost(uuid, uuid, integer) TO service_role;