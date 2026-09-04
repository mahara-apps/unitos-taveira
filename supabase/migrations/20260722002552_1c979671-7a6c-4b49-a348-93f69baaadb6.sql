-- Portal público (anon com token) precisa ler mídias no bucket unificado
-- brand-media, agora usado também pelo Kanban de conteúdo.
DROP POLICY IF EXISTS "portal_anon_read_brand_assets" ON storage.objects;
CREATE POLICY "portal_anon_read_brand_assets"
ON storage.objects
FOR SELECT
TO anon
USING (
  bucket_id = ANY (ARRAY['brand-assets'::text, 'brand-documents'::text, 'brand-media'::text])
  AND EXISTS (
    SELECT 1
    FROM portal_tokens pt
    JOIN clients c ON c.id = pt.client_id
    WHERE pt.revoked_at IS NULL
      AND (pt.expires_at IS NULL OR pt.expires_at > now())
      AND (storage.foldername(objects.name))[1] = c.brand_id::text
      AND (storage.foldername(objects.name))[2] = pt.client_id::text
  )
);