DROP POLICY IF EXISTS "agent_prompts_update_authenticated" ON public.agent_prompts;
CREATE POLICY "agent_prompts_update_managers"
  ON public.agent_prompts FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.user_id = auth.uid() AND bm.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.user_id = auth.uid() AND bm.role IN ('owner','manager')));