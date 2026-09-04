DROP POLICY IF EXISTS "agent_prompts_super_admin_read" ON public.agent_prompts;
DROP POLICY IF EXISTS "agent_prompts_authenticated_read" ON public.agent_prompts;
CREATE POLICY "agent_prompts_authenticated_read" ON public.agent_prompts FOR SELECT TO authenticated USING (true);