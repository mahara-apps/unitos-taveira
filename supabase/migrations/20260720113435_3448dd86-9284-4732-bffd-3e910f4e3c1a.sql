
-- 1) social_connections: isolamento por cliente
ALTER TABLE public.social_connections
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_social_connections_client_channel
  ON public.social_connections (client_id, channel)
  WHERE client_id IS NOT NULL;

-- Substituir o índice único antigo (que travava 1 ativa por (brand, channel))
-- por dois índices parciais: um por cliente e outro brand-level para conexões
-- institucionais (client_id NULL, ex.: blog da própria agência).
DROP INDEX IF EXISTS public.social_connections_unique_active_brand_channel;

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_conn_client_channel_ativa
  ON public.social_connections (client_id, channel)
  WHERE status IN ('active','attention') AND client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_conn_brand_channel_ativa_nullclient
  ON public.social_connections (brand_id, channel)
  WHERE status IN ('active','attention') AND client_id IS NULL;

-- 2) social_posts: retry + lock
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS publish_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publish_locked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_social_posts_claim
  ON public.social_posts (status, scheduled_at)
  WHERE status = 'scheduled';

-- 3) RPCs de claim/publish/fail seguros
CREATE OR REPLACE FUNCTION public.claim_scheduled_social_posts(p_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid,
  brand_id uuid,
  client_id uuid,
  connection_id uuid,
  provider text,
  placement text,
  caption text,
  hashtags text[],
  mentions text[],
  media jsonb,
  publish_attempts int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT sp.id
    FROM public.social_posts sp
    JOIN public.social_connections sc ON sc.id = sp.connection_id
    WHERE sp.status = 'scheduled'
      AND sp.scheduled_at IS NOT NULL
      AND sp.scheduled_at <= now()
      AND (sp.publish_locked_at IS NULL OR sp.publish_locked_at < now() - interval '10 minutes')
      AND sp.publish_attempts < 5
      -- Revalida isolamento no momento do claim
      AND sc.brand_id = sp.brand_id
      AND (
        sp.client_id IS NULL
        OR sc.client_id IS NULL
        OR sc.client_id = sp.client_id
      )
    ORDER BY sp.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE OF sp SKIP LOCKED
  ),
  locked AS (
    UPDATE public.social_posts sp
       SET publish_locked_at = now(),
           status = 'publishing',
           updated_at = now()
      FROM candidates c
     WHERE sp.id = c.id
     RETURNING sp.id, sp.brand_id, sp.client_id, sp.connection_id, sp.provider,
               sp.placement, sp.caption, sp.hashtags, sp.mentions, sp.media,
               sp.publish_attempts
  )
  SELECT * FROM locked;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_social_post_published(
  p_post_id uuid,
  p_external_id text,
  p_permalink text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.social_posts
     SET status = 'published',
         published_at = now(),
         external_post_id = p_external_id,
         external_permalink = p_permalink,
         last_error = NULL,
         publish_locked_at = NULL,
         updated_at = now()
   WHERE id = p_post_id;
$$;

CREATE OR REPLACE FUNCTION public.mark_social_post_failed(
  p_post_id uuid,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts int;
BEGIN
  UPDATE public.social_posts
     SET publish_attempts = publish_attempts + 1,
         last_error = p_error,
         publish_locked_at = NULL,
         status = CASE
           WHEN publish_attempts + 1 >= 5 THEN 'failed'
           ELSE 'scheduled'
         END,
         updated_at = now()
   WHERE id = p_post_id
  RETURNING publish_attempts INTO v_attempts;
END;
$$;

-- RPCs só devem ser chamadas pelo worker (service_role). Bloqueia execução
-- por anon/authenticated para não expor lock/claim ao cliente.
REVOKE ALL ON FUNCTION public.claim_scheduled_social_posts(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_social_post_published(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_social_post_failed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_social_posts(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_social_post_published(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_social_post_failed(uuid, text) TO service_role;
