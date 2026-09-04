
-- Add brand hub fields to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS logo_secondary_url text,
  ADD COLUMN IF NOT EXISTS favicon_url text,
  ADD COLUMN IF NOT EXISTS brand_hub jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Client documents (metadata for uploaded PDFs / handbooks)
CREATE TABLE IF NOT EXISTS public.client_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_documents TO authenticated;
GRANT ALL ON public.client_documents TO service_role;

ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand members read documents"
  ON public.client_documents FOR SELECT TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()));

CREATE POLICY "brand members insert documents"
  ON public.client_documents FOR INSERT TO authenticated
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

CREATE POLICY "brand members update documents"
  ON public.client_documents FOR UPDATE TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

CREATE POLICY "brand members delete documents"
  ON public.client_documents FOR DELETE TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()));

CREATE TRIGGER client_documents_updated_at
  BEFORE UPDATE ON public.client_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS client_documents_client_idx
  ON public.client_documents (client_id, created_at DESC);

-- Storage policies for brand assets (public bucket) and documents (private bucket)
-- Objects are namespaced by "<brand_id>/<client_id>/<filename>" so we can enforce brand membership.

CREATE POLICY "brand members read brand-assets"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND public.is_brand_member((split_part(name, '/', 1))::uuid, auth.uid())
  );

CREATE POLICY "brand members write brand-assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND public.is_brand_member((split_part(name, '/', 1))::uuid, auth.uid())
  );

CREATE POLICY "brand members update brand-assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND public.is_brand_member((split_part(name, '/', 1))::uuid, auth.uid())
  );

CREATE POLICY "brand members delete brand-assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND public.is_brand_member((split_part(name, '/', 1))::uuid, auth.uid())
  );

CREATE POLICY "brand members read brand-documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'brand-documents'
    AND public.is_brand_member((split_part(name, '/', 1))::uuid, auth.uid())
  );

CREATE POLICY "brand members write brand-documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'brand-documents'
    AND public.is_brand_member((split_part(name, '/', 1))::uuid, auth.uid())
  );

CREATE POLICY "brand members delete brand-documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'brand-documents'
    AND public.is_brand_member((split_part(name, '/', 1))::uuid, auth.uid())
  );
