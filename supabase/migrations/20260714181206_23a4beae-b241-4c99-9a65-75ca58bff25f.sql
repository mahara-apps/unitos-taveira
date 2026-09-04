ALTER TABLE public.agent_prompts ADD COLUMN IF NOT EXISTS default_prompt TEXT;
UPDATE public.agent_prompts SET default_prompt = system_prompt WHERE default_prompt IS NULL;
ALTER TABLE public.agent_prompts ALTER COLUMN default_prompt SET NOT NULL;

DROP POLICY IF EXISTS "agent_prompts_update_authenticated" ON public.agent_prompts;
CREATE POLICY "agent_prompts_update_authenticated"
  ON public.agent_prompts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT UPDATE ON public.agent_prompts TO authenticated;