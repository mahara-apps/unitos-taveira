-- Extend posts for the two-phase AI pipeline + validation gate
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reference_media jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS design_brief text,
  ADD COLUMN IF NOT EXISTS ai_phase text NOT NULL DEFAULT 'idea',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid;

-- Ensure the realtime publication carries posts so the board updates live
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'posts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.posts';
  END IF;
END $$;

-- Storage policies for brand-assets uploads (path convention: <brand_id>/...)
DROP POLICY IF EXISTS "brand-assets read by brand members" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets insert by brand members" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets update by brand members" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets delete by brand members" ON storage.objects;

CREATE POLICY "brand-assets read by brand members"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND public.is_brand_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "brand-assets insert by brand members"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND public.is_brand_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "brand-assets update by brand members"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND public.is_brand_member(((storage.foldername(name))[1])::uuid, auth.uid())
  )
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND public.is_brand_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "brand-assets delete by brand members"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND public.is_brand_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );