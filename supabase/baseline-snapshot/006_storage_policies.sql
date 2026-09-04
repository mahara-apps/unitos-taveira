-- =============================================================================
-- 006_storage_policies.sql — POLICIES DE storage.objects (fora do dump de public)
--
-- Motivo de existir: 001_initial_schema.sql foi gerado com
-- pg_dump --schema=public, portanto NAO contem nada do schema storage. As 12
-- policies reais de storage.objects sao parte do isolamento por workspace/cliente
-- e sem elas uma instalacao nova fica SEM acesso a arquivos (ou sem isolamento).
--
-- Copia literal de pg_policies (schemaname = 'storage') do banco de origem,
-- lido em 2026-08-29 (somente leitura).
--
-- Dependencias:
--   * 001_initial_schema.sql  -> public.storage_scope_allows(text, text, boolean)
--   * 003_storage_buckets.sql -> os 5 buckets
--   * schema storage + storage.foldername(): fornecidos pelo Supabase.
--
-- NAO incluidos (sao objetos nativos gerenciados pelo Supabase, ja existentes em
-- qualquer projeto novo): storage.protect_delete() e os triggers
-- protect_buckets_delete / protect_objects_delete /
-- enforce_bucket_name_length_trigger / update_objects_updated_at.
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE POLICY.
-- =============================================================================

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- avatars: leitura por qualquer autenticado, escrita apenas na pasta do proprio uid
DROP POLICY IF EXISTS avatars_auth_read ON storage.objects;
CREATE POLICY avatars_auth_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS avatars_owner_insert ON storage.objects;
CREATE POLICY avatars_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS avatars_owner_update ON storage.objects;
CREATE POLICY avatars_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS avatars_owner_delete ON storage.objects;
CREATE POLICY avatars_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- brand-assets / brand-documents / brand-media: escopo por workspace/cliente
DROP POLICY IF EXISTS brand_files_scoped_select ON storage.objects;
CREATE POLICY brand_files_scoped_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = ANY (ARRAY['brand-assets', 'brand-documents', 'brand-media'])
    AND public.storage_scope_allows(bucket_id, name, false)
  );

DROP POLICY IF EXISTS brand_files_scoped_insert ON storage.objects;
CREATE POLICY brand_files_scoped_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = ANY (ARRAY['brand-assets', 'brand-documents', 'brand-media'])
    AND public.storage_scope_allows(bucket_id, name, true)
  );

DROP POLICY IF EXISTS brand_files_scoped_update ON storage.objects;
CREATE POLICY brand_files_scoped_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = ANY (ARRAY['brand-assets', 'brand-documents', 'brand-media'])
    AND public.storage_scope_allows(bucket_id, name, true)
  )
  WITH CHECK (
    bucket_id = ANY (ARRAY['brand-assets', 'brand-documents', 'brand-media'])
    AND public.storage_scope_allows(bucket_id, name, true)
  );

DROP POLICY IF EXISTS brand_files_scoped_delete ON storage.objects;
CREATE POLICY brand_files_scoped_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = ANY (ARRAY['brand-assets', 'brand-documents', 'brand-media'])
    AND public.storage_scope_allows(bucket_id, name, true)
  );

-- chat-attachments: apenas a pasta do proprio uid
DROP POLICY IF EXISTS chat_attachments_owner_select ON storage.objects;
CREATE POLICY chat_attachments_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-attachments' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS chat_attachments_owner_insert ON storage.objects;
CREATE POLICY chat_attachments_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-attachments' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- ATENCAO (estado real preservado): no banco de origem chat_attachments_owner_update
-- tem apenas USING, sem WITH CHECK. Mantido identico de proposito.
DROP POLICY IF EXISTS chat_attachments_owner_update ON storage.objects;
CREATE POLICY chat_attachments_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'chat-attachments' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS chat_attachments_owner_delete ON storage.objects;
CREATE POLICY chat_attachments_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-attachments' AND (auth.uid())::text = (storage.foldername(name))[1]);
