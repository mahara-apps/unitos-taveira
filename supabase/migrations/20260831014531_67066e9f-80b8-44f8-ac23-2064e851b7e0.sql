ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS rate_limit_retries integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deferred_since timestamptz;

CREATE INDEX IF NOT EXISTS social_posts_next_attempt_idx
  ON public.social_posts (status, next_attempt_at)
  WHERE status = 'scheduled';

CREATE OR REPLACE FUNCTION public.claim_scheduled_social_posts(p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, brand_id uuid, client_id uuid, connection_id uuid, provider text, placement text, caption text, hashtags text[], mentions text[], media jsonb, publish_attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT sp.id
    FROM public.social_posts sp
    JOIN public.social_connections sc ON sc.id = sp.connection_id
    WHERE sp.status = 'scheduled'
      AND sp.scheduled_at IS NOT NULL
      AND sp.scheduled_at <= now()
      -- Backoff: item adiado por limite temporário da Meta só volta ao tempo devido.
      AND (sp.next_attempt_at IS NULL OR sp.next_attempt_at <= now())
      AND (sp.publish_locked_at IS NULL OR sp.publish_locked_at < now() - interval '10 minutes')
      AND sp.publish_attempts < 5
      AND sc.brand_id = sp.brand_id
      AND (
        sp.client_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.client_social_accounts csa
          WHERE csa.connection_id = sp.connection_id
            AND csa.client_id = sp.client_id
            AND csa.brand_id = sp.brand_id
        )
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
$function$;

-- Adia a publicação sem consumir tentativa (limite temporário da Meta).
-- Depois de 8 adiamentos ou 6h de espera, vira falha visível com mensagem clara.
CREATE OR REPLACE FUNCTION public.mark_social_post_deferred(
  p_post_id uuid,
  p_error text,
  p_retry_at timestamptz
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_since timestamptz;
  v_retries int;
BEGIN
  SELECT COALESCE(deferred_since, now()), rate_limit_retries
    INTO v_since, v_retries
    FROM public.social_posts
   WHERE id = p_post_id;

  IF v_retries IS NULL THEN
    RETURN;
  END IF;

  IF v_retries + 1 >= 8 OR v_since < now() - interval '6 hours' THEN
    UPDATE public.social_posts
       SET status = 'failed',
           publish_locked_at = NULL,
           next_attempt_at = NULL,
           rate_limit_retries = v_retries + 1,
           last_error = 'Limite de requisições da Meta persistiu por várias horas. Reenvie este destino manualmente. Detalhe: ' || COALESCE(p_error, ''),
           updated_at = now()
     WHERE id = p_post_id;
  ELSE
    UPDATE public.social_posts
       SET status = 'scheduled',
           publish_locked_at = NULL,
           next_attempt_at = p_retry_at,
           deferred_since = v_since,
           rate_limit_retries = v_retries + 1,
           last_error = COALESCE(p_error, 'Limite temporário da Meta'),
           updated_at = now()
     WHERE id = p_post_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_social_post_deferred(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_social_post_deferred(uuid, text, timestamptz) TO service_role;

-- Sucesso/nova tentativa manual limpam o estado de backoff.
CREATE OR REPLACE FUNCTION public.mark_social_post_failed(p_post_id uuid, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.social_posts
     SET publish_attempts = publish_attempts + 1,
         last_error = p_error,
         publish_locked_at = NULL,
         next_attempt_at = NULL,
         status = CASE
           WHEN publish_attempts + 1 >= 5 THEN 'failed'
           ELSE 'scheduled'
         END,
         updated_at = now()
   WHERE id = p_post_id;
END;
$function$;