-- Storage policies for brand-assets bucket (private)
-- Path format: {brandId}/{filename}. Members read; owners/managers write.

DROP POLICY IF EXISTS "brand-assets read for members" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets write for managers" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets update for managers" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets delete for managers" ON storage.objects;

CREATE POLICY "brand-assets read for members"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'brand-assets'
  AND (
    public.is_super_admin(auth.uid())
    OR public.is_brand_member((split_part(name, '/', 1))::uuid, auth.uid())
  )
);

CREATE POLICY "brand-assets write for managers"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'brand-assets'
  AND (
    public.is_super_admin(auth.uid())
    OR public.has_brand_role((split_part(name, '/', 1))::uuid, auth.uid(), 'owner'::public.app_role)
    OR public.has_brand_role((split_part(name, '/', 1))::uuid, auth.uid(), 'manager'::public.app_role)
  )
);

CREATE POLICY "brand-assets update for managers"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'brand-assets'
  AND (
    public.is_super_admin(auth.uid())
    OR public.has_brand_role((split_part(name, '/', 1))::uuid, auth.uid(), 'owner'::public.app_role)
    OR public.has_brand_role((split_part(name, '/', 1))::uuid, auth.uid(), 'manager'::public.app_role)
  )
);

CREATE POLICY "brand-assets delete for managers"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'brand-assets'
  AND (
    public.is_super_admin(auth.uid())
    OR public.has_brand_role((split_part(name, '/', 1))::uuid, auth.uid(), 'owner'::public.app_role)
    OR public.has_brand_role((split_part(name, '/', 1))::uuid, auth.uid(), 'manager'::public.app_role)
  )
);