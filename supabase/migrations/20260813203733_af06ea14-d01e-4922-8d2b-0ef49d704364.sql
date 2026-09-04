-- 1. social_connections = canal do workspace; client_id deprecado
COMMENT ON COLUMN public.social_connections.client_id IS 'DEPRECATED (Fase 1): nao use. Vinculo canal<->cliente vive em public.client_social_accounts.';
COMMENT ON TABLE public.social_connections IS 'Integracao/canal social no nivel do WORKSPACE (brand). Nao representa vinculo com cliente.';
COMMENT ON TABLE public.client_social_accounts IS 'Unica fonte de verdade do vinculo canal <-> cliente.';

-- 2. IDs Meta explicitos
ALTER TABLE public.social_connections
  ADD COLUMN IF NOT EXISTS page_id text,
  ADD COLUMN IF NOT EXISTS instagram_business_id text,
  ADD COLUMN IF NOT EXISTS meta_user_id text,
  ADD COLUMN IF NOT EXISTS channel_name text;

COMMENT ON COLUMN public.social_connections.page_id IS 'Facebook Page ID (Meta).';
COMMENT ON COLUMN public.social_connections.instagram_business_id IS 'Instagram Business Account ID (Meta).';
COMMENT ON COLUMN public.social_connections.meta_user_id IS 'Meta user/app-scoped user id (owner).';

UPDATE public.social_connections
SET page_id = COALESCE(page_id, NULLIF(metadata->>'page_id',''), CASE WHEN channel LIKE 'facebook%' THEN NULLIF(external_id,'') END),
    instagram_business_id = COALESCE(instagram_business_id, NULLIF(metadata->>'instagram_business_id',''), CASE WHEN channel LIKE 'instagram%' THEN NULLIF(external_id,'') END),
    meta_user_id = COALESCE(meta_user_id, NULLIF(metadata->>'meta_user_id',''), NULLIF(owner_external_id,'')),
    channel_name = COALESCE(channel_name, NULLIF(metadata->>'instagram_username',''), NULLIF(account_username,''), NULLIF(external_name,''), NULLIF(metadata->>'page_name',''))
WHERE provider = 'meta';

UPDATE public.social_connections
SET channel_name = COALESCE(channel_name, NULLIF(account_username,''), NULLIF(external_name,''))
WHERE channel_name IS NULL;

-- 3. Anti-duplicidade de canais por (brand, provider, channel, external_id)
CREATE UNIQUE INDEX IF NOT EXISTS social_connections_brand_provider_channel_ext_key
  ON public.social_connections (brand_id, provider, channel, external_id);
CREATE INDEX IF NOT EXISTS social_connections_page_id_idx ON public.social_connections (page_id) WHERE page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_connections_ig_id_idx ON public.social_connections (instagram_business_id) WHERE instagram_business_id IS NOT NULL;

-- 4. client_social_accounts: integridade do vinculo
CREATE UNIQUE INDEX IF NOT EXISTS client_social_accounts_client_connection_key
  ON public.client_social_accounts (client_id, connection_id);
CREATE INDEX IF NOT EXISTS client_social_accounts_connection_idx ON public.client_social_accounts (connection_id);

CREATE OR REPLACE FUNCTION public.validate_client_social_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conn_brand uuid;
  cli_brand uuid;
BEGIN
  SELECT brand_id INTO conn_brand FROM public.social_connections WHERE id = NEW.connection_id;
  SELECT brand_id INTO cli_brand FROM public.clients WHERE id = NEW.client_id;
  IF conn_brand IS NULL OR cli_brand IS NULL THEN
    RAISE EXCEPTION 'Canal ou cliente inexistente';
  END IF;
  IF conn_brand <> cli_brand OR NEW.brand_id <> conn_brand THEN
    RAISE EXCEPTION 'Canal e cliente devem pertencer a mesma marca';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_client_social_account ON public.client_social_accounts;
CREATE TRIGGER trg_validate_client_social_account
  BEFORE INSERT OR UPDATE ON public.client_social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.validate_client_social_account();

-- 5. post_placements.connection_id como FK real + backfill
ALTER TABLE public.post_placements
  ADD COLUMN IF NOT EXISTS connection_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'post_placements_connection_id_fkey'
  ) THEN
    ALTER TABLE public.post_placements
      ADD CONSTRAINT post_placements_connection_id_fkey
      FOREIGN KEY (connection_id) REFERENCES public.social_connections(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS post_placements_connection_idx ON public.post_placements (connection_id) WHERE connection_id IS NOT NULL;

-- backfill 1: copy_override.connection_id
UPDATE public.post_placements pp
SET connection_id = sc.id
FROM public.social_connections sc
WHERE pp.connection_id IS NULL
  AND sc.brand_id = pp.brand_id
  AND (pp.copy_override->>'connection_id') IS NOT NULL
  AND sc.id::text = pp.copy_override->>'connection_id';

-- backfill 2: posts.target_connection_ids (somente quando ha exatamente 1 destino)
UPDATE public.post_placements pp
SET connection_id = sc.id
FROM public.posts p
JOIN public.social_connections sc ON sc.id = p.target_connection_ids[1] AND sc.brand_id = p.brand_id
WHERE pp.connection_id IS NULL
  AND p.id = pp.post_id
  AND COALESCE(array_length(p.target_connection_ids, 1), 0) = 1;

-- backfill 3: social_posts (mesma peca/cliente/canal)
UPDATE public.post_placements pp
SET connection_id = sp.connection_id
FROM public.social_posts sp
WHERE pp.connection_id IS NULL
  AND sp.brand_id = pp.brand_id
  AND sp.client_id = pp.client_id
  AND sp.placement = pp.format
  AND sp.post_id IS NOT DISTINCT FROM pp.post_id;

-- validacao de consistencia do destino
CREATE OR REPLACE FUNCTION public.validate_placement_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean;
BEGIN
  IF NEW.connection_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM public.client_social_accounts csa
    JOIN public.social_connections sc ON sc.id = csa.connection_id
    WHERE csa.connection_id = NEW.connection_id
      AND csa.client_id = NEW.client_id
      AND sc.brand_id = NEW.brand_id
  ) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION 'Canal nao vinculado a este cliente (client_social_accounts)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_placement_connection ON public.post_placements;
CREATE TRIGGER trg_validate_placement_connection
  BEFORE INSERT OR UPDATE OF connection_id, client_id ON public.post_placements
  FOR EACH ROW EXECUTE FUNCTION public.validate_placement_connection();

-- 6. RLS: apenas owner/manager/super_admin administram integracoes
DROP POLICY IF EXISTS "social_connections brand members write" ON public.social_connections;
DROP POLICY IF EXISTS "social_connections brand members update" ON public.social_connections;
DROP POLICY IF EXISTS "social_connections brand members delete" ON public.social_connections;

CREATE POLICY "social_connections admins insert" ON public.social_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
    OR public.has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "social_connections admins update" ON public.social_connections
  FOR UPDATE TO authenticated
  USING (
    public.has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
    OR public.has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
    OR public.is_super_admin(auth.uid())
  )
  WITH CHECK (
    public.has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
    OR public.has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "social_connections admins delete" ON public.social_connections
  FOR DELETE TO authenticated
  USING (
    public.has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
    OR public.has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
    OR public.is_super_admin(auth.uid())
  );

DROP POLICY IF EXISTS "csa brand members write" ON public.client_social_accounts;
DROP POLICY IF EXISTS "csa brand members delete" ON public.client_social_accounts;

CREATE POLICY "csa admins insert" ON public.client_social_accounts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
    OR public.has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "csa admins delete" ON public.client_social_accounts
  FOR DELETE TO authenticated
  USING (
    public.has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
    OR public.has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
    OR public.is_super_admin(auth.uid())
  );

-- 7. Reconciliacao/upsert idempotente de canal
CREATE OR REPLACE FUNCTION public.upsert_social_connection(
  _brand_id uuid,
  _provider text,
  _channel text,
  _external_id text,
  _access_token_ciphertext text,
  _external_name text DEFAULT NULL,
  _account_username text DEFAULT NULL,
  _page_id text DEFAULT NULL,
  _instagram_business_id text DEFAULT NULL,
  _meta_user_id text DEFAULT NULL,
  _owner_external_id text DEFAULT NULL,
  _owner_name text DEFAULT NULL,
  _scopes text[] DEFAULT '{}',
  _token_expires_at timestamptz DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _created_by uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.social_connections (
    brand_id, provider, channel, external_id, external_name, account_id, account_username,
    owner_external_id, owner_name, access_token_ciphertext, scopes, token_expires_at,
    status, metadata, created_by, page_id, instagram_business_id, meta_user_id, channel_name
  ) VALUES (
    _brand_id, _provider, _channel, _external_id, _external_name, _external_id, _account_username,
    _owner_external_id, _owner_name, _access_token_ciphertext, COALESCE(_scopes,'{}'), _token_expires_at,
    'active', COALESCE(_metadata,'{}'::jsonb), _created_by, _page_id, _instagram_business_id, _meta_user_id,
    COALESCE(_account_username, _external_name)
  )
  ON CONFLICT (brand_id, provider, channel, external_id) DO UPDATE SET
    external_name = COALESCE(EXCLUDED.external_name, public.social_connections.external_name),
    account_username = COALESCE(EXCLUDED.account_username, public.social_connections.account_username),
    owner_external_id = COALESCE(EXCLUDED.owner_external_id, public.social_connections.owner_external_id),
    owner_name = COALESCE(EXCLUDED.owner_name, public.social_connections.owner_name),
    access_token_ciphertext = EXCLUDED.access_token_ciphertext,
    scopes = EXCLUDED.scopes,
    token_expires_at = EXCLUDED.token_expires_at,
    status = 'active',
    last_error = NULL,
    metadata = public.social_connections.metadata || EXCLUDED.metadata,
    page_id = COALESCE(EXCLUDED.page_id, public.social_connections.page_id),
    instagram_business_id = COALESCE(EXCLUDED.instagram_business_id, public.social_connections.instagram_business_id),
    meta_user_id = COALESCE(EXCLUDED.meta_user_id, public.social_connections.meta_user_id),
    channel_name = COALESCE(EXCLUDED.channel_name, public.social_connections.channel_name),
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_social_connection(uuid,text,text,text,text,text,text,text,text,text,text,text,text[],timestamptz,jsonb,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_social_connection(uuid,text,text,text,text,text,text,text,text,text,text,text,text[],timestamptz,jsonb,uuid) TO service_role;