DROP POLICY IF EXISTS "brand members create notifications" ON public.notifications;
CREATE POLICY "brand members create notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  is_brand_member(brand_id, auth.uid())
  AND is_brand_member(brand_id, user_id)
);