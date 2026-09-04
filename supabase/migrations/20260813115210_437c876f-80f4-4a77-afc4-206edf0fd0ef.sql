-- Fase 0a: fail-closed visibility for client documents in the public portal
ALTER TABLE public.client_documents
  ADD COLUMN IF NOT EXISTS visible_to_client boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS client_documents_visible_idx
  ON public.client_documents (client_id, visible_to_client);

-- Portal listing: only explicitly shared documents
CREATE OR REPLACE FUNCTION public.portal_files(_token text, _search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session(_token);
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO rows FROM (
    SELECT id, name, storage_path, mime_type, size_bytes, created_at
      FROM public.client_documents
     WHERE brand_id = s.brand_id AND client_id = s.client_id
       AND visible_to_client IS TRUE
       AND (_search IS NULL OR name ILIKE '%' || _search || '%')
     ORDER BY created_at DESC
  ) x;
  RETURN rows;
END $$;

GRANT EXECUTE ON FUNCTION public.portal_files(text, text) TO anon;

-- Storage: anon portal visitors can only read brand assets or documents flagged visible
DROP POLICY IF EXISTS "portal_anon_read_brand_assets" ON storage.objects;
CREATE POLICY "portal_anon_read_brand_assets" ON storage.objects
FOR SELECT TO anon USING (
  bucket_id IN ('brand-assets','brand-documents')
  AND EXISTS (
    SELECT 1
      FROM public.portal_tokens pt
      JOIN public.clients c ON c.id = pt.client_id
     WHERE pt.revoked_at IS NULL
       AND (pt.expires_at IS NULL OR pt.expires_at > now())
       AND name LIKE (c.brand_id::text || '/' || pt.client_id::text || '/%')
  )
  AND (
    bucket_id <> 'brand-documents'
    OR EXISTS (
      SELECT 1 FROM public.client_documents d
       WHERE d.storage_path = storage.objects.name
         AND d.visible_to_client IS TRUE
    )
  )
);