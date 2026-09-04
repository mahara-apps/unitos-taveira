-- =====================================================================
-- FASE 10A — Hardening de STORAGE (brand-assets / brand-documents / brand-media)
-- Autorização por CLIENTE (não apenas brand), com validação real no banco.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.safe_uuid(_txt text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF _txt IS NULL OR _txt = '' THEN RETURN NULL; END IF;
  RETURN _txt::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.safe_uuid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.safe_uuid(text) TO authenticated, service_role;

-- Núcleo canônico de autorização de arquivos.
--   path esperado: <brand_id>/<client_id>/...   (recurso de cliente)
--                  <brand_id>/<algo-nao-uuid>/… (recurso de workspace)
-- Nunca confia no path: valida clients.brand_id no banco.
CREATE OR REPLACE FUNCTION public.storage_scope_allows(
  _bucket text,
  _name text,
  _write boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _brand uuid;
  _client uuid;
BEGIN
  IF _uid IS NULL OR _name IS NULL THEN RETURN false; END IF;
  IF _bucket NOT IN ('brand-assets', 'brand-documents', 'brand-media') THEN RETURN false; END IF;
  IF public.is_super_admin(_uid) THEN RETURN true; END IF;

  _brand := public.safe_uuid(split_part(_name, '/', 1));
  IF _brand IS NULL THEN RETURN false; END IF;

  _client := public.safe_uuid(split_part(_name, '/', 2));

  IF _client IS NOT NULL THEN
    -- Relacionamento real marca↔cliente (bloqueia troca manual de segmentos).
    IF NOT EXISTS (
      SELECT 1 FROM public.clients c WHERE c.id = _client AND c.brand_id = _brand
    ) THEN
      RETURN false;
    END IF;

    -- PORTAL: somente leitura do próprio cliente, e só o que é liberado.
    IF public.is_portal_client_of(_client, _uid) THEN
      IF _write THEN RETURN false; END IF;
      IF _bucket = 'brand-documents' THEN
        RETURN EXISTS (
          SELECT 1 FROM public.client_documents d
          WHERE d.storage_path = _name
            AND d.client_id = _client
            AND d.visible_to_client IS TRUE
        );
      END IF;
      -- identidade visual do próprio cliente
      RETURN _bucket = 'brand-assets';
    END IF;

    -- Interno: ADMIN = workspace inteiro; MANAGER/USER = clientes atribuídos.
    RETURN public.client_in_scope(_client, _brand);
  END IF;

  -- Sem cliente determinável (branding do workspace): mantém o mais restritivo.
  -- Não existe fallback "brand member = pode acessar".
  RETURN public.is_brand_admin_level(_brand, _uid);
END $$;

REVOKE ALL ON FUNCTION public.storage_scope_allows(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_scope_allows(text, text, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Remove TODAS as policies legadas dos três buckets (eram OR-permissivas
-- e escopadas apenas por brand_id no path).
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "brand members delete brand-assets" ON storage.objects;
DROP POLICY IF EXISTS "brand members delete brand-documents" ON storage.objects;
DROP POLICY IF EXISTS "brand members delete brand-media" ON storage.objects;
DROP POLICY IF EXISTS "brand members read brand-assets" ON storage.objects;
DROP POLICY IF EXISTS "brand members read brand-documents" ON storage.objects;
DROP POLICY IF EXISTS "brand members read brand-media" ON storage.objects;
DROP POLICY IF EXISTS "brand members update brand-assets" ON storage.objects;
DROP POLICY IF EXISTS "brand members update brand-media" ON storage.objects;
DROP POLICY IF EXISTS "brand members write brand-assets" ON storage.objects;
DROP POLICY IF EXISTS "brand members write brand-documents" ON storage.objects;
DROP POLICY IF EXISTS "brand members write brand-media" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets delete by brand members" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets delete for managers" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets insert by brand members" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets read by brand members" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets read for members" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets update by brand members" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets update for managers" ON storage.objects;
DROP POLICY IF EXISTS "brand-assets write for managers" ON storage.objects;
DROP POLICY IF EXISTS "brand_assets_manager_delete" ON storage.objects;
DROP POLICY IF EXISTS "brand_assets_manager_insert" ON storage.objects;
DROP POLICY IF EXISTS "brand_assets_manager_update" ON storage.objects;
DROP POLICY IF EXISTS "portal_anon_read_brand_assets" ON storage.objects;

-- ---------------------------------------------------------------------
-- Policies canônicas — 4 operações × 3 buckets, uma única fonte de verdade.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "brand_files_scoped_select" ON storage.objects;
CREATE POLICY "brand_files_scoped_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id IN ('brand-assets', 'brand-documents', 'brand-media')
  AND public.storage_scope_allows(bucket_id, name, false)
);

DROP POLICY IF EXISTS "brand_files_scoped_insert" ON storage.objects;
CREATE POLICY "brand_files_scoped_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('brand-assets', 'brand-documents', 'brand-media')
  AND public.storage_scope_allows(bucket_id, name, true)
);

DROP POLICY IF EXISTS "brand_files_scoped_update" ON storage.objects;
CREATE POLICY "brand_files_scoped_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id IN ('brand-assets', 'brand-documents', 'brand-media')
  AND public.storage_scope_allows(bucket_id, name, true)
)
WITH CHECK (
  bucket_id IN ('brand-assets', 'brand-documents', 'brand-media')
  AND public.storage_scope_allows(bucket_id, name, true)
);

DROP POLICY IF EXISTS "brand_files_scoped_delete" ON storage.objects;
CREATE POLICY "brand_files_scoped_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id IN ('brand-assets', 'brand-documents', 'brand-media')
  AND public.storage_scope_allows(bucket_id, name, true)
);