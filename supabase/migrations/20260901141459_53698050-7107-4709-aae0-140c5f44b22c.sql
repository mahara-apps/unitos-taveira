-- 1) Vínculo de cliente na memória semântica
ALTER TABLE public.brain_embeddings
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

UPDATE public.brain_embeddings e
   SET client_id = ev.client_id
  FROM public.brain_events ev
 WHERE ev.id = e.event_id
   AND e.client_id IS DISTINCT FROM ev.client_id;

-- 2) Deduplicação por evento (mantém o mais recente)
DELETE FROM public.brain_embeddings e
 USING public.brain_embeddings keep
 WHERE e.event_id IS NOT NULL
   AND keep.event_id = e.event_id
   AND (keep.created_at, keep.id) > (e.created_at, e.id);

-- 3) Idempotência: um embedding por evento
CREATE UNIQUE INDEX IF NOT EXISTS brain_embeddings_event_uidx
  ON public.brain_embeddings (event_id)
  WHERE event_id IS NOT NULL;

-- 4) Sem registros pela metade
DELETE FROM public.brain_embeddings WHERE brand_id IS NULL OR embedding IS NULL;
ALTER TABLE public.brain_embeddings ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE public.brain_embeddings ALTER COLUMN embedding SET NOT NULL;

-- 5) Índice de escopo
CREATE INDEX IF NOT EXISTS brain_embeddings_client_idx
  ON public.brain_embeddings (client_id) WHERE client_id IS NOT NULL;