-- 1. Backfill: expirados passam a contar como revogados
UPDATE public.portal_tokens
SET revoked_at = COALESCE(expires_at, now())
WHERE revoked_at IS NULL
  AND expires_at IS NOT NULL
  AND expires_at < now();

-- 2. Normaliza labels
UPDATE public.portal_tokens
SET label = 'Portal do cliente'
WHERE label IS DISTINCT FROM 'Portal do cliente';

-- 3. Um único link ativo por cliente
CREATE UNIQUE INDEX IF NOT EXISTS portal_tokens_one_active_per_client
  ON public.portal_tokens (client_id)
  WHERE revoked_at IS NULL;