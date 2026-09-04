ALTER TABLE public.brand_ai_usage
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS error_kind text,
  ADD COLUMN IF NOT EXISTS step text,
  ADD COLUMN IF NOT EXISTS attempt integer;

COMMENT ON COLUMN public.brand_ai_usage.provider IS 'Provedor BYOK usado na tentativa (openai/gemini/groq/anthropic).';
COMMENT ON COLUMN public.brand_ai_usage.error_kind IS 'Classificacao da falha (provider_rate_limit, provider_unavailable, invalid_output, ...). NULL em sucesso.';
COMMENT ON COLUMN public.brand_ai_usage.step IS 'Etapa/pipeline que originou a chamada, para reconstruir a execucao.';
COMMENT ON COLUMN public.brand_ai_usage.attempt IS 'Numero da tentativa dentro da execucao.';

-- Falha sempre tem classificacao: impede que um erro vire registro indiagnosticavel.
ALTER TABLE public.brand_ai_usage DROP CONSTRAINT IF EXISTS brand_ai_usage_failure_kind_chk;
ALTER TABLE public.brand_ai_usage
  ADD CONSTRAINT brand_ai_usage_failure_kind_chk
  CHECK (success OR error_kind IS NOT NULL) NOT VALID;

CREATE INDEX IF NOT EXISTS brand_ai_usage_failures_idx
  ON public.brand_ai_usage (brand_id, created_at DESC)
  WHERE success = false;