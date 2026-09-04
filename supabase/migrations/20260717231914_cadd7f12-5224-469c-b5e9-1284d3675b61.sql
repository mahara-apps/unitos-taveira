-- Drop old Meta-specific tables (consolidated into social_connections)
DROP TABLE IF EXISTS public.meta_oauth_states CASCADE;
DROP TABLE IF EXISTS public.meta_connections CASCADE;

-- =====================================================================
-- social_connections: single source of truth for social provider auth.
-- Holds Page ID, Instagram Business ID, tokens (ciphertext), scopes,
-- status and provider-specific metadata for every social integration.
-- =====================================================================
CREATE TABLE public.social_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('meta','instagram','facebook','tiktok','youtube','linkedin','twitter','threads')),
  -- External identifiers (semantics per provider)
  external_id text NOT NULL,         -- e.g. Meta Page ID
  external_name text,                -- e.g. Meta Page name
  account_id text,                   -- e.g. IG Business Account ID
  account_username text,             -- e.g. @handle
  owner_external_id text,            -- e.g. Meta User ID that authorized
  owner_name text,
  -- Credentials (AES-256-GCM ciphertext, decrypted server-side only)
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text,
  scopes text[] NOT NULL DEFAULT '{}',
  token_expires_at timestamptz,
  -- State
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','error','expired','revoked')),
  last_error text,
  last_synced_at timestamptz,
  -- Arbitrary provider payload (category, tasks, page picture, etc.)
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, provider, external_id)
);

CREATE INDEX idx_social_connections_brand ON public.social_connections(brand_id);
CREATE INDEX idx_social_connections_provider ON public.social_connections(brand_id, provider);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_connections TO authenticated;
GRANT ALL ON public.social_connections TO service_role;
ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_connections brand members read"
  ON public.social_connections FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_members bm
                 WHERE bm.brand_id = social_connections.brand_id
                   AND bm.user_id = auth.uid()));

CREATE POLICY "social_connections brand members write"
  ON public.social_connections FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.brand_members bm
                      WHERE bm.brand_id = social_connections.brand_id
                        AND bm.user_id = auth.uid()));

CREATE POLICY "social_connections brand members update"
  ON public.social_connections FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_members bm
                 WHERE bm.brand_id = social_connections.brand_id
                   AND bm.user_id = auth.uid()));

CREATE POLICY "social_connections brand members delete"
  ON public.social_connections FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_members bm
                 WHERE bm.brand_id = social_connections.brand_id
                   AND bm.user_id = auth.uid()));

-- =====================================================================
-- social_posts: scheduled and published items across providers.
-- =====================================================================
CREATE TABLE public.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  connection_id uuid NOT NULL REFERENCES public.social_connections(id) ON DELETE CASCADE,
  provider text NOT NULL,                     -- mirrors connection.provider for fast filters
  placement text NOT NULL DEFAULT 'feed'      -- feed | story | reel | short | tweet | post
    CHECK (placement IN ('feed','story','reel','carousel','short','tweet','thread','post')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','publishing','published','failed','cancelled')),
  -- Content
  caption text,
  media jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{url, type, alt}, ...]
  hashtags text[] NOT NULL DEFAULT '{}',
  mentions text[] NOT NULL DEFAULT '{}',
  -- Scheduling
  scheduled_at timestamptz,
  published_at timestamptz,
  -- Provider response
  external_post_id text,                      -- id returned by the provider
  external_permalink text,
  last_error text,
  provider_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Attribution
  post_id uuid,                               -- optional link to internal posts table
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_posts_brand ON public.social_posts(brand_id);
CREATE INDEX idx_social_posts_connection ON public.social_posts(connection_id);
CREATE INDEX idx_social_posts_status_scheduled ON public.social_posts(status, scheduled_at)
  WHERE status IN ('scheduled','publishing');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_posts TO authenticated;
GRANT ALL ON public.social_posts TO service_role;
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_posts brand members read"
  ON public.social_posts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_members bm
                 WHERE bm.brand_id = social_posts.brand_id
                   AND bm.user_id = auth.uid()));

CREATE POLICY "social_posts brand members insert"
  ON public.social_posts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.brand_members bm
                      WHERE bm.brand_id = social_posts.brand_id
                        AND bm.user_id = auth.uid()));

CREATE POLICY "social_posts brand members update"
  ON public.social_posts FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_members bm
                 WHERE bm.brand_id = social_posts.brand_id
                   AND bm.user_id = auth.uid()));

CREATE POLICY "social_posts brand members delete"
  ON public.social_posts FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_members bm
                 WHERE bm.brand_id = social_posts.brand_id
                   AND bm.user_id = auth.uid()));

-- updated_at triggers (reuse existing helper if present)
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_social_connections_touch
  BEFORE UPDATE ON public.social_connections
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TRIGGER trg_social_posts_touch
  BEFORE UPDATE ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();