-- 1) Fix calendar_events RLS: is_brand_member(_brand_id, _user_id) — arguments were swapped
DROP POLICY IF EXISTS "calendar_events_select_global_or_member" ON public.calendar_events;
DROP POLICY IF EXISTS "calendar_events_insert" ON public.calendar_events;
DROP POLICY IF EXISTS "calendar_events_update" ON public.calendar_events;
DROP POLICY IF EXISTS "calendar_events_delete" ON public.calendar_events;

CREATE POLICY "calendar_events_select_global_or_member"
  ON public.calendar_events FOR SELECT
  TO authenticated
  USING (
    is_global = true
    OR public.is_super_admin(auth.uid())
    OR (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid()))
  );

CREATE POLICY "calendar_events_insert"
  ON public.calendar_events FOR INSERT
  TO authenticated
  WITH CHECK (
    (is_global = true AND public.is_super_admin(auth.uid()))
    OR (
      is_global = false
      AND brand_id IS NOT NULL
      AND public.is_brand_member(brand_id, auth.uid())
    )
  );

CREATE POLICY "calendar_events_update"
  ON public.calendar_events FOR UPDATE
  TO authenticated
  USING (
    (is_global = true AND public.is_super_admin(auth.uid()))
    OR (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid()))
  )
  WITH CHECK (
    (is_global = true AND public.is_super_admin(auth.uid()))
    OR (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid()))
  );

CREATE POLICY "calendar_events_delete"
  ON public.calendar_events FOR DELETE
  TO authenticated
  USING (
    (is_global = true AND public.is_super_admin(auth.uid()))
    OR (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid()))
  );

-- 2) Backfill brand_features so existing brands do not lose access
--    to modules they were already using (Content, Brain, Chat, Paid Media, etc.).
INSERT INTO public.brand_features (brand_id, feature_key, enabled, updated_at)
SELECT b.id, fc.key, true, now()
FROM public.brands b
CROSS JOIN public.feature_catalog fc
WHERE fc.is_core = false
ON CONFLICT (brand_id, feature_key) DO NOTHING;