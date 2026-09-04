-- =============================================================================
-- 003_storage_buckets.sql — BOOTSTRAP DE STORAGE (fora do schema estrutural)
-- Staging: NAO aplicar em producao. Ver supabase/baseline-snapshot/README.md.
-- =============================================================================
-- Os 5 buckets REAIS de producao (leitura de storage.buckets):
--   brand-assets, brand-documents, brand-media, avatars, chat-attachments
-- Todos privados (public = false), sem file_size_limit e sem allowed_mime_types.
-- O acesso e sempre por signed URL gerada em server function.
--
-- As policies de storage.objects NAO estao no 001_initial_schema.sql (dump feito
-- com --schema=public): elas ficam em 006_storage_policies.sql, que deve rodar
-- DEPOIS deste arquivo. Aqui so sao criados os buckets, nunca versionados por SQL.
--
-- Nota: dependendo do fluxo, buckets podem/devem ser criados via API/painel;
-- neste caso ignore este arquivo e crie os 5 buckets com as mesmas propriedades.
-- Idempotente: ON CONFLICT DO NOTHING.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('brand-assets',     'brand-assets',     false, NULL, NULL),
  ('brand-documents',  'brand-documents',  false, NULL, NULL),
  ('brand-media',      'brand-media',      false, NULL, NULL),
  ('avatars',          'avatars',          false, NULL, NULL),
  ('chat-attachments', 'chat-attachments', false, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
