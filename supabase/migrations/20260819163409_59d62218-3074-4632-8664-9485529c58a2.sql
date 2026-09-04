CREATE OR REPLACE FUNCTION public.my_access(_brand_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT auth.uid() AS uid
  ), su AS (
    SELECT public.is_super_admin((SELECT uid FROM me)) AS is_su
  ), role AS (
    SELECT public.app_access_role((SELECT uid FROM me), _brand_id) AS r
  )
  SELECT jsonb_build_object(
    'user_id', (SELECT uid FROM me),
    'brand_id', _brand_id,
    'role', (SELECT r FROM role),
    'is_super_admin', (SELECT is_su FROM su),
    'brand_role', (SELECT bm.role::text FROM public.brand_members bm
                    WHERE bm.user_id = (SELECT uid FROM me)
                      AND bm.is_active
                      AND (_brand_id IS NULL OR bm.brand_id = _brand_id)
                    LIMIT 1),
    'client_ids', COALESCE((
      SELECT jsonb_agg(c.id)
        FROM public.clients c
       WHERE (_brand_id IS NULL OR c.brand_id = _brand_id)
         AND (
           (SELECT is_su FROM su)
           OR (
             EXISTS (
               SELECT 1 FROM public.brand_members bm
                WHERE bm.brand_id = c.brand_id
                  AND bm.user_id = (SELECT uid FROM me)
                  AND bm.is_active
             )
             AND (
               (SELECT r FROM role) IN ('admin', 'manager')
               OR c.owner_user_id = (SELECT uid FROM me)
               OR EXISTS (
                 SELECT 1 FROM public.client_members cm
                  WHERE cm.client_id = c.id
                    AND cm.user_id = (SELECT uid FROM me)
                    AND cm.role <> 'portal_client'
               )
             )
           )
         )
    ), '[]'::jsonb),
    'brand_ids', COALESCE((
      SELECT jsonb_agg(bm.brand_id) FROM public.brand_members bm
       WHERE bm.user_id = (SELECT uid FROM me) AND bm.is_active
    ), '[]'::jsonb)
  );
$function$;

CREATE INDEX IF NOT EXISTS idx_activity_events_client_id ON public.activity_events(client_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_client_id ON public.ai_jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_brain_memory_client_id ON public.brain_memory(client_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_client_id ON public.calendar_events(client_id);
CREATE INDEX IF NOT EXISTS idx_brand_ai_content_brand_id ON public.brand_ai_content(brand_id);
CREATE INDEX IF NOT EXISTS idx_client_social_accounts_brand_id ON public.client_social_accounts(brand_id);
CREATE INDEX IF NOT EXISTS idx_client_members_user_role ON public.client_members(user_id, role);
