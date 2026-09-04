-- Chat: dono da conversa + escopo de cliente (client_in_scope já cobre
-- admin de workspace, gerente/colaborador atribuído e super admin).
DROP POLICY IF EXISTS "chat_conversations_owner_all" ON public.chat_conversations;
CREATE POLICY "chat_conversations_owner_in_client_scope"
ON public.chat_conversations
FOR ALL
TO authenticated
USING (user_id = auth.uid() AND public.client_in_scope(client_id, brand_id))
WITH CHECK (user_id = auth.uid() AND public.client_in_scope(client_id, brand_id));

DROP POLICY IF EXISTS "chat_messages_owner_all" ON public.chat_messages;
CREATE POLICY "chat_messages_inherit_conversation_scope"
ON public.chat_messages
FOR ALL
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.chat_conversations c
    WHERE c.id = chat_messages.conversation_id
      AND c.user_id = auth.uid()
      AND public.client_in_scope(c.client_id, c.brand_id)
  )
)
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.chat_conversations c
    WHERE c.id = chat_messages.conversation_id
      AND c.user_id = auth.uid()
      AND public.client_in_scope(c.client_id, c.brand_id)
  )
);

-- ai_jobs: escrita do dono também exige escopo de cliente.
DROP POLICY IF EXISTS "owner updates ai_jobs" ON public.ai_jobs;
CREATE POLICY "owner updates ai_jobs in client scope"
ON public.ai_jobs
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id AND public.client_in_scope(client_id, brand_id))
WITH CHECK (auth.uid() = user_id AND public.client_in_scope(client_id, brand_id));

DROP POLICY IF EXISTS "owner deletes ai_jobs" ON public.ai_jobs;
CREATE POLICY "owner deletes ai_jobs in client scope"
ON public.ai_jobs
FOR DELETE
TO authenticated
USING (auth.uid() = user_id AND public.client_in_scope(client_id, brand_id));

-- brain_reasoning_logs: dono + escopo de cliente.
DROP POLICY IF EXISTS "reasoning logs owner read" ON public.brain_reasoning_logs;
CREATE POLICY "reasoning logs owner read in client scope"
ON public.brain_reasoning_logs
FOR SELECT
TO authenticated
USING (user_id = auth.uid() AND public.client_in_scope(client_id, brand_id));
