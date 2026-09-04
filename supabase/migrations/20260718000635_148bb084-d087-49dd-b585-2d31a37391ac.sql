
-- Brand media library
CREATE TABLE IF NOT EXISTS public.brand_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  uploaded_by uuid,
  storage_path text NOT NULL,
  name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  kind text NOT NULL CHECK (kind IN ('image','video','other')),
  width integer,
  height integer,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, storage_path)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_media_assets TO authenticated;
GRANT ALL ON public.brand_media_assets TO service_role;

ALTER TABLE public.brand_media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand members manage media" ON public.brand_media_assets
  FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_brand_media_brand ON public.brand_media_assets (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brand_media_kind ON public.brand_media_assets (brand_id, kind);

CREATE TRIGGER trg_brand_media_updated_at
  BEFORE UPDATE ON public.brand_media_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage policies for the brand-media bucket. Paths are prefixed by brand_id/...
CREATE POLICY "brand members read brand-media"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'brand-media'
    AND (
      public.is_super_admin(auth.uid())
      OR public.is_brand_member(
        NULLIF(split_part(name, '/', 1), '')::uuid,
        auth.uid()
      )
    )
  );

CREATE POLICY "brand members write brand-media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'brand-media'
    AND (
      public.is_super_admin(auth.uid())
      OR public.is_brand_member(
        NULLIF(split_part(name, '/', 1), '')::uuid,
        auth.uid()
      )
    )
  );

CREATE POLICY "brand members update brand-media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'brand-media'
    AND (
      public.is_super_admin(auth.uid())
      OR public.is_brand_member(
        NULLIF(split_part(name, '/', 1), '')::uuid,
        auth.uid()
      )
    )
  );

CREATE POLICY "brand members delete brand-media"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'brand-media'
    AND (
      public.is_super_admin(auth.uid())
      OR public.is_brand_member(
        NULLIF(split_part(name, '/', 1), '')::uuid,
        auth.uid()
      )
    )
  );
