-- =============================================================================
-- FORWARD-ONLY / BASELINE DE STORAGE. ARQUIVO EM STAGING:
-- ver supabase/baseline/README.md.
-- Nome-alvo final:
--   supabase/migrations/20260821090100_storage_buckets_baseline.sql
-- =============================================================================
-- As migrations historicas criam APENAS as policies em storage.objects para
-- 'brand-assets', 'brand-documents', 'brand-media', 'avatars' e
-- 'chat-attachments' (esta ultima em 20260717173712). Os buckets em si foram
-- criados via painel/API e nunca versionados -> em instalacao limpa os uploads
-- quebram (bucket inexistente).
--
-- Propriedades espelham exatamente producao (5 buckets, todos privados, sem
-- file_size_limit e sem allowed_mime_types definidos): o acesso e feito por
-- signed URLs geradas em server functions.
--
-- Idempotente: ON CONFLICT DO NOTHING -> no-op em producao.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('brand-assets',     'brand-assets',     false, NULL, NULL),
  ('brand-documents',  'brand-documents',  false, NULL, NULL),
  ('brand-media',      'brand-media',      false, NULL, NULL),
  ('avatars',          'avatars',          false, NULL, NULL),
  ('chat-attachments', 'chat-attachments', false, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
