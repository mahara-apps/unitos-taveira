
CREATE TABLE public.brain_reasoning_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID,
  client_id UUID,
  user_id UUID,
  conversation_id UUID,
  question TEXT NOT NULL,
  intent TEXT NOT NULL,
  intent_confidence NUMERIC,
  plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  tools_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision TEXT NOT NULL,
  used_llm BOOLEAN NOT NULL DEFAULT false,
  answer_confidence NUMERIC,
  latency_ms INTEGER,
  memory_hits INTEGER NOT NULL DEFAULT 0,
  answer_preview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.brain_reasoning_logs TO authenticated;
GRANT ALL ON public.brain_reasoning_logs TO service_role;
ALTER TABLE public.brain_reasoning_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reasoning logs owner read"
  ON public.brain_reasoning_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
CREATE INDEX brain_reasoning_logs_brand_created_idx
  ON public.brain_reasoning_logs (brand_id, created_at DESC);
CREATE INDEX brain_reasoning_logs_user_created_idx
  ON public.brain_reasoning_logs (user_id, created_at DESC);
