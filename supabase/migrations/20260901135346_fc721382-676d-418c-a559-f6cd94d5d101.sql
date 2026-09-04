-- ============ brain_reasoning_logs: integridade referencial ============
DELETE FROM public.brain_reasoning_logs WHERE brand_id IS NULL;
DELETE FROM public.brain_reasoning_logs r
  WHERE r.brand_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = r.brand_id);

UPDATE public.brain_reasoning_logs r SET client_id = NULL
  WHERE r.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = r.client_id);
UPDATE public.brain_reasoning_logs r SET user_id = NULL
  WHERE r.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.user_id);
UPDATE public.brain_reasoning_logs r SET conversation_id = NULL
  WHERE r.conversation_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.chat_conversations cc WHERE cc.id = r.conversation_id);

ALTER TABLE public.brain_reasoning_logs ALTER COLUMN brand_id SET NOT NULL;

ALTER TABLE public.brain_reasoning_logs
  ADD CONSTRAINT brain_reasoning_logs_brand_id_fkey
    FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE,
  ADD CONSTRAINT brain_reasoning_logs_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD CONSTRAINT brain_reasoning_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT brain_reasoning_logs_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS brain_reasoning_logs_brand_created_idx
  ON public.brain_reasoning_logs (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brain_reasoning_logs_client_idx
  ON public.brain_reasoning_logs (client_id);
CREATE INDEX IF NOT EXISTS brain_reasoning_logs_user_idx
  ON public.brain_reasoning_logs (user_id);
CREATE INDEX IF NOT EXISTS brain_reasoning_logs_conversation_idx
  ON public.brain_reasoning_logs (conversation_id);

-- ============ brain_learning_queue: vínculo de workspace ============
UPDATE public.brain_learning_queue q
   SET brand_id = e.brand_id
  FROM public.brain_events e
 WHERE e.id = q.event_id AND q.brand_id IS NULL AND e.brand_id IS NOT NULL;

DELETE FROM public.brain_learning_queue q
 WHERE q.brand_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = q.brand_id);

ALTER TABLE public.brain_learning_queue
  ADD CONSTRAINT brain_learning_queue_brand_id_fkey
    FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS brain_learning_queue_brand_status_idx
  ON public.brain_learning_queue (brand_id, status);

-- ============ brand_ai_usage: rastreabilidade do consumidor ============
ALTER TABLE public.brand_ai_usage
  ADD COLUMN IF NOT EXISTS actor_kind text NOT NULL DEFAULT 'user';

UPDATE public.brand_ai_usage SET actor_kind = 'system' WHERE actor_id IS NULL;

ALTER TABLE public.brand_ai_usage
  ADD CONSTRAINT brand_ai_usage_actor_kind_chk
    CHECK (
      actor_kind IN ('user', 'system')
      AND (actor_kind <> 'user' OR actor_id IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS brand_ai_usage_actor_idx
  ON public.brand_ai_usage (actor_id);
CREATE INDEX IF NOT EXISTS brand_ai_usage_brand_created_idx
  ON public.brand_ai_usage (brand_id, created_at DESC);