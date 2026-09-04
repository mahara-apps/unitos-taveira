
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS logo_dark_url text,
  ADD COLUMN IF NOT EXISTS icon_url text;

-- Storage policies for bucket 'brand-assets' (bucket is created via tool separately).
-- Path convention: {brand_id}/logo-light-*, logo-dark-*, icon-*

DROP POLICY IF EXISTS "brand_assets_public_read" ON storage.objects;
CREATE POLICY "brand_assets_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'brand-assets');

DROP POLICY IF EXISTS "brand_assets_manager_insert" ON storage.objects;
CREATE POLICY "brand_assets_manager_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND (
      public.is_super_admin(auth.uid())
      OR public.has_brand_role((split_part(name, '/', 1))::uuid, auth.uid(), 'owner'::public.app_role)
      OR public.has_brand_role((split_part(name, '/', 1))::uuid, auth.uid(), 'manager'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "brand_assets_manager_update" ON storage.objects;
CREATE POLICY "brand_assets_manager_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND (
      public.is_super_admin(auth.uid())
      OR public.has_brand_role((split_part(name, '/', 1))::uuid, auth.uid(), 'owner'::public.app_role)
      OR public.has_brand_role((split_part(name, '/', 1))::uuid, auth.uid(), 'manager'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "brand_assets_manager_delete" ON storage.objects;
CREATE POLICY "brand_assets_manager_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND (
      public.is_super_admin(auth.uid())
      OR public.has_brand_role((split_part(name, '/', 1))::uuid, auth.uid(), 'owner'::public.app_role)
      OR public.has_brand_role((split_part(name, '/', 1))::uuid, auth.uid(), 'manager'::public.app_role)
    )
  );
