
-- 1) Per-brand override table (users' own custom SM)
CREATE TABLE IF NOT EXISTS public.agent_prompt_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  system_prompt text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, agent_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_prompt_overrides TO authenticated;
GRANT ALL ON public.agent_prompt_overrides TO service_role;

ALTER TABLE public.agent_prompt_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brand members read overrides" ON public.agent_prompt_overrides;
CREATE POLICY "brand members read overrides"
  ON public.agent_prompt_overrides FOR SELECT
  TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()));

DROP POLICY IF EXISTS "brand members write overrides" ON public.agent_prompt_overrides;
CREATE POLICY "brand members write overrides"
  ON public.agent_prompt_overrides FOR ALL
  TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

DROP TRIGGER IF EXISTS update_agent_prompt_overrides_updated_at ON public.agent_prompt_overrides;
CREATE TRIGGER update_agent_prompt_overrides_updated_at
  BEFORE UPDATE ON public.agent_prompt_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS agent_prompt_overrides_brand_agent_idx
  ON public.agent_prompt_overrides (brand_id, agent_id);

-- 2) Hide original prompts from any authenticated user
DROP POLICY IF EXISTS "agent_prompts_read_authenticated" ON public.agent_prompts;
DROP POLICY IF EXISTS "agent_prompts_update_authenticated" ON public.agent_prompts;
DROP POLICY IF EXISTS "agent_prompts_update_managers" ON public.agent_prompts;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.agent_prompts FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.agent_prompts FROM anon;

-- 3) Safe catalog: metadata only, never the prompt text
CREATE OR REPLACE FUNCTION public.list_agent_catalog()
RETURNS TABLE (
  agent_id text,
  agent_name text,
  required_fields jsonb,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT agent_id, agent_name, required_fields, updated_at
  FROM public.agent_prompts
  ORDER BY agent_name;
$$;

REVOKE ALL ON FUNCTION public.list_agent_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_agent_catalog() TO authenticated;
